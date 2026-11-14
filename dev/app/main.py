"""Backend API (вариант C): FastAPI + SQLite. Отдаёт и API, и статическую веб-страницу.

Запуск локально:  uvicorn app.main:app --reload   (из папки dev/)
"""
from __future__ import annotations

import os
import datetime as dt
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .auth import SESSION_COOKIE, SESSION_TTL, AuthError, AuthService
from .db import Database
from .forecast import ForecastError, ForecastStore

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"


class RegisterIn(BaseModel):
    login: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class ForecastIn(BaseModel):
    origin: str = Field(min_length=1, max_length=40, examples=["Москва"])
    destination: str = Field(min_length=1, max_length=40, examples=["Сочи"])
    date: dt.date = Field(examples=["2026-06-12"])
    price: float = Field(gt=0, lt=1_000_000, examples=[9000])


def create_app(store: ForecastStore | None = None, db: Database | None = None) -> FastAPI:
    store = store or ForecastStore()
    db = db or Database()
    auth = AuthService(db)
    app = FastAPI(title="Решись Авиа — прогноз продаж", version="1.0.0",
                  description="Прогноз спроса и продаж авиабилетов по маршруту, дате и цене.")
    app.state.store, app.state.db, app.state.auth = store, db, auth

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if not request.url.path.startswith(("/docs", "/redoc", "/openapi")):
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
                "connect-src 'self'; frame-ancestors 'none'")
        return response

    def set_session(response: Response, token: str) -> None:
        response.set_cookie(SESSION_COOKIE, token, max_age=int(SESSION_TTL.total_seconds()),
                            httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/")

    def current_user(request: Request) -> dict:
        user = auth.user_by_token(request.cookies.get(SESSION_COOKIE))
        if user is None:
            raise HTTPException(status_code=401, detail="Требуется вход в систему")
        return user

    # ---------- служебное ----------
    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/meta")
    def meta():
        lo, hi = store.date_range()
        return {
            "routes": [
                {"code": r.code, "name": r.name, "origin": r.origin, "destination": r.destination,
                 "base_price": r.base_price, "price_min": r.price_min, "price_max": r.price_max,
                 "price_sensitivity": r.price_sensitivity, "cost_per_passenger": r.cost_per_passenger}
                for r in store.routes.values()
            ],
            "date_min": lo.isoformat(), "date_max": hi.isoformat(),
            "forecast_source": store.forecast_path.name,
        }

    # ---------- регистрация и авторизация ----------
    @app.post("/api/auth/register", status_code=201)
    def register(body: RegisterIn, request: Request, response: Response):
        try:
            auth.register(body.login, body.password, body.name)
            token, user = auth.login(body.login, body.password, request.client.host if request.client else "")
        except AuthError as e:
            raise HTTPException(status_code=400, detail=str(e))
        set_session(response, token)
        return {"user": user}

    @app.post("/api/auth/login")
    def login(body: LoginIn, request: Request, response: Response):
        try:
            token, user = auth.login(body.login, body.password, request.client.host if request.client else "")
        except AuthError as e:
            code = 429 if "попыток" in str(e) else 401
            raise HTTPException(status_code=code, detail=str(e))
        set_session(response, token)
        return {"user": user}

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response):
        auth.logout(request.cookies.get(SESSION_COOKIE))
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/auth/me")
    def me(request: Request):
        # 200 и user = null для гостя: страница при загрузке спокойно узнаёт, вошёл ли пользователь
        return {"user": auth.user_by_token(request.cookies.get(SESSION_COOKIE))}

    # ---------- прогноз ----------
    @app.post("/api/forecast")
    def forecast(body: ForecastIn, user: dict = Depends(current_user)):
        try:
            pred = store.predict(body.origin, body.destination, body.date, body.price)
        except ForecastError as e:
            raise HTTPException(status_code=404 if "Нет " in str(e) else 400, detail=str(e))
        db.execute("INSERT INTO history(user_id, route, flight_date, price, seats, sold) VALUES (?,?,?,?,?,?)",
                   (user["id"], pred.route.code, pred.flight.date.isoformat(), pred.price,
                    pred.flight.seats, pred.sold))
        return pred.to_dict()

    @app.get("/api/history")
    def history(user: dict = Depends(current_user)):
        rows = db.all("SELECT route, flight_date, price, seats, sold, created_at FROM history "
                      "WHERE user_id = ? ORDER BY id DESC LIMIT 20", (user["id"],))
        return {"items": [dict(r) | {"name": store.routes[r["route"]].name} for r in rows]}

    # ---------- веб-страница ----------
    @app.exception_handler(404)
    async def not_found(request: Request, exc):
        if request.url.path.startswith(("/api/", "/static/")):
            detail = getattr(exc, "detail", "Не найдено")
            return JSONResponse({"detail": detail}, status_code=404)
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC_DIR / "index.html")

    return app


app = create_app()

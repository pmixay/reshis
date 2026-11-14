"""Загрузка прогноза спроса и расчёт продаж.

Общий модуль для всех вариантов продукта: CLI-скрипта (вариант A) и backend API (вариант C).

Формула из условия кейса:
    желают = 0.5_base_demand − price_sensitivity × (цена − base_price)
    купят  = min(seats, max(0, желают))
Для графика распределения та же формула применяется к каждому из 9 сценариев (квантилей 0.1 … 0.9).
"""
from __future__ import annotations

import csv
import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

QUANTILES = ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"]
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# IATA-коды городов: код маршрута в данных имеет вид MOW-AER
CITY_BY_CODE = {
    "MOW": "Москва", "AER": "Сочи", "LED": "Санкт-Петербург", "KGD": "Калининград",
    "OVB": "Новосибирск", "MRV": "Минеральные Воды",
}
ALIASES = {  # чтобы в CLI можно было писать коротко
    "москва": "MOW", "сочи": "AER", "санкт-петербург": "LED", "петербург": "LED", "спб": "LED",
    "калининград": "KGD", "новосибирск": "OVB", "минеральные воды": "MRV", "минводы": "MRV",
}


class ForecastError(ValueError):
    """Ошибка во входных данных (маршрут/дата не найдены, неверная цена)."""


@dataclass(frozen=True)
class Route:
    code: str
    name: str
    origin: str
    destination: str
    origin_code: str
    destination_code: str
    base_price: float
    cost_per_passenger: float
    price_sensitivity: float
    price_min: float
    price_max: float


@dataclass(frozen=True)
class FlightForecast:
    route: str
    date: date
    seats: int
    base_demand: dict[str, float]   # спрос при базовой цене по сценариям
    best_price: dict[str, float]    # лучшая цена по сценариям (из ML-части)


@dataclass
class Prediction:
    route: Route
    flight: FlightForecast
    price: float
    wanted: float                   # «желают» по медиане
    sold: int                       # «купят»
    scenarios: list[dict] = field(default_factory=list)

    @property
    def free_seats(self) -> int:
        return self.flight.seats - self.sold

    def to_dict(self) -> dict:
        r, f = self.route, self.flight
        return {
            "route": {
                "code": r.code, "name": r.name, "origin": r.origin, "destination": r.destination,
                "base_price": r.base_price, "price_sensitivity": r.price_sensitivity,
                "cost_per_passenger": r.cost_per_passenger, "price_min": r.price_min, "price_max": r.price_max,
            },
            "date": f.date.isoformat(),
            "price": self.price,
            "seats": f.seats,
            "base_demand_median": f.base_demand["0.5"],
            "wanted": round(self.wanted, 1),
            "sold": self.sold,
            "free_seats": self.free_seats,
            "load_factor": round(self.sold / f.seats, 4) if f.seats else 0.0,
            "revenue": round(self.price * self.sold),
            "profit": round((self.price - r.cost_per_passenger) * self.sold),
            "recommended_price": f.best_price.get("0.5"),
            "sellout_probability": sellout_probability([s["wanted"] for s in self.scenarios], f.seats),
            "scenarios": self.scenarios,
        }


def wanted_at_price(base_demand: float, price: float, route: Route) -> float:
    return base_demand - route.price_sensitivity * (price - route.base_price)


def sold_at_price(base_demand: float, price: float, route: Route, seats: int) -> int:
    return int(round(min(seats, max(0.0, wanted_at_price(base_demand, price, route)))))


def sellout_probability(wanted_by_quantile: list[float], seats: int) -> dict:
    """Вероятность того, что желающих будет не меньше, чем мест (самолёт заполнится).

    Функция распределения спроса восстанавливается линейной интерполяцией по 9 квантилям.
    За пределами квантилей 0.1/0.9 точной оценки нет, поэтому возвращается граница:
    {"p": 0.9, "bound": "gt"} значит «больше 90%», {"p": 0.1, "bound": "lt"} — «меньше 10%».
    """
    qs = [round(0.1 * (i + 1), 1) for i in range(9)]
    xs = sorted(wanted_by_quantile)
    if seats < xs[0]:
        return {"p": 0.9, "bound": "gt"}
    if seats > xs[-1]:
        return {"p": 0.1, "bound": "lt"}
    for (x0, q0), (x1, q1) in zip(zip(xs, qs), zip(xs[1:], qs[1:])):
        if x0 <= seats <= x1:
            cdf = q0 if x1 == x0 else q0 + (q1 - q0) * (seats - x0) / (x1 - x0)
            return {"p": round(1 - cdf, 3), "bound": "eq"}
    return {"p": 0.1, "bound": "lt"}


class ForecastStore:
    """Справочник маршрутов + прогноз по рейсам, загруженные из CSV в память."""

    def __init__(self, forecast_csv: Path | str | None = None, routes_csv: Path | str | None = None):
        self.forecast_path = Path(forecast_csv or os.environ.get("FORECAST_CSV") or self._default_forecast())
        self.routes_path = Path(routes_csv or os.environ.get("ROUTES_CSV") or DATA_DIR / "routes.csv")
        self.routes: dict[str, Route] = self._load_routes(self.routes_path)
        self.flights: dict[tuple[str, date], FlightForecast] = self._load_forecast(self.forecast_path)

    @staticmethod
    def _default_forecast() -> Path:
        own = DATA_DIR / "my_forecast.csv"      # прогноз из ML-части
        return own if own.exists() else DATA_DIR / "seasonal_forecast.csv"

    @staticmethod
    def _load_routes(path: Path) -> dict[str, Route]:
        routes = {}
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                o, d = row["route"].split("-")
                routes[row["route"]] = Route(
                    code=row["route"], name=row["name"],
                    origin=CITY_BY_CODE.get(o, o), destination=CITY_BY_CODE.get(d, d),
                    origin_code=o, destination_code=d,
                    base_price=float(row["base_price"]), cost_per_passenger=float(row["cost_per_passenger"]),
                    price_sensitivity=float(row["price_sensitivity"]),
                    price_min=float(row["price_min"]), price_max=float(row["price_max"]),
                )
        return routes

    @staticmethod
    def _load_forecast(path: Path) -> dict[tuple[str, date], FlightForecast]:
        flights = {}
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                d = date.fromisoformat(row["date"])
                flights[(row["route"], d)] = FlightForecast(
                    route=row["route"], date=d, seats=int(float(row["seats"])),
                    base_demand={q: float(row[f"{q}_base_demand"]) for q in QUANTILES},
                    best_price={q: float(row[f"{q}_price"]) for q in QUANTILES if f"{q}_price" in row},
                )
        return flights

    # --- поиск -------------------------------------------------------------------------------
    @staticmethod
    def city_code(city: str) -> str:
        c = city.strip()
        if c.upper() in CITY_BY_CODE:
            return c.upper()
        code = ALIASES.get(c.lower())
        if code:
            return code
        for k, v in CITY_BY_CODE.items():
            if v.lower() == c.lower():
                return k
        raise ForecastError(f"Неизвестный город: {city!r}")

    def find_route(self, origin: str, destination: str) -> Route:
        code = f"{self.city_code(origin)}-{self.city_code(destination)}"
        if code not in self.routes:
            raise ForecastError(f"Нет маршрута {origin} → {destination}. Доступны: "
                                + ", ".join(r.name for r in self.routes.values()))
        return self.routes[code]

    def date_range(self) -> tuple[date, date]:
        ds = [d for _, d in self.flights]
        return min(ds), max(ds)

    def predict(self, origin: str, destination: str, day: date | str, price: float) -> Prediction:
        route = self.find_route(origin, destination)
        if isinstance(day, str):
            try:
                day = date.fromisoformat(day)
            except ValueError as e:
                raise ForecastError(f"Неверная дата: {day!r}, нужен формат ГГГГ-ММ-ДД") from e
        try:
            price = float(price)
        except (TypeError, ValueError) as e:
            raise ForecastError("Цена должна быть числом") from e
        if not (0 < price < 1_000_000):
            raise ForecastError("Цена должна быть положительной и меньше 1 000 000 ₽")
        flight = self.flights.get((route.code, day))
        if flight is None:
            lo, hi = self.date_range()
            raise ForecastError(f"Нет прогноза на {day.isoformat()} для {route.name}. "
                                f"Прогноз есть на даты с {lo.isoformat()} по {hi.isoformat()}")
        scenarios = []
        for q in QUANTILES:
            bd = flight.base_demand[q]
            w = wanted_at_price(bd, price, route)
            scenarios.append({
                "quantile": float(q), "base_demand": bd, "wanted": round(w, 1),
                "sold": sold_at_price(bd, price, route, flight.seats),
                "best_price": flight.best_price.get(q),
            })
        wanted = wanted_at_price(flight.base_demand["0.5"], price, route)
        sold = sold_at_price(flight.base_demand["0.5"], price, route, flight.seats)
        return Prediction(route, flight, price, wanted, sold, scenarios)

"""Регистрация и авторизация: хэширование паролей (scrypt) и серверные сессии в cookie."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from .db import Database

SESSION_COOKIE = "reshis_session"
SESSION_TTL = timedelta(days=7)
LOGIN_RE = re.compile(r"^[A-Za-z0-9_.\-@]{3,64}$")
_SCRYPT = dict(n=2**14, r=8, p=1, dklen=32)


class AuthError(ValueError):
    pass


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RateLimiter:
    """Не больше `limit` неудачных попыток входа за `window` секунд с одного ключа."""

    def __init__(self, limit: int = 10, window: float = 300):
        self.limit, self.window = limit, window
        self.events: dict[str, deque] = defaultdict(deque)

    def blocked(self, key: str) -> bool:
        q = self.events[key]
        while q and time.monotonic() - q[0] > self.window:
            q.popleft()
        return len(q) >= self.limit

    def hit(self, key: str) -> None:
        self.events[key].append(time.monotonic())


class AuthService:
    def __init__(self, db: Database):
        self.db = db
        self.limiter = RateLimiter()

    def register(self, login: str, password: str, name: str) -> dict:
        login, name = (login or "").strip(), (name or "").strip()
        if not LOGIN_RE.match(login):
            raise AuthError("Логин: 3–64 символа — латинские буквы, цифры, «_», «.», «-», «@»")
        if not (1 <= len(name) <= 80):
            raise AuthError("Укажите имя (до 80 символов)")
        if len(password or "") < 8 or len(password) > 128:
            raise AuthError("Пароль должен быть длиной от 8 до 128 символов")
        if password.isdigit() or password.isalpha():
            raise AuthError("Пароль должен содержать и буквы, и цифры")
        try:
            cur = self.db.execute("INSERT INTO users(login, name, password_hash) VALUES (?, ?, ?)",
                                  (login, name, hash_password(password)))
        except sqlite3.IntegrityError as e:
            raise AuthError("Пользователь с таким логином уже существует") from e
        return {"id": cur.lastrowid, "login": login, "name": name}

    def login(self, login: str, password: str, client: str = "") -> tuple[str, dict]:
        key = f"{client}|{(login or '').lower()}"
        if self.limiter.blocked(key):
            raise AuthError("Слишком много попыток входа. Попробуйте через несколько минут")
        row = self.db.one("SELECT * FROM users WHERE login = ?", ((login or "").strip(),))
        if row is None or not verify_password(password or "", row["password_hash"]):
            self.limiter.hit(key)
            raise AuthError("Неверный логин или пароль")
        token = secrets.token_urlsafe(32)
        self.db.execute("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                        (_token_hash(token), row["id"], (_now() + SESSION_TTL).isoformat()))
        self.db.execute("DELETE FROM sessions WHERE expires_at < ?", (_now().isoformat(),))
        return token, {"id": row["id"], "login": row["login"], "name": row["name"]}

    def user_by_token(self, token: str | None) -> dict | None:
        if not token:
            return None
        row = self.db.one(
            "SELECT u.id, u.login, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_hash = ?", (_token_hash(token),))
        if row is None or datetime.fromisoformat(row["expires_at"]) < _now():
            return None
        return {"id": row["id"], "login": row["login"], "name": row["name"]}

    def logout(self, token: str | None) -> None:
        if token:
            self.db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))

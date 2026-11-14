import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.db import Database  # noqa: E402
from app.forecast import ForecastStore  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture()
def store():
    return ForecastStore(ROOT / "data" / "seasonal_forecast.csv", ROOT / "data" / "routes.csv")


@pytest.fixture()
def client(store):
    app = create_app(store=store, db=Database(":memory:"))
    return TestClient(app)


@pytest.fixture()
def auth_client(client):
    r = client.post("/api/auth/register", json={"login": "anna", "name": "Анна", "password": "secret123"})
    assert r.status_code == 201, r.text
    return client

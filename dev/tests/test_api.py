def test_meta_is_public(client):
    r = client.get("/api/meta")
    assert r.status_code == 200
    body = r.json()
    assert len(body["routes"]) == 5
    assert body["date_min"] == "2026-06-01" and body["date_max"] == "2026-07-01"


def test_forecast_requires_auth(client):
    r = client.post("/api/forecast", json={"origin": "Москва", "destination": "Сочи", "date": "2026-06-12", "price": 9000})
    assert r.status_code == 401


def test_register_login_logout_flow(client):
    r = client.post("/api/auth/register", json={"login": "ivan", "name": "Иван", "password": "qwerty123"})
    assert r.status_code == 201
    assert client.get("/api/auth/me").json()["user"]["login"] == "ivan"
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").json()["user"] is None
    assert client.post("/api/auth/login", json={"login": "ivan", "password": "wrong-pass1"}).status_code == 401
    r = client.post("/api/auth/login", json={"login": "IVAN", "password": "qwerty123"})   # логин без учёта регистра
    assert r.status_code == 200
    assert client.get("/api/auth/me").json()["user"]["name"] == "Иван"


def test_register_validation(client):
    assert client.post("/api/auth/register", json={"login": "x", "name": "X", "password": "qwerty123"}).status_code == 400
    assert client.post("/api/auth/register", json={"login": "petr", "name": "Пётр", "password": "short1"}).status_code == 400
    assert client.post("/api/auth/register", json={"login": "petr", "name": "Пётр", "password": "onlyletters"}).status_code == 400
    assert client.post("/api/auth/register", json={"login": "petr", "name": "Пётр", "password": "letters123"}).status_code == 201
    dup = client.post("/api/auth/register", json={"login": "Petr", "name": "Пётр", "password": "letters123"})
    assert dup.status_code == 400 and "существует" in dup.json()["detail"]


def test_password_not_stored_in_plain_text(client):
    client.post("/api/auth/register", json={"login": "olga", "name": "Ольга", "password": "plain12345"})
    row = client.app.state.db.one("SELECT password_hash FROM users WHERE login = 'olga'")
    assert "plain12345" not in row["password_hash"] and row["password_hash"].startswith("scrypt$")


def test_login_rate_limit(client):
    client.post("/api/auth/register", json={"login": "max", "name": "Макс", "password": "goodpass1"})
    codes = [client.post("/api/auth/login", json={"login": "max", "password": "badpass00"}).status_code for _ in range(11)]
    assert codes[-1] == 429


def test_forecast_and_history(auth_client):
    req = {"origin": "Москва", "destination": "Сочи", "date": "2026-06-01", "price": 10000}
    r = auth_client.post("/api/forecast", json=req)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["seats"] == 900
    assert body["sold"] == round(775 - 0.141 * 1000)
    assert body["free_seats"] == 900 - body["sold"]
    assert len(body["scenarios"]) == 9
    hist = auth_client.get("/api/history").json()["items"]
    assert len(hist) == 1 and hist[0]["route"] == "MOW-AER"


def test_forecast_errors(auth_client):
    bad_date = auth_client.post("/api/forecast", json={"origin": "Москва", "destination": "Сочи", "date": "2026-09-01", "price": 9000})
    assert bad_date.status_code == 404
    bad_city = auth_client.post("/api/forecast", json={"origin": "Москва", "destination": "Марс", "date": "2026-06-01", "price": 9000})
    assert bad_city.status_code == 400
    bad_price = auth_client.post("/api/forecast", json={"origin": "Москва", "destination": "Сочи", "date": "2026-06-01", "price": -1})
    assert bad_price.status_code == 422


def test_index_and_static(client):
    r = client.get("/")
    assert r.status_code == 200 and "Решись Авиа" in r.text
    assert "Content-Security-Policy" in r.headers
    assert client.get("/static/js/main.js").status_code == 200
    assert client.get("/static/vendor/chart.umd.min.js").status_code == 200

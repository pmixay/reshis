from datetime import date

import pytest

from app.forecast import ForecastError, sellout_probability


def test_formula_matches_case(store):
    """MOW-AER 2026-06-01: 0.5_base_demand = 775, base_price = 9000, sensitivity = 0.141, seats = 900."""
    p = store.predict("Москва", "Сочи", "2026-06-01", 10000)
    expected_wanted = 775 - 0.141 * (10000 - 9000)
    assert p.wanted == pytest.approx(expected_wanted)
    assert p.sold == round(min(900, max(0, expected_wanted)))
    assert p.flight.seats == 900


def test_sales_capped_by_seats_and_zero(store):
    assert store.predict("MOW", "AER", "2026-06-01", 1000).sold == 900          # демпинг: упираемся в места
    assert store.predict("MOW", "AER", "2026-06-01", 100000).sold == 0          # слишком дорого: ноль, не минус


def test_city_aliases_and_codes(store):
    a = store.predict("москва", "Санкт-Петербург", date(2026, 6, 5), 5500)
    b = store.predict("MOW", "LED", "2026-06-05", 5500)
    assert a.sold == b.sold and a.route.code == "MOW-LED"


def test_median_scenario_equals_simple_forecast(store):
    p = store.predict("Москва", "Калининград", "2026-06-20", 8000)
    median = next(s for s in p.scenarios if s["quantile"] == 0.5)
    assert median["wanted"] == pytest.approx(round(p.wanted, 1))
    wanted = [s["wanted"] for s in p.scenarios]
    assert wanted == sorted(wanted) and len(wanted) == 9


@pytest.mark.parametrize("args", [
    ("Москва", "Париж", "2026-06-01", 5000),
    ("Сочи", "Москва", "2026-06-01", 5000),       # обратного маршрута в данных нет
    ("Москва", "Сочи", "2026-08-01", 5000),       # вне диапазона прогноза
    ("Москва", "Сочи", "01.06.2026", 5000),       # неверный формат даты
    ("Москва", "Сочи", "2026-06-01", -5),
])
def test_bad_input(store, args):
    with pytest.raises(ForecastError):
        store.predict(*args)


def test_sellout_probability():
    xs = [100, 110, 120, 130, 140, 150, 160, 170, 180]
    assert sellout_probability(xs, 140) == {"p": 0.5, "bound": "eq"}
    assert sellout_probability(xs, 90)["bound"] == "gt"
    assert sellout_probability(xs, 200)["bound"] == "lt"
    assert sellout_probability(xs, 145)["p"] == pytest.approx(0.45)

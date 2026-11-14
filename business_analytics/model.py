"""
Бизнес и аналитика: модель одного дня работы самолёта «Решись Авиа».

Скрипт независимо (численно) проверяет все ответы из отчёта:
  * решает задачу максимизации прибыли для любого маршрута и любого спроса
    (вогнутая квадратичная задача, SLSQP из нескольких стартовых точек);
  * перебирает все допустимые маршруты (<= 4 перелётов, старт и финиш в Петербурге);
  * считает сценарий снегопада (средняя прибыль).

Запуск:  python business_analytics/model.py
Все цены — в тыс. руб., количества — в билетах.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize

MARKETS = ["ПМ", "МП", "МС", "СМ", "ПС", "СП"]
# какие перелёты (участки) использует пассажир каждого рынка
LEGS_OF = {"ПМ": ["ПМ"], "МП": ["МП"], "МС": ["МС"], "СМ": ["СМ"],
           "ПС": ["ПМ", "МС"], "СП": ["СМ", "МП"]}
LEGS = ["ПМ", "МП", "МС", "СМ"]
SEATS = 150          # правило 1
FLIGHT_COST = 100    # правило 6, тыс. руб. за перелёт
PAX_COST = 1         # правило 5, тыс. руб. за пассажира на перелёте
COMPENSATION = 4     # правило 8, тыс. руб.

# Функции спроса q = a - b*p (обычный день)
NORMAL = {"ПМ": (200, 20), "МП": (160, 20), "МС": (120, 20),
          "СМ": (100, 20), "ПС": (100, 10), "СП": (80, 10)}
PEAK = dict(NORMAL, ПМ=(360, 20))


def pax_cost(m: str) -> float:
    return PAX_COST * len(LEGS_OF[m])


@dataclass
class Solution:
    route: str
    flights: dict
    p: dict
    q: dict
    profit: float           # прибыль без снегопада (или средняя, если snow_prob > 0)
    load: dict
    shadow: dict


def solve(demand: dict, flights: dict, snow_prob: float = 0.0, seats: float = SEATS,
          route: str = "") -> Solution:
    """Максимизирует (среднюю) прибыль по количествам q (цена p = (a - q)/b)."""
    active = [m for m in MARKETS if all(flights[l] > 0 for l in LEGS_OF[m])]
    a = np.array([demand[m][0] for m in active], float)
    b = np.array([demand[m][1] for m in active], float)
    c = np.array([pax_cost(m) for m in active], float)
    nf = sum(flights.values())
    s = snow_prob

    def exp_profit(q):
        p = (a - q) / b
        no_snow = np.sum((p - c) * q) - FLIGHT_COST * nf
        snow = -COMPENSATION * np.sum(q)            # билеты возвращены, + компенсация
        return (1 - s) * no_snow + s * snow

    cons = []
    for leg in LEGS:
        idx = [i for i, m in enumerate(active) if leg in LEGS_OF[m]]
        if idx:
            cap = seats * flights[leg] if leg != "ПМ" or isinstance(seats, (int, float)) else seats
            cons.append({"type": "ineq", "fun": lambda q, idx=idx, cap=cap: cap - q[idx].sum()})
    # правило 7: транзитный билет не дороже суммы двух прямых
    def reg(q, t, l1, l2):
        p = (a - q) / b
        return p[active.index(l1)] + p[active.index(l2)] - p[active.index(t)]
    if "ПС" in active:
        cons.append({"type": "ineq", "fun": lambda q: reg(q, "ПС", "ПМ", "МС")})
    if "СП" in active:
        cons.append({"type": "ineq", "fun": lambda q: reg(q, "СП", "СМ", "МП")})

    best = None
    for start in (a * 0.1, a * 0.3, a * 0.5):
        r = minimize(lambda q: -exp_profit(q), start, method="SLSQP",
                     bounds=[(0, ai) for ai in a], constraints=cons,
                     options={"ftol": 1e-12, "maxiter": 1000})
        if best is None or -r.fun > -best.fun:
            best = r
    q = dict(zip(active, best.x))
    p = {m: (demand[m][0] - q[m]) / demand[m][1] for m in active}
    load = {leg: sum(q[m] for m in active if leg in LEGS_OF[m]) for leg in LEGS if flights[leg]}
    # теневая цена кресла на каждом участке: прирост прибыли от +1 кресла на рейсе
    return Solution(route, flights, p, q, -best.fun, load, {})


def routes_from_P(max_flights: int = 4):
    """Все маршруты из Петербурга с возвратом в Петербург, не больше max_flights перелётов."""
    nxt = {"П": ["М"], "М": ["П", "С"], "С": ["М"]}
    res = []

    def go(path):
        if len(path) > 1 and path[-1] == "П":
            res.append(path[:])
        if len(path) - 1 == max_flights:
            return
        for n in nxt[path[-1]]:
            go(path + [n])
    go(["П"])
    return res


def flights_of(path):
    f = {l: 0 for l in LEGS}
    for x, y in zip(path, path[1:]):
        f[x + y] += 1
    return f


def show(title, sol: Solution):
    print(f"\n=== {title} ===")
    for m in MARKETS:
        if m in sol.q:
            print(f"  {m}: p = {sol.p[m]:6.3f}   q = {sol.q[m]:7.2f}")
        else:
            print(f"  {m}: рынок не обслуживается (q = 0)")
    print("  загрузка:", {k: round(v, 2) for k, v in sol.load.items()},
          "пустых кресел:", {k: round(SEATS * sol.flights[k] - v, 2) for k, v in sol.load.items()})
    print(f"  прибыль = {sol.profit:.3f} тыс. руб.")


def main():
    base = flights_of(list("ПМСМП"))

    # Задание 2.1: без ограничения по креслам каждая цена p = (a/b + c)/2
    print("Задание 2.1 (без кресел): ")
    for m in MARKETS:
        a, b = NORMAL[m]
        p = (a / b + pax_cost(m)) / 2
        q = a - b * p
        print(f"  {m}: p* = {p}, q* = {q}, вклад = {(p - pax_cost(m)) * q}")

    s2 = solve(NORMAL, base, route="П-М-С-М-П")
    show("Часть 2. Обычный день, П→М→С→М→П", s2)

    s3 = solve(PEAK, base, route="П-М-С-М-П")
    show("Часть 3. Пиковый день, П→М→С→М→П", s3)
    s3_free = solve(PEAK, base, seats=10**6)
    show("Пиковый день без ограничения по креслам (для сравнения)", s3_free)

    # Задание 3.3: +1 кресло на перелёте П→М
    def solve_extra(demand, extra):
        f = base
        # ёмкость участка ПМ = 150 + extra, остальные 150
        active = MARKETS
        a = np.array([demand[m][0] for m in active], float)
        b = np.array([demand[m][1] for m in active], float)
        c = np.array([pax_cost(m) for m in active], float)
        caps = {"ПМ": SEATS + extra, "МП": SEATS, "МС": SEATS, "СМ": SEATS}
        cons = [{"type": "ineq", "fun": lambda q, idx=[i for i, m in enumerate(active) if leg in LEGS_OF[m]], cap=caps[leg]: cap - q[idx].sum()} for leg in LEGS]
        r = minimize(lambda q: -(np.sum(((a - q) / b - c) * q) - 400), a * 0.3, method="SLSQP",
                     bounds=[(0, ai) for ai in a], constraints=cons, options={"ftol": 1e-12, "maxiter": 1000})
        return -r.fun
    for name, dem in (("пиковый", PEAK), ("обычный", NORMAL)):
        d = solve_extra(dem, 1) - solve_extra(dem, 0)
        print(f"\nЗадание 3.3 ({name} день): +1 кресло на П→М даёт +{d:.3f} тыс. руб.")
    # то же в целых билетах
    best = max(((qpm, 151 - qpm) for qpm in range(100, 152)),
               key=lambda t: (17 - t[0] / 20) * t[0] + (8 - t[1] / 10) * t[1])
    v = lambda t: (17 - t[0] / 20) * t[0] + (8 - t[1] / 10) * t[1]
    print("  в целых билетах: лучшее (q_ПМ, q_ПС) при 151 кресле =", best,
          f"прирост = {v(best) - v((130, 20)):.3f}")

    # Часть 4: все маршруты
    print("\nЧасть 4. Все допустимые маршруты (<= 4 перелётов):")
    for dem_name, dem in (("обычный", NORMAL), ("пиковый", PEAK)):
        for path in routes_from_P():
            sol = solve(dem, flights_of(path))
            print(f"  {dem_name:8s} {'→'.join(path):12s} прибыль = {sol.profit:8.2f}  цены = "
                  + ", ".join(f"{m}:{sol.p[m]:.2f}" for m in sol.p))
    s4 = solve(PEAK, flights_of(list("ПМПМП")), route="П-М-П-М-П")
    show("Задание 4.1. Пиковый день, П→М→П→М→П", s4)

    # Часть 5: снегопад
    s5 = solve(NORMAL, base, snow_prob=0.2)
    show("Часть 5. Обычный день, риск снегопада 0.2 (средняя прибыль)", s5)

    def expected(p: dict, prob=0.2):
        q = {m: NORMAL[m][0] - NORMAL[m][1] * p[m] for m in MARKETS}
        no_snow = sum((p[m] - pax_cost(m)) * q[m] for m in MARKETS) - 400
        snow = -COMPENSATION * sum(q.values())
        return (1 - prob) * no_snow + prob * snow, no_snow, snow, sum(q.values())
    for name, pr in (("новые цены", s5.p), ("цены части 2", s2.p)):
        e, ns, sn, tot = expected(pr)
        print(f"  {name}: билетов = {tot:.1f}, прибыль без снега = {ns:.1f}, при снегопаде = {sn:.1f}, "
              f"средняя = {e:.2f}, средняя компенсация = {0.2 * COMPENSATION * tot:.1f}")


if __name__ == "__main__":
    main()

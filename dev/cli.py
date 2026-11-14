#!/usr/bin/env python3
"""Вариант A: скрипт «простое прогнозирование».

Пример:
    python cli.py --from Москва --to Сочи --date 2026-06-12 --price 9000
    python cli.py --from MOW --to LED --date 2026-06-11 --price 7000 --plot chart.png
    python cli.py            # без аргументов — интерактивный ввод

Скрипт находит строку рейса в файле прогноза (my_forecast.csv из ML-части, иначе seasonal_forecast.csv)
и выводит число мест и прогноз продаж:
    желают = 0.5_base_demand − price_sensitivity × (цена − base_price)
    купят  = min(seats, max(0, желают))
"""
from __future__ import annotations

import argparse
import sys

from app.forecast import ForecastError, ForecastStore


def ask(prompt: str, default: str | None = None) -> str:
    v = input(f"{prompt}{f' [{default}]' if default else ''}: ").strip()
    return v or (default or "")


def plot(pred, path: str) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    sc = pred.scenarios
    labels = [f"{s['quantile']:.1f}" for s in sc]
    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.bar(labels, [max(0, s["wanted"]) for s in sc], color="#93c5fd", label="желают купить")
    ax.bar(labels, [s["sold"] for s in sc], width=0.45, color="#1d4ed8", label="купят (с учётом мест)")
    ax.axhline(pred.flight.seats, color="#dc2626", ls="--", label=f"мест в самолётах: {pred.flight.seats}")
    ax.set_xlabel("сценарий (квантиль прогноза): 0.1 — пессимистичный, 0.9 — оптимистичный")
    ax.set_ylabel("пассажиров")
    ax.set_title(f"{pred.route.name}, {pred.flight.date:%d.%m.%Y}, цена {pred.price:,.0f} ₽".replace(",", " "))
    ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    print(f"График сохранён: {path}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Прогноз продаж авиабилетов «Решись Авиа»")
    ap.add_argument("--from", dest="origin", help="пункт отправления (Москва или MOW)")
    ap.add_argument("--to", dest="destination", help="пункт назначения (например, Сочи или AER)")
    ap.add_argument("--date", help="дата вылета ГГГГ-ММ-ДД (2026-06-01 … 2026-07-01)")
    ap.add_argument("--price", type=float, help="цена билета, ₽")
    ap.add_argument("--forecast", help="путь к CSV с прогнозом (по умолчанию my_forecast.csv)")
    ap.add_argument("--plot", metavar="PNG", help="сохранить график распределения спроса в файл")
    args = ap.parse_args(argv)

    store = ForecastStore(args.forecast)
    if not all([args.origin, args.destination, args.date, args.price]):
        print("Маршруты:", ", ".join(r.name for r in store.routes.values()))
        lo, hi = store.date_range()
        args.origin = args.origin or ask("Откуда", "Москва")
        args.destination = args.destination or ask("Куда", "Сочи")
        args.date = args.date or ask(f"Дата вылета ({lo} … {hi})", lo.isoformat())
        args.price = args.price or ask("Цена билета, ₽")
    try:
        pred = store.predict(args.origin, args.destination, args.date, args.price)
    except ForecastError as e:
        print(f"Ошибка: {e}", file=sys.stderr)
        return 1

    r, f = pred.route, pred.flight
    fmt = lambda x: f"{x:,.0f}".replace(",", " ")
    print(f"\nРейс: {r.name}, {f.date:%d.%m.%Y}   (прогноз: {store.forecast_path.name})")
    print(f"Цена билета:          {fmt(pred.price)} ₽  (базовая {fmt(r.base_price)} ₽, "
          f"чувствительность {r.price_sensitivity} чел./₽)")
    print(f"Мест в самолётах:     {f.seats}")
    print(f"Спрос при базовой цене (медиана): {fmt(f.base_demand['0.5'])}")
    print(f"Желают купить:        {pred.wanted:.0f}")
    print(f"Прогноз продаж:       {pred.sold}  (свободно останется {pred.free_seats} мест, "
          f"загрузка {pred.sold / f.seats:.0%})")
    print(f"Выручка / прибыль:    {fmt(pred.price * pred.sold)} ₽ / {fmt((pred.price - r.cost_per_passenger) * pred.sold)} ₽")
    if f.best_price.get("0.5"):
        print(f"Рекомендуемая цена (медианный сценарий): {fmt(f.best_price['0.5'])} ₽")
    print("\nСценарии (квантиль: желают → купят):")
    for s in pred.scenarios:
        print(f"  {s['quantile']:.1f}: {s['wanted']:7.0f} → {s['sold']:4d}")
    if args.plot:
        plot(pred, args.plot)
    return 0


if __name__ == "__main__":
    sys.exit(main())

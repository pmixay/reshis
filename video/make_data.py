"""Готовит данные для графиков на слайдах видео (из данных кейса и итогового прогноза)."""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data" / "ml_case" / "public"
train = pd.read_csv(D / "train.csv", parse_dates=["date"])
test = pd.read_csv(D / "test.csv", parse_dates=["date"])
fc = pd.read_csv(ROOT / "ml" / "notebook" / "my_forecast.csv", parse_dates=["date"])
wide = train.pivot(index="date", columns="route", values="demand")

hol = wide.loc["2025-04-15":"2025-05-20", ["MOW-AER", "MOW-LED"]]
outage = wide.loc["2023-06-25":"2023-08-10", "MOW-AER"]
may = test[test.route == "MOW-AER"].set_index("date")["demand"].loc["2026-05-11":]
aer = fc[fc.route == "MOW-AER"].set_index("date")

fmt = lambda idx: [d.strftime("%d.%m") for d in idx]
data = {
    "holidays": {"labels": fmt(hol.index), "aer": hol["MOW-AER"].tolist(), "led": hol["MOW-LED"].tolist(),
                 "shade": [d.strftime("%d.%m") for d in hol.index
                           if ("2025-04-28" <= d.strftime("%Y-%m-%d") <= "2025-05-03")
                           or ("2025-05-08" <= d.strftime("%Y-%m-%d") <= "2025-05-11")]},
    "outage": {"labels": fmt(outage.index), "aer": outage.tolist()},
    "june": {"labels": fmt(may.index) + fmt(aer.index),
             "fact": may.tolist() + [None] * len(aer),
             "q1": [None] * len(may) + aer["0.1_base_demand"].tolist(),
             "q5": [None] * len(may) + aer["0.5_base_demand"].tolist(),
             "q9": [None] * len(may) + aer["0.9_base_demand"].tolist(),
             "seats": int(aer["seats"].iloc[0])},
    # MAE на валидации с признаками и время обучения + прогноза (итоговый запуск ноутбука, задание 4)
    "models": [
        {"name": "Ансамбль", "mae": 33.85, "time": "18 мин"},
        {"name": "DirectTabular", "mae": 35.58, "time": "4 с"},
        {"name": "Chronos-2 small", "mae": 35.98, "time": "4,8 мин"},
        {"name": "Chronos-2", "mae": 36.52, "time": "5 с", "chosen": True},
        {"name": "Toto-2", "mae": 41.29, "time": "1 с"},
        {"name": "SeasonalNaive", "mae": 51.54, "time": "0,1 с"},
    ],
}
out = Path(__file__).resolve().parent / "build" / "data.js"
out.parent.mkdir(exist_ok=True)
out.write_text("window.VDATA = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")
print("data:", out)

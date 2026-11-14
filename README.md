# «Решись Авиа»: динамическое ценообразование авиабилетов

Решение кейса из трёх частей: **Бизнес и аналитика**, **Искусственный интеллект (ML)** и **Разработка**.

| Часть | Что сделано | Результат |
|---|---|---|
| Бизнес и аналитика | Модель одного дня самолёта (ограничения, прибыль), лучшие цены для обычного и пикового дня, оценка смены маршрута, цены с учётом риска снегопада, выводы для руководства | [`business_analytics/ФИО_БиА.pdf`](business_analytics/ФИО_БиА.pdf) (7 стр.), численная проверка [`business_analytics/model.py`](business_analytics/model.py) |
| Искусственный интеллект | Исследование данных, обучение и сравнение моделей AutoGluon, календарные признаки, выбор модели, проверка на тесте, прогноз спроса и цен на 1 июня – 1 июля 2026 | [`ml/notebook/ml_demand_forecast.ipynb`](ml/notebook/ml_demand_forecast.ipynb), [`ml/notebook/my_forecast.csv`](ml/notebook/my_forecast.csv) |
| Разработка | Веб-сервис с backend API (вариант C) + скрипт (вариант A): прогноз продаж по маршруту, дате и цене, графики распределения спроса, регистрация, авторизация, Docker для хостинга | [`dev/`](dev/) — см. [`dev/README.md`](dev/README.md) |

## Структура репозитория

```
├── business_analytics/
│   ├── model.py               # численная проверка всех ответов (SLSQP + перебор маршрутов)
│   ├── report/solution.html   # исходник отчёта
│   ├── report/build_pdf.cjs   # сборка PDF (A4, поля 2 см, шрифт 11 pt)
│   └── ФИО_БиА.pdf            # готовый отчёт
├── ml/
│   ├── notebook/ml_demand_forecast.ipynb   # ноутбук кейса с решёнными заданиями и выводом ячеек
│   ├── notebook/my_forecast.csv            # прогноз спроса и лучших цен на июнь (задание 7)
│   └── requirements.txt
├── dev/                       # сервис прогноза продаж (FastAPI + TypeScript + SQLite + Docker)
├── data/ml_case/public/       # данные кейса: train, test, routes, schedule, seasonal_forecast
└── scripts/make_submission.sh # раскладывает файлы для сдачи с вашим ФИО в названии
```

## Как воспроизвести

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r ml/requirements.txt -r business_analytics/requirements.txt -r dev/requirements-dev.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu
```

**Бизнес и аналитика** — проверка расчётов и сборка PDF (нужен Node.js и Playwright с Chromium):

```bash
python business_analytics/model.py
node business_analytics/report/build_pdf.cjs "Фамилия Имя Отчество"
```

**ML** — ноутбук можно открыть в Google Colab (он сам установит AutoGluon и скачает данные) или запустить локально:

```bash
cd ml/notebook && jupyter nbconvert --to notebook --execute --inplace ml_demand_forecast.ipynb
```

Полный прогон на 4 CPU занимает около 30 минут (из них ~20 минут — пресет `high_quality`, который сравнивается в задании 2).
После запуска появляется `my_forecast.csv`; скопируйте его в `dev/data/`, чтобы сервис использовал свежий прогноз.

**Разработка:**

```bash
cd dev && uvicorn app.main:app --reload        # http://localhost:8000
python -m pytest -q                             # тесты
docker compose up -d --build                   # для хостинга
```

## Сдача

Скрипт собирает файлы для загрузки на Google/Яндекс Диск с вашим ФИО в названиях:

```bash
scripts/make_submission.sh "Фамилия Имя Отчество"
```

Он создаёт папку `submission/` с файлами `ФИО_БиА.pdf`, `ФИО_ml_demand_forecast.ipynb`, `ФИО_my_forecast.csv` и
`ФИО_dev.zip` (код сервиса). Для части «Разработка» дополнительно нужно либо видео работы, либо ссылка на развёрнутый
сервис (инструкция по размещению — в [`dev/README.md`](dev/README.md#размещение-на-хостинге)).

## Инструменты ИИ

Решение подготовлено с помощью ИИ-агента **Claude Code** (Anthropic): математическая модель и её численная проверка,
отчёт, код ноутбука, веб-сервис, тесты и проверка интерфейса в браузере.

#!/usr/bin/env bash
# Собирает файлы для сдачи с ФИО в названиях.
# Использование: scripts/make_submission.sh "Фамилия Имя Отчество"
set -euo pipefail
FIO="${1:?Укажите ФИО: scripts/make_submission.sh \"Фамилия Имя Отчество\"}"
NAME="${FIO// /_}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/submission"
mkdir -p "$OUT"

# 1. Бизнес и аналитика: PDF с ФИО в шапке
node "$ROOT/business_analytics/report/build_pdf.cjs" "$FIO"
mv "$ROOT/business_analytics/${NAME}_БиА.pdf" "$OUT/${NAME}_БиА.pdf"

# 2. ML: ноутбук и прогноз
cp "$ROOT/ml/notebook/ml_demand_forecast.ipynb" "$OUT/${NAME}_ml_demand_forecast.ipynb"
cp "$ROOT/ml/notebook/my_forecast.csv" "$OUT/${NAME}_my_forecast.csv"

# 3. Разработка: архив с кодом сервиса (без node_modules и локальной базы)
(cd "$ROOT" && rm -f "$OUT/${NAME}_dev.zip" && zip -qr "$OUT/${NAME}_dev.zip" dev \
    -x 'dev/frontend/node_modules/*' 'dev/data/app.sqlite3' '*/__pycache__/*' 'dev/.pytest_cache/*')

ls -la "$OUT"

# Видео о решении кейса (до 3 минут)

Анимированное видео с навигацией в виде линии метро: каждая страница это станция.
Кадры рендерятся в браузере (Playwright) и собираются ffmpeg.

| Файл | Что делает |
|---|---|
| `script_ru.md` | текст для озвучки по блокам |
| `narration.json` | тот же текст, разбитый на блоки и сцены |
| `player.html` | все страницы видео, линия метро и анимации |
| `make_data.py` | данные для графиков из данных кейса и итогового прогноза |
| `record_clip.cjs` | запись работы сервиса для страницы «Сервис» |
| `timeline.py` | тайминг страниц: по тексту или по разметке записи голоса |
| `render_video.cjs` | покадровый рендер в mp4, с голосом или без |

```bash
python video/make_data.py
node video/record_clip.cjs                 # нужен запущенный сервер dev на порту 8000
python video/timeline.py                   # или: python video/timeline.py build/timings.json
node video/render_video.cjs --out video/out/draft_no_voice.mp4
node video/render_video.cjs --audio voice.m4a --out video/out/video.mp4
```

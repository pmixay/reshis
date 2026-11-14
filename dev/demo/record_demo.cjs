// Запись видеодемонстрации всех функций сервиса (Playwright).
// 1) запустите сервер:  cd dev && uvicorn app.main:app --port 8000
// 2) node dev/demo/record_demo.cjs  ->  dev/demo/demo.webm (и demo.mp4, если есть ffmpeg)
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const BASE = process.env.BASE_URL || "http://localhost:8000";
const OUT = __dirname;

async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById("__demo_caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_caption";
      Object.assign(el.style, {
        position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)", zIndex: 9999,
        background: "rgba(15,23,42,.92)", color: "#fff", padding: "12px 20px", borderRadius: "12px",
        font: "600 18px Inter, Arial, sans-serif", maxWidth: "80%", textAlign: "center",
        boxShadow: "0 8px 24px rgba(0,0,0,.25)", pointerEvents: "none",
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

const pause = (page, ms) => page.waitForTimeout(ms);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 }, recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
    locale: "ru-RU", colorScheme: "light",
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector("#auth-view:not([hidden])");
  await caption(page, "«Решись Авиа» — прогноз продаж билетов. Без входа прогноз недоступен");
  await pause(page, 3000);

  // Регистрация
  await page.click("#tab-register");
  await caption(page, "1. Регистрация нового пользователя");
  const login = `manager${Date.now() % 100000}`;
  await page.type("#register-form input[name=name]", "Анна Менеджер", { delay: 60 });
  await page.type("#register-form input[name=login]", login, { delay: 60 });
  await page.type("#register-form input[name=password]", "short", { delay: 60 });
  await page.type("#register-form input[name=password2]", "short", { delay: 60 });
  await page.click("#register-form button[type=submit]");
  await caption(page, "Проверка пароля: слишком короткий пароль не принимается");
  await pause(page, 2500);
  await page.fill("#register-form input[name=password]", "");
  await page.fill("#register-form input[name=password2]", "");
  await page.type("#register-form input[name=password]", "secret2026", { delay: 50 });
  await page.type("#register-form input[name=password2]", "secret2026", { delay: 50 });
  await page.click("#register-form button[type=submit]");
  await page.waitForSelector("#app-view:not([hidden])");
  await caption(page, "Пользователь зарегистрирован и сразу вошёл в систему");
  await pause(page, 2500);

  // Прогноз 1: базовая цена, Сочи, 12 июня
  await caption(page, "2. Вводим маршрут, дату вылета и цену билета");
  await page.selectOption("#destination", "Сочи");
  await page.fill("#date", "2026-06-11");
  await page.fill("#price", "");
  await page.type("#price", "9000", { delay: 80 });
  await pause(page, 800);
  await page.click("#submit-btn");
  await page.waitForSelector("#results:not([hidden])");
  await caption(page, "Сразу видно: сколько мест, сколько билетов купят и сколько мест останется свободными");
  await pause(page, 4000);
  await page.locator("#chart-scenarios").scrollIntoViewIfNeeded();
  await caption(page, "3. График сценариев: медиана = «желают купить», красная линия — число мест");
  await pause(page, 4500);
  await page.locator("#chart-distribution").scrollIntoViewIfNeeded();
  await caption(page, "Распределение спроса: оранжевая часть — спрос выше числа мест (продажи упираются в места)");
  await pause(page, 4500);
  await page.click(".details summary");
  await page.locator(".details").scrollIntoViewIfNeeded();
  await caption(page, "Таблица всех 9 сценариев прогноза");
  await pause(page, 3000);

  // Прогноз 2: рекомендуемая цена
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(page, 800);
  await caption(page, "4. Кнопка «Рекомендуемая» ставит лучшую цену из ML-прогноза");
  await page.click("#btn-rec-price");
  await pause(page, 3500);

  // Прогноз 3: высокая цена, Петербург
  await caption(page, "Другой маршрут и цена: Москва — Санкт-Петербург, 7 000 ₽");
  await page.selectOption("#destination", "Санкт-Петербург");
  await page.fill("#date", "2026-06-20");
  await page.fill("#price", "");
  await page.type("#price", "7000", { delay: 80 });
  await page.click("#submit-btn");
  await pause(page, 3500);
  await page.locator("#chart-scenarios").scrollIntoViewIfNeeded();
  await caption(page, "Мест хватает при любом сценарии — самолёт заполнится лишь частично");
  await pause(page, 3500);

  // Ошибка ввода
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await caption(page, "Проверка ввода: отрицательная цена");
  await page.fill("#price", "-100");
  await page.click("#submit-btn");
  await pause(page, 2500);

  // История
  await page.locator("#history-table").scrollIntoViewIfNeeded();
  await caption(page, "5. История расчётов пользователя: клик по строке повторяет расчёт");
  await pause(page, 3000);
  await page.locator("#history-rows tr").last().click();
  await pause(page, 2500);

  // Выход и вход
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await caption(page, "6. Выход и повторный вход (авторизация)");
  await pause(page, 1200);
  await page.click("#logout-btn");
  await page.waitForSelector("#auth-view:not([hidden])");
  await page.type("#login-form input[name=login]", login, { delay: 50 });
  await page.type("#login-form input[name=password]", "wrongpass1", { delay: 50 });
  await page.click("#login-form button[type=submit]");
  await caption(page, "Неверный пароль — вход не выполнен");
  await pause(page, 2500);
  await page.fill("#login-form input[name=password]", "");
  await page.type("#login-form input[name=password]", "secret2026", { delay: 50 });
  await page.click("#login-form button[type=submit]");
  await page.waitForSelector("#app-view:not([hidden])");
  await caption(page, "Вход выполнен: история расчётов сохранилась");
  await pause(page, 3000);

  // Мобильная версия
  await page.setViewportSize({ width: 420, height: 800 });
  await caption(page, "Адаптивная вёрстка для телефона");
  await pause(page, 3000);

  const video = page.video();
  await ctx.close();
  await browser.close();
  const src = await video.path();
  const webm = path.join(OUT, "demo.webm");
  fs.renameSync(src, webm);
  console.log("video:", webm);
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-crf", "28", "-preset", "veryfast", "-movflags", "+faststart", path.join(OUT, "demo.mp4")]);
    fs.unlinkSync(webm);
    console.log("video:", path.join(OUT, "demo.mp4"));
  } catch (e) {
    console.log("ffmpeg недоступен, оставлен demo.webm");
  }
})();

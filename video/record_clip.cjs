// Чистая запись работы сервиса для сцены «Разработка» (без подписей): node video/record_clip.cjs
// Нужен запущенный сервер: cd dev && uvicorn app.main:app --port 8000
const { chromium, request } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE_URL || "http://localhost:8000";

async function smoothScroll(page, dy, steps = 30) {
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await page.waitForTimeout(16); }
}

(async () => {
  // входим заранее, чтобы видео начиналось сразу с формы
  const api = await request.newContext({ baseURL: BASE });
  const login = `demo${Date.now() % 100000}`;
  await api.post("/api/auth/register", { data: { login, name: "Анна", password: "secret2026" } });
  const state = await api.storageState();
  await api.dispose();

  const browser = await chromium.launch({ args: ["--lang=ru-RU"], env: { ...process.env, LANG: "ru_RU.UTF-8", LANGUAGE: "ru_RU:ru", LC_ALL: "ru_RU.UTF-8" } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: state, locale: "ru-RU",
    recordVideo: { dir: __dirname, size: { width: 1280, height: 800 } } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector("#app-view:not([hidden])");
  await page.mouse.move(640, 400);
  await page.waitForTimeout(600);
  await page.selectOption("#destination", "Сочи");
  await page.fill("#date", "2026-06-11");
  await page.fill("#price", "");
  await page.type("#price", "9000", { delay: 90 });
  await page.click("#submit-btn");
  await page.waitForSelector("#results:not([hidden])");
  await page.waitForTimeout(2600);
  await smoothScroll(page, 560);
  await page.waitForTimeout(2200);
  await smoothScroll(page, 480);
  await page.waitForTimeout(2400);
  await smoothScroll(page, -1100);
  await page.waitForTimeout(500);
  await page.click("#btn-rec-price");
  await page.waitForTimeout(2600);
  await page.selectOption("#destination", "Санкт-Петербург");
  await page.fill("#date", "2026-06-20");
  await page.fill("#price", "");
  await page.type("#price", "7000", { delay: 90 });
  await page.click("#submit-btn");
  await page.waitForTimeout(2600);
  await smoothScroll(page, 2200, 45);
  await page.waitForTimeout(2200);
  const video = page.video();
  await ctx.close();
  await browser.close();
  const out = path.join(__dirname, "build", "app_clip.webm");
  fs.renameSync(await video.path(), out);
  console.log("clip:", out);
})();

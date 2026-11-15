// Рендер слайдов видео в PNG 1920x1080: node video/render_slides.cjs
const { chromium } = require("playwright");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const SCENES = ["s1", "s2", "s3", "s4", "s5a", "s5b", "s6", "s7", "s8", "s9"];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const url = pathToFileURL(path.join(__dirname, "slides.html")).href;
  for (const s of SCENES) {
    await page.goto(`${url}?scene=${s}`);
    await page.waitForFunction(() => document.body.dataset.ready === "1");
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(__dirname, "build", `${s}.png`) });
    if (s === "s6") {
      const box = await page.locator("#frame").boundingBox();
      require("node:fs").writeFileSync(path.join(__dirname, "build", "frame.json"), JSON.stringify(box));
    }
  }
  await browser.close();
  console.log("slides rendered:", SCENES.length);
})();

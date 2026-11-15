// Покадровый рендер видео из player.html (Playwright -> ffmpeg).
//   node video/render_video.cjs [--audio voice.m4a] [--out video/out/video.mp4]
//   node video/render_video.cjs --stills 3,15,40     (кадры в PNG для проверки)
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt("--out", path.join(__dirname, "out", "video.mp4"));
const AUDIO = opt("--audio", null);
const STILLS = opt("--stills", null);

(async () => {
  const browser = await chromium.launch({ args: ["--lang=ru-RU"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(__dirname, "player.html")).href);
  await page.waitForFunction(() => window.ready === true);
  const tl = await page.evaluate(() => window.TIMELINE);

  if (STILLS) {
    for (const t of STILLS.split(",").map(Number)) {
      await page.evaluate((x) => window.renderAt(x), t);
      const f = path.join(__dirname, "build", `still_${String(t).replace(".", "_")}.png`);
      await page.screenshot({ path: f });
      console.log("still:", f);
    }
    await browser.close();
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const ff = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(tl.fps), "-c:v", "mjpeg", "-i", "-"];
  if (AUDIO) ff.push("-i", AUDIO, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k");
  ff.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", OUT);
  const enc = spawn("ffmpeg", ff, { stdio: ["pipe", "inherit", "inherit"] });
  const write = (buf) => new Promise((res) => (enc.stdin.write(buf) ? res() : enc.stdin.once("drain", res)));

  const n = Math.round(tl.total * tl.fps);
  let last = null, rendered = 0;
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    const t = f / tl.fps;
    const anim = await page.evaluate((x) => window.isAnimating(x), t);
    if (anim || !last) {
      await page.evaluate((x) => window.renderAt(x), t);
      last = await page.screenshot({ type: "jpeg", quality: 92 });
      rendered++;
    }
    await write(last);
    if (f % 300 === 0) console.log(`кадр ${f}/${n}, отрисовано ${rendered}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  }
  enc.stdin.end();
  await new Promise((res) => enc.on("close", res));
  await browser.close();
  console.log(`video: ${OUT} (${tl.total.toFixed(1)} с, ${n} кадров, отрисовано ${rendered})`);
})();

// Сборка PDF решения части «Бизнес и аналитика» из solution.html.
// Запуск: node business_analytics/report/build_pdf.cjs "Иванов Иван Иванович"
// Результат: business_analytics/<ФИО>_БиА.pdf (A4, поля 2 см, шрифт 11 pt).
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const here = __dirname;
  const fio = (process.argv[2] || process.env.FIO || "ФИО").trim();
  const shown = fio === "ФИО" ? "________________" : fio;
  const html = fs.readFileSync(path.join(here, "solution.html"), "utf8").replaceAll("{{FIO}}", shown);
  const tmp = path.join(here, ".rendered.html");
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
  const out = path.join(here, "..", `${fio.replaceAll(" ", "_")}_БиА.pdf`);
  await page.pdf({
    path: out, format: "A4", printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: "<span></span>",
    footerTemplate: '<div style="font-size:9px;width:100%;text-align:center;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
  await browser.close();
  fs.unlinkSync(tmp);
  console.log("PDF:", out);
})();

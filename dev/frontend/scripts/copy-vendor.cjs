// Копирует Chart.js (UMD-сборку) в static/vendor, чтобы страница работала без CDN.
const fs = require("node:fs");
const path = require("node:path");
const src = path.join(__dirname, "..", "node_modules", "chart.js", "dist", "chart.umd.min.js");
const dst = path.join(__dirname, "..", "..", "static", "vendor", "chart.umd.min.js");
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log("vendor:", path.relative(process.cwd(), dst));

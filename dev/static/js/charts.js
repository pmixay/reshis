const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function palette() {
    return {
        accent: css("--accent"),
        accentSoft: css("--accent-soft"),
        danger: css("--danger"),
        muted: css("--muted"),
        grid: css("--grid"),
        text: css("--text"),
        over: css("--over"),
    };
}
const charts = new Map();
function draw(canvas, config) {
    charts.get(canvas.id)?.destroy();
    charts.set(canvas.id, new Chart(canvas, config));
}
const scenarioLabel = (q) => q === 0.5 ? ["0.5", "медиана"] : q === 0.1 ? ["0.1", "песс."] : q === 0.9 ? ["0.9", "опт."] : q.toFixed(1);
/** График 1: 9 сценариев спроса при введённой цене — сколько желают и сколько купят, линия мест. */
export function renderScenarios(canvas, r) {
    const c = palette();
    const labels = r.scenarios.map((s) => scenarioLabel(s.quantile));
    const wanted = r.scenarios.map((s) => Math.max(0, Math.round(s.wanted)));
    const sold = r.scenarios.map((s) => s.sold);
    const isMedian = r.scenarios.map((s) => s.quantile === 0.5);
    draw(canvas, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    type: "line",
                    label: `Мест в самолётах: ${nf.format(r.seats)}`,
                    data: labels.map(() => r.seats),
                    borderColor: c.danger,
                    borderDash: [6, 4],
                    borderWidth: 2,
                    pointRadius: 0,
                    order: 0,
                },
                {
                    label: "Желают купить",
                    data: wanted,
                    backgroundColor: isMedian.map((m) => (m ? c.accentSoft : c.grid)),
                    borderColor: isMedian.map((m) => (m ? c.accent : c.muted)),
                    borderWidth: isMedian.map((m) => (m ? 2 : 1)),
                    barPercentage: 0.9,
                    grouped: false,
                    order: 2,
                },
                {
                    label: "Купят (с учётом мест)",
                    data: sold,
                    backgroundColor: c.accent,
                    barPercentage: 0.5,
                    grouped: false,
                    order: 1,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { labels: { color: c.text, boxWidth: 14 } },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const q = r.scenarios[items[0].dataIndex].quantile;
                            return `Сценарий ${q.toFixed(1)}: спрос ниже этого значения с вероятностью ${Math.round(q * 100)}%`;
                        },
                        label: (item) => ` ${item.dataset.label?.split(":")[0]}: ${nf.format(item.parsed.y ?? 0)}`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: c.muted, maxRotation: 0, autoSkip: false },
                    grid: { display: false },
                    title: { display: true, text: "сценарий (квантиль прогноза)", color: c.muted },
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: c.muted, callback: (v) => nf.format(Number(v)) },
                    grid: { color: c.grid },
                    title: { display: true, text: "пассажиров", color: c.muted },
                },
            },
        },
    });
}
/**
 * График 2: распределение спроса при введённой цене.
 * Между соседними квантилями лежит 10% вероятности, поэтому высота ступеньки = 10% / ширина интервала.
 * Часть распределения правее числа мест закрашена другим цветом: этим пассажирам мест не хватит.
 */
export function renderDistribution(canvas, r) {
    const c = palette();
    const xs = r.scenarios.map((s) => s.wanted).sort((a, b) => a - b);
    const intervals = [];
    const first = Math.max(1, xs[1] - xs[0]);
    const last = Math.max(1, xs[8] - xs[7]);
    intervals.push({ from: xs[0] - first, to: xs[0], prob: 0.1 }); // хвост: < квантиля 0.1 (оценка)
    for (let i = 0; i < 8; i++)
        intervals.push({ from: xs[i], to: Math.max(xs[i] + 1, xs[i + 1]), prob: 0.1 });
    intervals.push({ from: xs[8], to: xs[8] + last, prob: 0.1 }); // хвост: > квантиля 0.9 (оценка)
    // плотность в «% вероятности на 10 пассажиров» — так шкалу проще читать
    const dens = intervals.map((iv) => ({ ...iv, d: (iv.prob / (iv.to - iv.from)) * 10 * 100 }));
    const step = (filter) => {
        const pts = [];
        for (const iv of dens) {
            // разбиваем интервал точкой «мест», чтобы закрасить части по-разному
            const cuts = [iv.from, ...(r.seats > iv.from && r.seats < iv.to ? [r.seats] : []), iv.to];
            for (let k = 0; k < cuts.length - 1; k++) {
                const mid = (cuts[k] + cuts[k + 1]) / 2;
                const y = filter(mid) ? iv.d : null;
                pts.push({ x: Math.max(0, cuts[k]), y }, { x: Math.max(0, cuts[k + 1]), y });
            }
        }
        return pts;
    };
    const ymax = Math.max(...dens.map((d) => d.d)) * 1.15;
    const span = Math.max(dens[dens.length - 1].to, r.seats) - Math.min(dens[0].from, r.seats);
    const unit = span > 600 ? 100 : span > 250 ? 50 : span > 100 ? 20 : 10;
    const xmin = Math.max(0, Math.floor((Math.min(dens[0].from, r.seats) - unit / 2) / unit) * unit);
    const xmax = Math.ceil((Math.max(dens[dens.length - 1].to, r.seats) + unit / 2) / unit) * unit;
    draw(canvas, {
        type: "line",
        data: {
            datasets: [
                {
                    label: "Спрос поместится в самолёт",
                    data: step((x) => x <= r.seats),
                    borderColor: c.accent,
                    backgroundColor: c.accentSoft,
                    fill: "origin",
                    pointRadius: 0,
                    borderWidth: 1.5,
                    spanGaps: false,
                },
                {
                    label: "Спрос выше числа мест (не улетят)",
                    data: step((x) => x > r.seats),
                    borderColor: c.over,
                    backgroundColor: c.over + "55",
                    fill: "origin",
                    pointRadius: 0,
                    borderWidth: 1.5,
                    spanGaps: false,
                },
                {
                    label: `Мест: ${nf.format(r.seats)}`,
                    data: [{ x: r.seats, y: 0 }, { x: r.seats, y: ymax }],
                    borderColor: c.danger,
                    borderDash: [6, 4],
                    borderWidth: 2,
                    pointRadius: 0,
                },
                {
                    label: `Медиана «желают»: ${nf.format(r.wanted)}`,
                    data: [{ x: r.wanted, y: 0 }, { x: r.wanted, y: ymax }],
                    borderColor: c.text,
                    borderWidth: 1.5,
                    pointRadius: 0,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            parsing: false,
            plugins: {
                legend: { labels: { color: c.text, boxWidth: 14 } },
                tooltip: {
                    filter: (item) => item.datasetIndex < 2,
                    callbacks: {
                        title: (items) => {
                            const x = items[0].parsed.x ?? 0;
                            const iv = dens.find((d) => x >= d.from && x <= d.to) ?? dens[0];
                            return `С вероятностью 10% спрос будет от ${nf.format(Math.max(0, iv.from))} до ${nf.format(iv.to)}`;
                        },
                        label: () => "",
                    },
                },
            },
            scales: {
                x: {
                    type: "linear",
                    min: xmin,
                    max: xmax,
                    ticks: { color: c.muted, stepSize: unit, maxTicksLimit: 12, callback: (v) => nf.format(Number(v)) },
                    grid: { color: c.grid },
                    title: { display: true, text: "сколько человек захотят купить билет по этой цене", color: c.muted },
                },
                y: {
                    min: 0,
                    suggestedMax: ymax,
                    ticks: { color: c.muted, maxTicksLimit: 7, callback: (v) => `${Number(v).toFixed(1)}%` },
                    grid: { color: c.grid },
                    title: { display: true, text: "вероятность на 10 пассажиров", color: c.muted },
                },
            },
        },
    });
}
export function destroyCharts() {
    charts.forEach((ch) => ch.destroy());
    charts.clear();
}

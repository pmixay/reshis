import { api, ApiError } from "./api.js";
import { destroyCharts, renderDistribution, renderScenarios } from "./charts.js";
const $ = (id) => {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`#${id} not found`);
    return el;
};
const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const rub = (x) => `${nf.format(x)} ₽`;
const nf2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const money = (x) => (Math.abs(x) >= 1000000 ? `${nf2.format(x / 1000000)} млн ₽` : rub(x));
const pct = (x) => `${Math.round(x * 100)}%`;
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", weekday: "short" });
let meta = null;
let lastResult = null;
const STORAGE_KEY = "reshis:last-form";
// ---------------------------------------------------------------- views
function show(view) {
    $("auth-view").hidden = view !== "auth";
    $("app-view").hidden = view !== "app";
    $("user-box").hidden = view !== "app";
}
function setUser(user) {
    $("user-name").textContent = user.name;
    $("user-login").textContent = `@${user.login}`;
    show("app");
    void loadHistory();
}
function setError(id, message) {
    const el = $(id);
    el.textContent = message;
    el.hidden = !message;
}
function setBusy(button, busy) {
    button.disabled = busy;
    button.classList.toggle("is-busy", busy);
}
// ---------------------------------------------------------------- auth
function switchTab(tab) {
    $("tab-login").setAttribute("aria-selected", String(tab === "login"));
    $("tab-register").setAttribute("aria-selected", String(tab === "register"));
    $("login-form").hidden = tab !== "login";
    $("register-form").hidden = tab !== "register";
    setError("auth-error", "");
}
async function onLogin(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector("button[type=submit]");
    const data = new FormData(form);
    setBusy(btn, true);
    try {
        const { user } = await api.login(String(data.get("login")), String(data.get("password")));
        form.reset();
        setUser(user);
    }
    catch (err) {
        setError("auth-error", err.message);
    }
    finally {
        setBusy(btn, false);
    }
}
async function onRegister(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector("button[type=submit]");
    const data = new FormData(form);
    const password = String(data.get("password"));
    if (password !== String(data.get("password2"))) {
        setError("auth-error", "Пароли не совпадают");
        return;
    }
    setBusy(btn, true);
    try {
        const { user } = await api.register(String(data.get("login")), String(data.get("name")), password);
        form.reset();
        setUser(user);
    }
    catch (err) {
        setError("auth-error", err.message);
    }
    finally {
        setBusy(btn, false);
    }
}
async function onLogout() {
    await api.logout().catch(() => undefined);
    lastResult = null;
    destroyCharts();
    $("results").hidden = true;
    $("results-empty").hidden = false;
    switchTab("login");
    show("auth");
}
// ---------------------------------------------------------------- form
function routesFrom(origin) {
    return (meta?.routes ?? []).filter((r) => r.origin === origin);
}
function currentRoute() {
    const origin = $("origin").value;
    const dest = $("destination").value;
    return meta?.routes.find((r) => r.origin === origin && r.destination === dest);
}
function fillSelect(select, values) {
    const prev = select.value;
    select.replaceChildren(...values.map((v) => new Option(v, v)));
    if (values.includes(prev))
        select.value = prev;
}
function updatePriceHint() {
    const r = currentRoute();
    const price = $("price");
    if (!r)
        return;
    price.min = "1";
    price.placeholder = String(r.base_price);
    $("price-hint").textContent =
        `Базовая цена ${rub(r.base_price)} · обычный диапазон ${rub(r.price_min)} – ${rub(r.price_max)} · ` +
            `+1 000 ₽ к цене ≈ −${nf.format(r.price_sensitivity * 1000)} желающих`;
}
function initForm(m) {
    const origins = [...new Set(m.routes.map((r) => r.origin))];
    fillSelect($("origin"), origins);
    fillSelect($("destination"), routesFrom(origins[0]).map((r) => r.destination));
    const date = $("date");
    date.min = m.date_min;
    date.max = m.date_max;
    date.value = m.date_min;
    $("date-hint").textContent = `Прогноз есть на даты с ${fmtDate(m.date_min)} по ${fmtDate(m.date_max)}`;
    $("forecast-source").textContent = m.forecast_source;
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
        if (saved) {
            $("origin").value = saved.origin;
            fillSelect($("destination"), routesFrom(saved.origin).map((r) => r.destination));
            $("destination").value = saved.destination;
            if (saved.date >= m.date_min && saved.date <= m.date_max)
                date.value = saved.date;
            $("price").value = String(saved.price);
        }
    }
    catch {
        /* localStorage недоступен — работаем без него */
    }
    if (!$("price").value)
        $("price").value = String(currentRoute()?.base_price ?? "");
    updatePriceHint();
}
function readForm() {
    const origin = $("origin").value;
    const destination = $("destination").value;
    const date = $("date").value;
    const price = Number($("price").value);
    if (!origin || !destination)
        return "Выберите маршрут";
    if (!date)
        return "Укажите дату вылета";
    if (meta && (date < meta.date_min || date > meta.date_max))
        return `Прогноз есть только на даты с ${fmtDate(meta.date_min)} по ${fmtDate(meta.date_max)}`;
    if (!Number.isFinite(price) || price <= 0)
        return "Цена должна быть положительным числом";
    if (price >= 1000000)
        return "Слишком большая цена";
    return { origin, destination, date, price };
}
async function runForecast() {
    const req = readForm();
    if (typeof req === "string") {
        setError("form-error", req);
        return;
    }
    setError("form-error", "");
    const btn = $("submit-btn");
    setBusy(btn, true);
    try {
        const result = await api.forecast(req);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(req));
        }
        catch {
            /* ignore */
        }
        renderResult(result);
        void loadHistory();
    }
    catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            show("auth");
            setError("auth-error", "Сессия истекла — войдите снова");
            return;
        }
        setError("form-error", err.message);
    }
    finally {
        setBusy(btn, false);
    }
}
// ---------------------------------------------------------------- results
function renderResult(r) {
    lastResult = r;
    $("results-empty").hidden = true;
    $("results").hidden = false;
    $("res-title").textContent = `${r.route.origin} → ${r.route.destination}`;
    $("res-subtitle").textContent = `${fmtDate(r.date)} · цена билета ${rub(r.price)}`;
    $("kpi-seats").textContent = nf.format(r.seats);
    $("kpi-sold").textContent = nf.format(r.sold);
    $("kpi-free").textContent = nf.format(r.free_seats);
    $("kpi-load").textContent = pct(r.load_factor);
    $("kpi-wanted").textContent = nf.format(Math.round(r.wanted));
    $("kpi-base").textContent = nf.format(Math.round(r.base_demand_median));
    const sp = r.sellout_probability;
    $("kpi-sellout").textContent = sp.bound === "gt" ? `> ${pct(sp.p)}` : sp.bound === "lt" ? `< ${pct(sp.p)}` : pct(sp.p);
    $("kpi-revenue").textContent = money(r.revenue);
    $("kpi-profit").textContent = money(r.profit);
    $("kpi-rec").textContent = r.recommended_price ? rub(r.recommended_price) : "—";
    $("btn-rec-price").disabled = !r.recommended_price;
    const note = $("res-note");
    note.className = "note";
    if (r.sold >= r.seats) {
        note.classList.add("note-warn");
        note.textContent = `Продажи упираются в число мест: желающих ${nf.format(Math.round(r.wanted))}, а мест ${nf.format(r.seats)}. ` +
            `Цену можно поднять — самолёт всё равно заполнится.`;
    }
    else if (r.sold === 0) {
        note.classList.add("note-bad");
        note.textContent = "При такой цене билеты, скорее всего, не купят. Попробуйте снизить цену.";
    }
    else if (r.recommended_price && Math.abs(r.price - r.recommended_price) / r.recommended_price > 0.15) {
        note.classList.add("note-info");
        note.textContent = `Рекомендуемая цена для медианного сценария — ${rub(r.recommended_price)}: при ней прибыль по прогнозу выше.`;
    }
    else {
        note.classList.add("note-ok");
        note.textContent = `Свободных мест останется ${nf.format(r.free_seats)} из ${nf.format(r.seats)} (загрузка ${pct(r.load_factor)}).`;
    }
    const tbody = $("scenario-rows");
    tbody.replaceChildren(...r.scenarios.map((s) => {
        const tr = document.createElement("tr");
        if (s.quantile === 0.5)
            tr.className = "is-median";
        const cells = [
            s.quantile.toFixed(1),
            nf.format(Math.round(s.base_demand)),
            nf.format(Math.max(0, Math.round(s.wanted))),
            nf.format(s.sold),
            s.sold >= r.seats ? "да" : "нет",
            s.best_price ? rub(s.best_price) : "—",
        ];
        cells.forEach((c) => {
            const td = document.createElement("td");
            td.textContent = c;
            tr.append(td);
        });
        return tr;
    }));
    renderScenarios($("chart-scenarios"), r);
    renderDistribution($("chart-distribution"), r);
}
// ---------------------------------------------------------------- history
async function loadHistory() {
    try {
        const { items } = await api.history();
        renderHistory(items);
    }
    catch {
        /* история не критична */
    }
}
function renderHistory(items) {
    $("history-empty").hidden = items.length > 0;
    $("history-table").hidden = items.length === 0;
    $("history-rows").replaceChildren(...items.map((it) => {
        const tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.title = "Повторить расчёт";
        const [o, d] = it.name.split(" — ");
        [it.name, new Date(`${it.flight_date}T00:00:00`).toLocaleDateString("ru-RU"), rub(it.price), `${nf.format(it.sold)} / ${nf.format(it.seats)}`]
            .forEach((c) => {
            const td = document.createElement("td");
            td.textContent = c;
            tr.append(td);
        });
        const repeat = () => {
            $("origin").value = o;
            fillSelect($("destination"), routesFrom(o).map((r) => r.destination));
            $("destination").value = d;
            $("date").value = it.flight_date;
            $("price").value = String(it.price);
            updatePriceHint();
            void runForecast();
        };
        tr.addEventListener("click", repeat);
        tr.addEventListener("keydown", (e) => {
            if (e.key === "Enter")
                repeat();
        });
        return tr;
    }));
}
// ---------------------------------------------------------------- init
async function init() {
    $("tab-login").addEventListener("click", () => switchTab("login"));
    $("tab-register").addEventListener("click", () => switchTab("register"));
    $("login-form").addEventListener("submit", (e) => void onLogin(e));
    $("register-form").addEventListener("submit", (e) => void onRegister(e));
    $("logout-btn").addEventListener("click", () => void onLogout());
    $("forecast-form").addEventListener("submit", (e) => {
        e.preventDefault();
        void runForecast();
    });
    $("origin").addEventListener("change", () => {
        fillSelect($("destination"), routesFrom($("origin").value).map((r) => r.destination));
        updatePriceHint();
    });
    $("destination").addEventListener("change", () => {
        const r = currentRoute();
        if (r)
            $("price").value = String(r.base_price);
        updatePriceHint();
    });
    $("btn-base-price").addEventListener("click", () => {
        const r = currentRoute();
        if (r) {
            $("price").value = String(r.base_price);
            void runForecast();
        }
    });
    $("btn-rec-price").addEventListener("click", () => {
        if (lastResult?.recommended_price) {
            $("price").value = String(lastResult.recommended_price);
            void runForecast();
        }
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (lastResult)
            renderResult(lastResult);
    });
    try {
        meta = await api.meta();
        initForm(meta);
    }
    catch (err) {
        setError("auth-error", err.message);
    }
    try {
        const { user } = await api.me();
        if (user)
            setUser(user);
        else
            show("auth");
    }
    catch {
        show("auth");
    }
    document.body.classList.remove("is-loading");
}
void init();

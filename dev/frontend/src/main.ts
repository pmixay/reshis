import { api, ApiError } from "./api.js";
import { destroyCharts, renderDistribution, renderScenarios } from "./charts.js";
import type { ForecastRequest, ForecastResult, HistoryItem, Meta, RouteInfo, User } from "./types.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};
const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const rub = (x: number) => `${nf.format(x)} ₽`;
const nf2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const money = (x: number) => (Math.abs(x) >= 1_000_000 ? `${nf2.format(x / 1_000_000)} млн ₽` : rub(x));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", weekday: "short" });

let meta: Meta | null = null;
let lastResult: ForecastResult | null = null;
const STORAGE_KEY = "reshis:last-form";

// ---------------------------------------------------------------- views
function show(view: "auth" | "app"): void {
  $("auth-view").hidden = view !== "auth";
  $("app-view").hidden = view !== "app";
  $("user-box").hidden = view !== "app";
}

function setUser(user: User): void {
  $("user-name").textContent = user.name;
  show("app");
  void loadHistory();
}

function setError(id: string, message: string): void {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
}

// ---------------------------------------------------------------- auth
function switchTab(tab: "login" | "register"): void {
  $("tab-login").setAttribute("aria-selected", String(tab === "login"));
  $("tab-register").setAttribute("aria-selected", String(tab === "register"));
  $("login-form").hidden = tab !== "login";
  $("register-form").hidden = tab !== "register";
  setError("auth-error", "");
}

async function onLogin(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  const btn = form.querySelector("button[type=submit]") as HTMLButtonElement;
  const data = new FormData(form);
  setBusy(btn, true);
  try {
    const { user } = await api.login(String(data.get("login")), String(data.get("password")));
    form.reset();
    setUser(user);
  } catch (err) {
    setError("auth-error", (err as Error).message);
  } finally {
    setBusy(btn, false);
  }
}

async function onRegister(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  const btn = form.querySelector("button[type=submit]") as HTMLButtonElement;
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
  } catch (err) {
    setError("auth-error", (err as Error).message);
  } finally {
    setBusy(btn, false);
  }
}

async function onLogout(): Promise<void> {
  await api.logout().catch(() => undefined);
  lastResult = null;
  destroyCharts();
  $("results").hidden = true;
  $("results-empty").hidden = false;
  switchTab("login");
  show("auth");
}

// ---------------------------------------------------------------- form
function routesFrom(origin: string): RouteInfo[] {
  return (meta?.routes ?? []).filter((r) => r.origin === origin);
}

function currentRoute(): RouteInfo | undefined {
  const origin = $<HTMLSelectElement>("origin").value;
  const dest = $<HTMLSelectElement>("destination").value;
  return meta?.routes.find((r) => r.origin === origin && r.destination === dest);
}

function fillSelect(select: HTMLSelectElement, values: string[]): void {
  const prev = select.value;
  select.replaceChildren(...values.map((v) => new Option(v, v)));
  if (values.includes(prev)) select.value = prev;
}

function updatePriceHint(): void {
  const r = currentRoute();
  const price = $<HTMLInputElement>("price");
  if (!r) return;
  price.min = "1";
  price.placeholder = String(r.base_price);
  $("price-hint").textContent = `Базовая цена ${rub(r.base_price)}`;
}

function initForm(m: Meta): void {
  const origins = [...new Set(m.routes.map((r) => r.origin))];
  fillSelect($<HTMLSelectElement>("origin"), origins);
  fillSelect($<HTMLSelectElement>("destination"), routesFrom(origins[0]).map((r) => r.destination));
  const date = $<HTMLInputElement>("date");
  date.min = m.date_min;
  date.max = m.date_max;
  date.value = m.date_min;
  $("forecast-source").textContent = m.forecast_source;

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as ForecastRequest | null;
    if (saved) {
      $<HTMLSelectElement>("origin").value = saved.origin;
      fillSelect($<HTMLSelectElement>("destination"), routesFrom(saved.origin).map((r) => r.destination));
      $<HTMLSelectElement>("destination").value = saved.destination;
      if (saved.date >= m.date_min && saved.date <= m.date_max) date.value = saved.date;
      $<HTMLInputElement>("price").value = String(saved.price);
    }
  } catch {
    /* localStorage недоступен — работаем без него */
  }
  if (!$<HTMLInputElement>("price").value) $<HTMLInputElement>("price").value = String(currentRoute()?.base_price ?? "");
  updatePriceHint();
}

function readForm(): ForecastRequest | string {
  const origin = $<HTMLSelectElement>("origin").value;
  const destination = $<HTMLSelectElement>("destination").value;
  const date = $<HTMLInputElement>("date").value;
  const price = Number($<HTMLInputElement>("price").value);
  if (!origin || !destination) return "Выберите маршрут";
  if (!date) return "Укажите дату вылета";
  if (meta && (date < meta.date_min || date > meta.date_max))
    return `Прогноз есть только на даты с ${fmtDate(meta.date_min)} по ${fmtDate(meta.date_max)}`;
  if (!Number.isFinite(price) || price <= 0) return "Цена должна быть положительным числом";
  if (price >= 1_000_000) return "Слишком большая цена";
  return { origin, destination, date, price };
}

async function runForecast(): Promise<void> {
  const req = readForm();
  if (typeof req === "string") {
    setError("form-error", req);
    return;
  }
  setError("form-error", "");
  const btn = $<HTMLButtonElement>("submit-btn");
  setBusy(btn, true);
  try {
    const result = await api.forecast(req);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(req));
    } catch {
      /* ignore */
    }
    renderResult(result);
    void loadHistory();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      show("auth");
      setError("auth-error", "Сессия истекла, войдите снова");
      return;
    }
    setError("form-error", (err as Error).message);
  } finally {
    setBusy(btn, false);
  }
}

// ---------------------------------------------------------------- results
function renderResult(r: ForecastResult): void {
  lastResult = r;
  $("results-empty").hidden = true;
  $("results").hidden = false;
  $("res-title").textContent = `${r.route.origin} → ${r.route.destination}`;
  $("res-subtitle").textContent = `${fmtDate(r.date)}, ${rub(r.price)}`;

  $("kpi-seats").textContent = nf.format(r.seats);
  $("kpi-sold").textContent = nf.format(r.sold);
  $("kpi-free").textContent = nf.format(r.free_seats);
  $("kpi-load").textContent = pct(r.load_factor);
  $("kpi-wanted").textContent = nf.format(Math.round(r.wanted));
  const sp = r.sellout_probability;
  $("kpi-sellout").textContent = sp.bound === "gt" ? `> ${pct(sp.p)}` : sp.bound === "lt" ? `< ${pct(sp.p)}` : pct(sp.p);
  $("kpi-profit").textContent = money(r.profit);
  $("kpi-rec").textContent = r.recommended_price ? rub(r.recommended_price) : "нет данных";
  $<HTMLButtonElement>("btn-rec-price").disabled = !r.recommended_price;

  const note = $("res-note");
  note.className = "note";
  if (r.sold >= r.seats) {
    note.classList.add("note-warn");
    note.textContent = "Самолёт заполнится, цену можно поднять.";
  } else if (r.sold === 0) {
    note.classList.add("note-bad");
    note.textContent = "При такой цене билеты не купят.";
  } else if (r.recommended_price && Math.abs(r.price - r.recommended_price) / r.recommended_price > 0.15) {
    note.classList.add("note-info");
    note.textContent = `Лучшая цена по прогнозу: ${rub(r.recommended_price)}.`;
  } else {
    note.classList.add("note-ok");
    note.textContent = `Свободно ${nf.format(r.free_seats)} из ${nf.format(r.seats)} мест.`;
  }

  const tbody = $("scenario-rows");
  tbody.replaceChildren(
    ...r.scenarios.map((s) => {
      const tr = document.createElement("tr");
      if (s.quantile === 0.5) tr.className = "is-median";
      const cells = [
        s.quantile.toFixed(1),
        nf.format(Math.round(s.base_demand)),
        nf.format(Math.max(0, Math.round(s.wanted))),
        nf.format(s.sold),
        s.best_price ? rub(s.best_price) : "",
      ];
      cells.forEach((c) => {
        const td = document.createElement("td");
        td.textContent = c;
        tr.append(td);
      });
      return tr;
    }),
  );
  renderScenarios($<HTMLCanvasElement>("chart-scenarios"), r);
  renderDistribution($<HTMLCanvasElement>("chart-distribution"), r);
}

// ---------------------------------------------------------------- history
async function loadHistory(): Promise<void> {
  try {
    const { items } = await api.history();
    renderHistory(items);
  } catch {
    /* история не критична */
  }
}

function renderHistory(items: HistoryItem[]): void {
  $("history-empty").hidden = items.length > 0;
  $("history-table").hidden = items.length === 0;
  $("history-rows").replaceChildren(
    ...items.map((it) => {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      tr.title = "Повторить расчёт";
      const [o, d] = it.name.split(" — ");
      [`${o} → ${d}`, new Date(`${it.flight_date}T00:00:00`).toLocaleDateString("ru-RU"), rub(it.price), `${nf.format(it.sold)} из ${nf.format(it.seats)}`]
        .forEach((c) => {
          const td = document.createElement("td");
          td.textContent = c;
          tr.append(td);
        });
      const repeat = () => {
        $<HTMLSelectElement>("origin").value = o;
        fillSelect($<HTMLSelectElement>("destination"), routesFrom(o).map((r) => r.destination));
        $<HTMLSelectElement>("destination").value = d;
        $<HTMLInputElement>("date").value = it.flight_date;
        $<HTMLInputElement>("price").value = String(it.price);
        updatePriceHint();
        void runForecast();
      };
      tr.addEventListener("click", repeat);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter") repeat();
      });
      return tr;
    }),
  );
}

// ---------------------------------------------------------------- init
async function init(): Promise<void> {
  $("tab-login").addEventListener("click", () => switchTab("login"));
  $("tab-register").addEventListener("click", () => switchTab("register"));
  $<HTMLFormElement>("login-form").addEventListener("submit", (e) => void onLogin(e as SubmitEvent));
  $<HTMLFormElement>("register-form").addEventListener("submit", (e) => void onRegister(e as SubmitEvent));
  $("logout-btn").addEventListener("click", () => void onLogout());
  $<HTMLFormElement>("forecast-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void runForecast();
  });
  $("origin").addEventListener("change", () => {
    fillSelect($<HTMLSelectElement>("destination"), routesFrom($<HTMLSelectElement>("origin").value).map((r) => r.destination));
    updatePriceHint();
  });
  $("destination").addEventListener("change", () => {
    const r = currentRoute();
    if (r) $<HTMLInputElement>("price").value = String(r.base_price);
    updatePriceHint();
  });
  $("btn-base-price").addEventListener("click", () => {
    const r = currentRoute();
    if (r) {
      $<HTMLInputElement>("price").value = String(r.base_price);
      void runForecast();
    }
  });
  $("btn-rec-price").addEventListener("click", () => {
    if (lastResult?.recommended_price) {
      $<HTMLInputElement>("price").value = String(lastResult.recommended_price);
      void runForecast();
    }
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (lastResult) renderResult(lastResult);
  });

  try {
    meta = await api.meta();
    initForm(meta);
  } catch (err) {
    setError("auth-error", (err as Error).message);
  }
  try {
    const { user } = await api.me();
    if (user) setUser(user);
    else show("auth");
  } catch {
    show("auth");
  }
  document.body.classList.remove("is-loading");
}

void init();

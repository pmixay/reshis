import type { ForecastRequest, ForecastResult, HistoryItem, Meta, User } from "./types.js";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Сервер недоступен. Проверьте подключение к интернету.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, describeError(data, res.status));
  }
  return data as T;
}

function describeError(data: unknown, status: number): string {
  const detail = (data as { detail?: unknown })?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    // ошибки валидации FastAPI: [{loc: [...], msg: "..."}]
    return detail.map((d: { loc?: string[]; msg?: string }) => `${(d.loc ?? []).slice(-1)[0] ?? ""}: ${d.msg ?? ""}`).join("; ");
  }
  return `Ошибка сервера (${status})`;
}

export const api = {
  meta: () => request<Meta>("GET", "/api/meta"),
  me: () => request<{ user: User | null }>("GET", "/api/auth/me"),
  login: (login: string, password: string) => request<{ user: User }>("POST", "/api/auth/login", { login, password }),
  register: (login: string, name: string, password: string) =>
    request<{ user: User }>("POST", "/api/auth/register", { login, name, password }),
  logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout", {}),
  forecast: (req: ForecastRequest) => request<ForecastResult>("POST", "/api/forecast", req),
  history: () => request<{ items: HistoryItem[] }>("GET", "/api/history"),
};

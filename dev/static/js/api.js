export class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
async function request(method, url, body) {
    let res;
    try {
        res = await fetch(url, {
            method,
            credentials: "same-origin",
            headers: body !== undefined ? { "Content-Type": "application/json" } : {},
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    }
    catch {
        throw new ApiError(0, "Сервер недоступен. Проверьте подключение к интернету.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new ApiError(res.status, describeError(data, res.status));
    }
    return data;
}
function describeError(data, status) {
    const detail = data?.detail;
    if (typeof detail === "string")
        return detail;
    if (Array.isArray(detail) && detail.length > 0) {
        // ошибки валидации FastAPI: [{loc: [...], msg: "..."}]
        return detail.map((d) => `${(d.loc ?? []).slice(-1)[0] ?? ""}: ${d.msg ?? ""}`).join("; ");
    }
    return `Ошибка сервера (${status})`;
}
export const api = {
    meta: () => request("GET", "/api/meta"),
    me: () => request("GET", "/api/auth/me"),
    login: (login, password) => request("POST", "/api/auth/login", { login, password }),
    register: (login, name, password) => request("POST", "/api/auth/register", { login, name, password }),
    logout: () => request("POST", "/api/auth/logout", {}),
    forecast: (req) => request("POST", "/api/forecast", req),
    history: () => request("GET", "/api/history"),
};

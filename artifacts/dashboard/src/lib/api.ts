const BASE = "/api";

export function getToken(): string | null {
  return localStorage.getItem("nutter_token");
}

export function setToken(token: string): void {
  localStorage.setItem("nutter_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("nutter_token");
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (t) headers["Authorization"] = `Bearer ${t}`;
  return headers;
}

async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...authHeaders(), ...((opts.headers as Record<string, string>) ?? {}) },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  return res;
}

export async function register(email: string, username: string, password: string): Promise<{ token: string; account: Account }> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Registration failed");
  return data;
}

export async function login(loginVal: string, password: string): Promise<{ token: string; account: Account }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: loginVal, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");
  return data;
}

export interface Account {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

export interface Bot {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  linkedAt: string | null;
  lastSeen: string | null;
  isFirstConnection: string;
  connected: boolean;
  hasQR: boolean;
}

export async function getMe(): Promise<{ account: Account; bots: Bot[] }> {
  const res = await apiFetch("/auth/me");
  return res.json();
}

export async function getBots(): Promise<Bot[]> {
  const res = await apiFetch("/bots");
  return res.json();
}

export async function createBot(name: string): Promise<Bot> {
  const res = await apiFetch("/bots", { method: "POST", body: JSON.stringify({ name }) });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || "Failed to create bot");
  return data;
}

export async function deleteBot(botId: string): Promise<void> {
  await apiFetch(`/bots/${botId}`, { method: "DELETE" });
}

export async function renameBot(botId: string, name: string): Promise<Bot> {
  const res = await apiFetch(`/bots/${botId}/name`, { method: "PATCH", body: JSON.stringify({ name }) });
  return res.json();
}

export async function startPairing(botId: string, phone: string): Promise<{ code: string }> {
  const res = await apiFetch(`/bots/${botId}/pair`, { method: "POST", body: JSON.stringify({ phone }) });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || "Failed to pair");
  return data;
}

export async function startQR(botId: string): Promise<void> {
  await apiFetch(`/bots/${botId}/qr-start`, { method: "POST" });
}

export async function getQR(botId: string): Promise<{ qr: string | null; available: boolean }> {
  const res = await apiFetch(`/bots/${botId}/qr`, { cache: "no-store" });
  return res.json();
}

export async function getBotStatus(botId: string): Promise<{ connected: boolean; status: string; phone: string | null; name: string; lastSeen: string | null }> {
  const res = await apiFetch(`/bots/${botId}/status`);
  return res.json();
}

export async function getBotSettings(botId: string): Promise<Record<string, unknown>> {
  const res = await apiFetch(`/bots/${botId}/settings`);
  return res.json();
}

export async function updateBotSettings(botId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await apiFetch(`/bots/${botId}/settings`, { method: "PATCH", body: JSON.stringify(data) });
  return res.json();
}

export async function disconnectBot(botId: string): Promise<void> {
  await apiFetch(`/bots/${botId}/disconnect`, { method: "POST" });
}

export async function adminLogin(username: string, adminKey: string): Promise<{ token: string; username: string }> {
  const res = await fetch(`${BASE}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, adminKey }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || "Invalid credentials");
  return data;
}

function adminH(token: string): Record<string, string> {
  return { "x-admin-token": token };
}

export async function adminGetAccounts(token: string): Promise<unknown[]> {
  const res = await fetch(`${BASE}/admin/accounts`, { headers: adminH(token) });
  return res.json();
}

export async function adminGetBots(token: string): Promise<unknown[]> {
  const res = await fetch(`${BASE}/admin/bots`, { headers: adminH(token) });
  return res.json();
}

export async function adminGetAccountDetail(token: string, id: string): Promise<unknown> {
  const res = await fetch(`${BASE}/admin/accounts/${id}`, { headers: adminH(token) });
  return res.json();
}

export async function adminGetBotSettings(token: string, botId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/admin/bots/${botId}/settings`, { headers: adminH(token) });
  return res.json();
}

export async function adminDisconnectBot(token: string, id: string): Promise<unknown> {
  return (await fetch(`${BASE}/admin/bots/${id}/disconnect`, { method: "POST", headers: adminH(token) })).json();
}

export async function adminSuspendBot(token: string, id: string): Promise<unknown> {
  return (await fetch(`${BASE}/admin/bots/${id}/suspend`, { method: "POST", headers: adminH(token) })).json();
}

export async function adminDeleteBot(token: string, id: string): Promise<unknown> {
  return (await fetch(`${BASE}/admin/bots/${id}`, { method: "DELETE", headers: adminH(token) })).json();
}

export async function adminDeleteAccount(token: string, id: string): Promise<unknown> {
  return (await fetch(`${BASE}/admin/accounts/${id}`, { method: "DELETE", headers: adminH(token) })).json();
}

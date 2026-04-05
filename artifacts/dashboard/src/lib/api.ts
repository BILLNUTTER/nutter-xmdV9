const BASE = "/api";

function getUserToken(): string | null {
  return localStorage.getItem("nutter_user_token");
}

function getAdminToken(): string | null {
  return sessionStorage.getItem("nutter_admin_token");
}

function authHeaders(token: string): Record<string, string> {
  return { "x-user-token": token };
}

export async function pairBot(phone: string): Promise<{
  pairingCode: string | null;
  userId: string;
  userToken: string;
  message?: string;
}> {
  const res = await fetch(`${BASE}/bot/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || "Failed to pair");
  }
  return res.json();
}

export async function getBotStatus(userId: string, token?: string | null): Promise<{
  connected: boolean;
  status: string;
  lastSeen: string | null;
}> {
  const headers: Record<string, string> = {};
  const t = token ?? getUserToken();
  if (t) headers["x-user-token"] = t;
  const res = await fetch(`${BASE}/bot/status/${userId}`, { headers });
  if (!res.ok) return { connected: false, status: "unknown", lastSeen: null };
  return res.json();
}

export async function getSettings(userId: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/settings/${userId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error("Settings not found");
  return res.json();
}

export async function updateSettings(userId: string, token: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/settings/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update settings");
  return res.json();
}

export async function adminLogin(username: string, adminKey: string): Promise<{ token: string; username: string }> {
  const res = await fetch(`${BASE}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, adminKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || "Invalid credentials");
  }
  return res.json();
}

function adminAuthHeaders(token: string): Record<string, string> {
  return { "x-admin-token": token };
}

export async function adminGetUsers(token: string): Promise<unknown[]> {
  const res = await fetch(`${BASE}/admin/users`, {
    headers: adminAuthHeaders(token),
  });
  if (!res.ok) throw new Error("Unauthorized");
  return res.json();
}

export async function adminGetUserSession(token: string, userId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/admin/users/${userId}/session`, {
    headers: adminAuthHeaders(token),
  });
  return res.json();
}

export async function adminGetUserSettings(token: string, userId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/admin/users/${userId}/settings`, {
    headers: adminAuthHeaders(token),
  });
  return res.json();
}

export async function adminDisconnectUser(token: string, userId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/admin/users/${userId}/disconnect`, {
    method: "POST",
    headers: adminAuthHeaders(token),
  });
  return res.json();
}

export async function adminPauseUser(token: string, userId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/admin/users/${userId}/pause`, {
    method: "POST",
    headers: adminAuthHeaders(token),
  });
  return res.json();
}

export async function adminSuspendUser(token: string, userId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/admin/users/${userId}/suspend`, {
    method: "POST",
    headers: adminAuthHeaders(token),
  });
  return res.json();
}

export async function adminDeleteUser(token: string, userId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminAuthHeaders(token),
  });
  return res.json();
}

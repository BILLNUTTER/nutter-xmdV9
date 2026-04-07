import { useState, useEffect } from "react";
import {
  adminLogin, adminGetAccounts, adminGetBotSettings,
  adminSuspendBot, adminActivateBot, adminDeleteBot, adminDisconnectBot, adminDeleteAccount
} from "@/lib/api";

interface AdminBot {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  connected: boolean;
  linkedAt: string | null;
  lastSeen: string | null;
}

interface AdminAccount {
  id: string;
  email: string;
  username: string;
  createdAt: string;
  bots: AdminBot[];
}

interface ConfirmAction {
  type: "disconnect" | "suspend" | "activate" | "delete-bot" | "delete-account";
  id: string;
  label: string;
}

export default function Admin() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem("nutter_admin_token"));
  const [username, setUsername] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [botSettings, setBotSettings] = useState<Record<string, unknown>>({});
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  useEffect(() => {
    if (token) loadAccounts();
  }, [token]);

  async function handleLogin() {
    setLoginLoading(true);
    setLoginError("");
    try {
      const result = await adminLogin(username, adminKey);
      sessionStorage.setItem("nutter_admin_token", result.token);
      setToken(result.token);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoginLoading(false);
    }
  }

  async function loadAccounts() {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const data = await adminGetAccounts(token) as AdminAccount[];
      if (!Array.isArray(data)) throw new Error("Unexpected response from server");
      setAccounts(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load accounts";
      if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("Invalid credentials") || msg.includes("not configured")) {
        sessionStorage.removeItem("nutter_admin_token");
        setToken(null);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function toggleAccount(accountId: string, bots: AdminBot[]) {
    if (expandedAccount === accountId) { setExpandedAccount(null); return; }
    setExpandedAccount(accountId);
    for (const bot of bots) {
      try {
        const s = await adminGetBotSettings(token!, bot.id);
        setBotSettings(prev => ({ ...prev, [bot.id]: s }));
      } catch (_) {}
    }
  }

  async function executeAction(action: ConfirmAction) {
    if (!token) return;
    try {
      if (action.type === "disconnect") await adminDisconnectBot(token, action.id);
      if (action.type === "suspend") await adminSuspendBot(token, action.id);
      if (action.type === "activate") await adminActivateBot(token, action.id);
      if (action.type === "delete-bot") await adminDeleteBot(token, action.id);
      if (action.type === "delete-account") await adminDeleteAccount(token, action.id);
      setSuccess(`Action completed: ${action.type}`);
      setTimeout(() => setSuccess(""), 3000);
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setConfirmAction(null);
    }
  }

  const totalBots = accounts.reduce((a, acc) => a + acc.bots.length, 0);
  const connectedBots = accounts.reduce((a, acc) => a + acc.bots.filter(b => b.connected).length, 0);

  if (!token) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#080d1a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ background: "#0d1a2e", border: "1px solid #1e3a5f", borderRadius: "1rem", padding: "2.5rem", width: "100%", maxWidth: 420, boxShadow: "0 0 40px rgba(168,85,247,0.15)" }}>
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div style={{ fontSize: "3rem" }}>🔐</div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, background: "linear-gradient(135deg, #00d4ff, #a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginTop: "0.5rem" }}>Admin Panel</h1>
            <p style={{ color: "#64748b", fontSize: "0.875rem", marginTop: "0.25rem" }}>NUTTER-XMD V.9.1.3</p>
          </div>

          {loginError && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1rem", color: "#fca5a5", fontSize: "0.875rem" }}>❌ {loginError}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>Username</label>
              <input type="text" placeholder="Admin username" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ width: "100%", boxSizing: "border-box", background: "#0a1628", border: "1px solid #1e3a5f", color: "#e2e8f0", borderRadius: "0.5rem", padding: "0.7rem 1rem", outline: "none" }} />
            </div>
            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>Admin Key</label>
              <input type="password" placeholder="Admin key" value={adminKey} onChange={e => setAdminKey(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ width: "100%", boxSizing: "border-box", background: "#0a1628", border: "1px solid #1e3a5f", color: "#e2e8f0", borderRadius: "0.5rem", padding: "0.7rem 1rem", outline: "none" }} />
            </div>
            <button onClick={handleLogin} disabled={loginLoading} style={{ background: loginLoading ? "#334155" : "linear-gradient(135deg, #00d4ff, #a855f7)", color: "white", fontWeight: 700, border: "none", borderRadius: "0.5rem", padding: "0.875rem", cursor: loginLoading ? "not-allowed" : "pointer", fontSize: "1rem" }}>
              {loginLoading ? "Logging in..." : "🔓 Login"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#080d1a", fontFamily: "'Inter', system-ui, sans-serif", color: "#e2e8f0" }}>
      <header style={{ background: "rgba(13,26,46,0.95)", borderBottom: "1px solid #1e3a5f", padding: "1rem 2rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 800, background: "linear-gradient(135deg, #a855f7, #00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>🔐 Admin Panel</h1>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={loadAccounts} style={{ background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", color: "#00d4ff", borderRadius: "0.4rem", padding: "0.4rem 1rem", cursor: "pointer", fontSize: "0.875rem" }}>🔄 Refresh</button>
          <button onClick={() => { sessionStorage.removeItem("nutter_admin_token"); setToken(null); }} style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5", borderRadius: "0.4rem", padding: "0.4rem 1rem", cursor: "pointer", fontSize: "0.875rem" }}>Logout</button>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1rem" }}>
        {error && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "0.5rem", padding: "0.75rem 1rem", marginBottom: "1.25rem", color: "#fca5a5" }}>❌ {error}</div>}
        {success && <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: "0.5rem", padding: "0.75rem 1rem", marginBottom: "1.25rem", color: "#86efac" }}>✅ {success}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
          {[
            { label: "Accounts", value: accounts.length, icon: "👤", color: "#00d4ff" },
            { label: "Total Bots", value: totalBots, icon: "🤖", color: "#a855f7" },
            { label: "Connected", value: connectedBots, icon: "🟢", color: "#22c55e" },
            { label: "Offline", value: totalBots - connectedBots, icon: "🔴", color: "#ef4444" },
          ].map(stat => (
            <div key={stat.label} style={{ background: "#0d1a2e", border: "1px solid #1e3a5f", borderRadius: "0.75rem", padding: "1.25rem", textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem" }}>{stat.icon}</div>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: stat.color }}>{stat.value}</div>
              <div style={{ color: "#64748b", fontSize: "0.8rem" }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>Loading accounts...</div>
        ) : accounts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "#64748b", background: "#0d1a2e", border: "1px solid #1e3a5f", borderRadius: "1rem" }}>No accounts yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {accounts.map(account => (
              <div key={account.id} style={{ background: "#0d1a2e", border: "1px solid #1e3a5f", borderRadius: "0.875rem", overflow: "hidden" }}>
                <div
                  onClick={() => toggleAccount(account.id, account.bots)}
                  style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", gap: "1rem" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem" }}>👤</div>
                    <div>
                      <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "0.95rem" }}>@{account.username}</div>
                      <div style={{ color: "#64748b", fontSize: "0.78rem" }}>{account.email} · {account.bots.length} bot{account.bots.length !== 1 ? "s" : ""}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    {account.bots.some(b => b.connected) && (
                      <span style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", color: "#86efac", borderRadius: "0.4rem", padding: "0.2rem 0.6rem", fontSize: "0.75rem", fontWeight: 600 }}>LIVE</span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmAction({ type: "delete-account", id: account.id, label: `account @${account.username}` }); }}
                      style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5", borderRadius: "0.4rem", padding: "0.25rem 0.6rem", cursor: "pointer", fontSize: "0.75rem" }}
                    >Delete Account</button>
                    <span style={{ color: "#64748b", fontSize: "1.1rem" }}>{expandedAccount === account.id ? "▲" : "▼"}</span>
                  </div>
                </div>

                {expandedAccount === account.id && (
                  <div style={{ borderTop: "1px solid #1e3a5f", padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {account.bots.length === 0 ? (
                      <p style={{ color: "#64748b", fontSize: "0.85rem" }}>No bots on this account.</p>
                    ) : (
                      account.bots.map(bot => (
                        <div key={bot.id} style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: "0.75rem", padding: "1rem" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: bot.connected ? "#22c55e" : "#64748b", display: "inline-block", boxShadow: bot.connected ? "0 0 5px #22c55e" : "none" }} />
                              <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "0.9rem" }}>{bot.name}</span>
                              {bot.phone && <span style={{ color: "#64748b", fontSize: "0.8rem" }}>+{bot.phone}</span>}
                              <span style={{ background: bot.status === "active" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: bot.status === "active" ? "#86efac" : "#fca5a5", border: `1px solid ${bot.status === "active" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: "0.25rem", padding: "0.1rem 0.45rem", fontSize: "0.72rem", fontWeight: 600 }}>{bot.status}</span>
                            </div>
                            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                              {bot.connected && (
                                <button onClick={() => setConfirmAction({ type: "disconnect", id: bot.id, label: `bot "${bot.name}"` })} style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", color: "#fbbf24", borderRadius: "0.35rem", padding: "0.25rem 0.6rem", cursor: "pointer", fontSize: "0.75rem" }}>Disconnect</button>
                              )}
                              {bot.status !== "suspended" ? (
                                <button onClick={() => setConfirmAction({ type: "suspend", id: bot.id, label: `bot "${bot.name}"` })} style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5", borderRadius: "0.35rem", padding: "0.25rem 0.6rem", cursor: "pointer", fontSize: "0.75rem" }}>Suspend</button>
                              ) : (
                                <button onClick={() => setConfirmAction({ type: "activate", id: bot.id, label: `bot "${bot.name}"` })} style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#86efac", borderRadius: "0.35rem", padding: "0.25rem 0.6rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>✓ Activate</button>
                              )}
                              <button onClick={() => setConfirmAction({ type: "delete-bot", id: bot.id, label: `bot "${bot.name}"` })} style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: "0.35rem", padding: "0.25rem 0.6rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>Delete Bot</button>
                            </div>
                          </div>
                          {bot.lastSeen && <p style={{ color: "#64748b", fontSize: "0.75rem", margin: "0.5rem 0 0" }}>Last seen: {new Date(bot.lastSeen).toLocaleString()}</p>}
                          {botSettings[bot.id] && (
                            <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                              {Object.entries(botSettings[bot.id] as Record<string, unknown>)
                                .filter(([k]) => typeof (botSettings[bot.id] as Record<string, unknown>)[k] === "boolean" && k !== "userId")
                                .map(([k, v]) => (
                                  <span key={k} style={{ background: v ? "rgba(34,197,94,0.06)" : "rgba(100,116,139,0.08)", border: `1px solid ${v ? "rgba(34,197,94,0.2)" : "rgba(100,116,139,0.15)"}`, borderRadius: "0.25rem", padding: "0.1rem 0.4rem", fontSize: "0.7rem", color: v ? "#86efac" : "#475569" }}>{k}: {v ? "on" : "off"}</span>
                                ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmAction && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "#0d1a2e", border: "1px solid #1e3a5f", borderRadius: "1rem", padding: "2rem", maxWidth: 400, width: "100%", margin: "0 1rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 700, marginBottom: "0.75rem", textTransform: "capitalize" }}>Confirm Action</h3>
            {confirmAction.type === "activate" ? (
              <p style={{ color: "#94a3b8", marginBottom: "1.5rem" }}>
                Activate {confirmAction.label}? The user will be able to link their bot again.
              </p>
            ) : (
              <p style={{ color: "#94a3b8", marginBottom: "1.5rem" }}>
                Are you sure you want to <strong style={{ color: "#e2e8f0" }}>{confirmAction.type.replace(/-/g, " ")}</strong> {confirmAction.label}?
                {(confirmAction.type === "delete-bot" || confirmAction.type === "delete-account") && " This cannot be undone."}
                {confirmAction.type === "suspend" && " The user will not be able to link until reactivated."}
              </p>
            )}
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmAction(null)} style={{ background: "rgba(71,85,105,0.3)", border: "1px solid #1e3a5f", color: "#94a3b8", borderRadius: "0.5rem", padding: "0.6rem 1.25rem", cursor: "pointer" }}>Cancel</button>
              <button onClick={() => executeAction(confirmAction)} style={{
                background: confirmAction.type === "activate" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                border: `1px solid ${confirmAction.type === "activate" ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"}`,
                color: confirmAction.type === "activate" ? "#86efac" : "#fca5a5",
                borderRadius: "0.5rem", padding: "0.6rem 1.25rem", cursor: "pointer", fontWeight: 600
              }}>
                {confirmAction.type === "activate" ? "✓ Activate" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { pairBot, getBotStatus, getSettings, updateSettings } from "@/lib/api";

const TOGGLE_FEATURES = [
  { key: "anticall", label: "Anti Call", icon: "📵", desc: "Reject incoming calls" },
  { key: "antilink", label: "Anti Link", icon: "🔗", desc: "Remove links in groups" },
  { key: "antisticker", label: "Anti Sticker", icon: "🎭", desc: "Remove stickers in groups" },
  { key: "antitag", label: "Anti Tag", icon: "🏷️", desc: "Block @everyone tags" },
  { key: "antibadword", label: "Anti Bad Word", icon: "🤬", desc: "Filter offensive words" },
  { key: "antispam", label: "Anti Spam", icon: "🛡️", desc: "Kick spam senders" },
  { key: "antidelete", label: "Anti Delete", icon: "🔄", desc: "Recover deleted messages" },
  { key: "chatbot", label: "Auto Reply", icon: "🤖", desc: "Auto-reply in DMs" },
  { key: "autoread", label: "Auto Read", icon: "👁️", desc: "Auto-read messages" },
  { key: "alwaysonline", label: "Always Online", icon: "🟢", desc: "Stay always online" },
  { key: "autoviewstatus", label: "Auto View Status", icon: "👀", desc: "Auto-view status updates" },
  { key: "autolikestatus", label: "Auto Like Status", icon: "❤️", desc: "React to status updates" },
  { key: "autotype", label: "Typing Indicator", icon: "⌨️", desc: "Show typing when responding" },
  { key: "welcome", label: "Welcome Message", icon: "👋", desc: "Greet new group members" },
  { key: "goodbye", label: "Goodbye Message", icon: "💫", desc: "Farewell message on leave" },
];

interface BotStatus {
  connected: boolean;
  status: string;
  phone?: string;
  lastSeen: string | null;
}

export default function Home() {
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem("nutter_user_id"));
  const [userToken, setUserToken] = useState<string | null>(() => localStorage.getItem("nutter_user_token"));
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeTab, setActiveTab] = useState<"pair" | "settings">("pair");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (userId) {
      pollStatus(userId);
      pollRef.current = setInterval(() => pollStatus(userId), 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [userId]);

  useEffect(() => {
    if (userId && userToken) {
      loadSettings(userId, userToken);
    }
  }, [userId, userToken]);

  async function pollStatus(uid: string) {
    try {
      const s = await getBotStatus(uid);
      setBotStatus(s);
    } catch (_) {}
  }

  async function loadSettings(uid: string, token: string) {
    try {
      const s = await getSettings(uid, token);
      setSettings(s);
    } catch (_) {}
  }

  async function handlePair() {
    setError("");
    setPairingCode(null);
    if (!phone.trim()) {
      setError("Please enter your phone number");
      return;
    }
    setLoading(true);
    try {
      const result = await pairBot(phone);
      setUserId(result.userId);
      setUserToken(result.userToken);
      localStorage.setItem("nutter_user_id", result.userId);
      localStorage.setItem("nutter_user_token", result.userToken);

      if (result.pairingCode) {
        setPairingCode(result.pairingCode);
        setSuccess("Pairing code generated! Enter it in WhatsApp → Linked Devices → Link with Phone Number.");
      } else {
        setSuccess(result.message || "Bot already connected!");
      }

      await pollStatus(result.userId);
      await loadSettings(result.userId, result.userToken);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to pair bot";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(key: string, value: boolean) {
    if (!userId || !userToken) return;
    setSavingKey(key);
    try {
      const updated = await updateSettings(userId, userToken, { [key]: value });
      setSettings(updated);
    } catch (_) {
    } finally {
      setSavingKey(null);
    }
  }

  async function handleTextSetting(key: string, value: string) {
    if (!userId || !userToken) return;
    setSavingKey(key);
    try {
      const updated = await updateSettings(userId, userToken, { [key]: value });
      setSettings(updated);
      setSuccess("Settings saved!");
      setTimeout(() => setSuccess(""), 2000);
    } catch (_) {
    } finally {
      setSavingKey(null);
    }
  }

  function handleLogout() {
    localStorage.removeItem("nutter_user_id");
    localStorage.removeItem("nutter_user_token");
    setUserId(null);
    setUserToken(null);
    setSettings(null);
    setBotStatus(null);
    setPairingCode(null);
    setPhone("");
  }

  const isConnected = botStatus?.connected;

  return (
    <div className="min-h-screen cyber-grid" style={{ backgroundColor: "#080d1a" }}>
      <header style={{
        background: "linear-gradient(135deg, rgba(0,212,255,0.05) 0%, rgba(168,85,247,0.05) 100%)",
        borderBottom: "1px solid #1e3a5f",
        padding: "1.5rem 2rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
        <div>
          <h1 style={{
            fontSize: "1.75rem",
            fontWeight: 800,
            background: "linear-gradient(135deg, #00d4ff 0%, #a855f7 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.02em"
          }}>
            ⚡ NUTTER-XMD
          </h1>
          <p style={{ color: "#64748b", fontSize: "0.85rem", marginTop: "0.25rem" }}>
            WhatsApp Bot Platform — V.9.1.3
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {userId && botStatus && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{
                width: 10, height: 10, borderRadius: "50%",
                backgroundColor: isConnected ? "#22c55e" : "#ef4444",
                boxShadow: isConnected ? "0 0 8px #22c55e" : "0 0 8px #ef4444",
                display: "inline-block"
              }} />
              <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                {isConnected ? "Connected" : botStatus.status === "paused" ? "Paused" : "Disconnected"}
              </span>
            </div>
          )}
          {userId && (
            <button
              onClick={handleLogout}
              style={{ color: "#64748b", fontSize: "0.8rem", background: "none", border: "none", cursor: "pointer" }}
            >
              Log Out
            </button>
          )}
        </div>
      </header>

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "0.5rem", padding: "0.75rem 1rem", marginBottom: "1.5rem", color: "#fca5a5" }}>
            ❌ {error}
          </div>
        )}
        {success && (
          <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "0.5rem", padding: "0.75rem 1rem", marginBottom: "1.5rem", color: "#86efac" }}>
            ✅ {success}
          </div>
        )}

        {userId && (
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem" }}>
            {(["pair", "settings"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "0.5rem",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  border: "none",
                  cursor: "pointer",
                  background: activeTab === tab
                    ? "linear-gradient(135deg, #00d4ff, #a855f7)"
                    : "rgba(30,58,95,0.5)",
                  color: activeTab === tab ? "white" : "#64748b",
                  transition: "all 0.2s"
                }}
              >
                {tab === "pair" ? "🔗 Connect Bot" : "⚙️ Settings"}
              </button>
            ))}
          </div>
        )}

        {(!userId || activeTab === "pair") && (
          <div style={{
            background: "#0d1a2e",
            border: "1px solid #1e3a5f",
            borderRadius: "1rem",
            padding: "2rem",
            marginBottom: "2rem"
          }}>
            <h2 style={{ color: "#00d4ff", fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              🔗 Connect WhatsApp Bot
            </h2>
            <p style={{ color: "#64748b", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
              Enter your WhatsApp phone number with country code to receive an 8-digit pairing code.
            </p>

            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
              <input
                type="tel"
                placeholder="e.g. 2349012345678"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handlePair()}
                style={{
                  flex: 1, minWidth: "200px",
                  background: "#0a1628", border: "1px solid #1e3a5f",
                  color: "#e2e8f0", borderRadius: "0.5rem",
                  padding: "0.75rem 1rem", fontSize: "1rem"
                }}
              />
              <button
                onClick={handlePair}
                disabled={loading}
                style={{
                  background: loading ? "#334155" : "linear-gradient(135deg, #00d4ff, #a855f7)",
                  color: "white", fontWeight: 700, border: "none",
                  borderRadius: "0.5rem", padding: "0.75rem 2rem",
                  cursor: loading ? "not-allowed" : "pointer", fontSize: "1rem"
                }}
              >
                {loading ? "⏳ Generating..." : "Get Code"}
              </button>
            </div>

            {pairingCode && (
              <div>
                <div style={{
                  fontFamily: "'Courier New', monospace",
                  fontSize: "2.5rem",
                  fontWeight: 800,
                  letterSpacing: "0.6rem",
                  color: "#00d4ff",
                  textShadow: "0 0 20px rgba(0,212,255,0.6)",
                  textAlign: "center",
                  padding: "1.5rem",
                  background: "rgba(0,212,255,0.05)",
                  border: "1px solid rgba(0,212,255,0.2)",
                  borderRadius: "0.75rem",
                  marginBottom: "1rem"
                }}>
                  {pairingCode}
                </div>
                <div style={{ background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: "0.5rem", padding: "1rem", color: "#c4b5fd" }}>
                  <strong>📱 How to link:</strong>
                  <ol style={{ marginTop: "0.5rem", paddingLeft: "1.25rem", lineHeight: 1.8 }}>
                    <li>Open WhatsApp on your phone</li>
                    <li>Go to <strong>Settings → Linked Devices</strong></li>
                    <li>Tap <strong>Link a Device → Link with Phone Number</strong></li>
                    <li>Enter the code above</li>
                  </ol>
                </div>
              </div>
            )}

            {userId && botStatus && (
              <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{
                  width: 10, height: 10, borderRadius: "50%", display: "inline-block",
                  backgroundColor: isConnected ? "#22c55e" : "#f59e0b",
                  boxShadow: isConnected ? "0 0 8px #22c55e" : "0 0 8px #f59e0b"
                }} />
                <span style={{ color: isConnected ? "#86efac" : "#fcd34d", fontSize: "0.875rem" }}>
                  {isConnected
                    ? `Connected (+${botStatus.phone ?? ""})`
                    : `Status: ${botStatus.status} — Waiting for connection...`}
                </span>
              </div>
            )}
          </div>
        )}

        {userId && activeTab === "settings" && settings && (
          <div>
            <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {TOGGLE_FEATURES.map(feat => {
                const value = settings[feat.key] as boolean ?? false;
                return (
                  <div key={feat.key} style={{
                    background: "#0d1a2e",
                    border: "1px solid #1e3a5f",
                    borderRadius: "0.75rem",
                    padding: "1rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    opacity: savingKey === feat.key ? 0.6 : 1,
                    transition: "all 0.2s"
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "#e2e8f0" }}>{feat.icon} {feat.label}</div>
                      <div style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "0.2rem" }}>{feat.desc}</div>
                    </div>
                    <label
                      onClick={() => handleToggle(feat.key, !value)}
                      style={{ position: "relative", display: "inline-block", width: 48, height: 26, flexShrink: 0, cursor: "pointer" }}
                    >
                      <span
                        style={{
                          display: "block",
                          width: 48, height: 26,
                          borderRadius: 26,
                          background: value
                            ? "linear-gradient(135deg, #00d4ff, #a855f7)"
                            : "#334155",
                          transition: "background 0.3s",
                          position: "relative"
                        }}
                      >
                        <span style={{
                          position: "absolute",
                          height: 18, width: 18,
                          left: value ? 26 : 4, top: 4,
                          backgroundColor: "white",
                          borderRadius: "50%",
                          transition: "left 0.3s",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
                        }} />
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: "2rem", display: "grid", gap: "1.25rem" }}>
              <h3 style={{ color: "#00d4ff", fontWeight: 700, fontSize: "1.1rem" }}>⚙️ Custom Settings</h3>

              <SettingField
                label="🔑 Command Prefix"
                placeholder="."
                value={String(settings.prefix ?? ".")}
                onSave={v => handleTextSetting("prefix", v)}
                saving={savingKey === "prefix"}
                maxLength={3}
              />
              <SettingField
                label="🌐 Bot Mode"
                placeholder="private"
                value={String(settings.mode ?? "private")}
                onSave={v => handleTextSetting("mode", v)}
                saving={savingKey === "mode"}
                hint="public = everyone can use; private = only you"
              />
              <SettingField
                label="📵 Anti-Call Message"
                placeholder="Calls are not allowed. Please send a message."
                value={String(settings.anticallMsg ?? "")}
                onSave={v => handleTextSetting("anticallMsg", v)}
                saving={savingKey === "anticallMsg"}
                multiline
              />
              <SettingField
                label="👋 Welcome Message"
                placeholder="Welcome {user} to {group}!"
                value={String(settings.welcomeMsg ?? "")}
                onSave={v => handleTextSetting("welcomeMsg", v)}
                saving={savingKey === "welcomeMsg"}
                multiline
                hint="Use {user} and {group} as placeholders"
              />
              <SettingField
                label="💫 Goodbye Message"
                placeholder="Goodbye {user}!"
                value={String(settings.goodbyeMsg ?? "")}
                onSave={v => handleTextSetting("goodbyeMsg", v)}
                saving={savingKey === "goodbyeMsg"}
                multiline
                hint="Use {user} and {group} as placeholders"
              />
              <SettingField
                label="❤️ Status Like Emojis"
                placeholder="🔥 💯 ✨ 🎉"
                value={String(settings.likeEmojis ?? "")}
                onSave={v => handleTextSetting("likeEmojis", v)}
                saving={savingKey === "likeEmojis"}
                hint="Space-separated emojis to randomly use when liking statuses"
              />
            </div>
          </div>
        )}

        {!userId && (
          <div style={{ textAlign: "center", marginTop: "3rem", color: "#334155" }}>
            <div style={{ fontSize: "4rem" }}>⚡</div>
            <p style={{ marginTop: "1rem", color: "#64748b" }}>
              Enter your phone number above to connect NUTTER-XMD to WhatsApp
            </p>
          </div>
        )}
      </div>

      <footer style={{ textAlign: "center", padding: "2rem", color: "#334155", fontSize: "0.8rem", borderTop: "1px solid #1e3a5f", marginTop: "4rem" }}>
        ⚡ NUTTER-XMD V.9.1.3 — Multi-user WhatsApp Bot Platform
      </footer>
    </div>
  );
}

function SettingField({
  label, placeholder, value, onSave, saving, multiline, hint, maxLength
}: {
  label: string;
  placeholder?: string;
  value: string;
  onSave: (v: string) => void;
  saving: boolean;
  multiline?: boolean;
  hint?: string;
  maxLength?: number;
}) {
  const [localVal, setLocalVal] = useState(value);

  useEffect(() => setLocalVal(value), [value]);

  const inputStyle: React.CSSProperties = {
    flex: 1,
    background: "#0a1628",
    border: "1px solid #1e3a5f",
    color: "#e2e8f0",
    borderRadius: "0.5rem",
    padding: "0.625rem 0.875rem",
    fontSize: "0.9rem",
    resize: "vertical"
  };

  return (
    <div style={{ background: "#0d1a2e", border: "1px solid #1e3a5f", borderRadius: "0.75rem", padding: "1rem" }}>
      <label style={{ color: "#94a3b8", fontSize: "0.875rem", fontWeight: 600, display: "block", marginBottom: "0.5rem" }}>
        {label}
      </label>
      {hint && <p style={{ color: "#475569", fontSize: "0.78rem", marginBottom: "0.5rem" }}>{hint}</p>}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        {multiline ? (
          <textarea
            rows={2}
            placeholder={placeholder}
            value={localVal}
            onChange={e => setLocalVal(e.target.value)}
            style={inputStyle}
          />
        ) : (
          <input
            type="text"
            placeholder={placeholder}
            value={localVal}
            maxLength={maxLength}
            onChange={e => setLocalVal(e.target.value)}
            style={inputStyle}
          />
        )}
        <button
          onClick={() => onSave(localVal)}
          disabled={saving}
          style={{
            background: saving ? "#334155" : "linear-gradient(135deg, #00d4ff, #a855f7)",
            color: "white", fontWeight: 600, border: "none",
            borderRadius: "0.5rem", padding: "0.625rem 1rem",
            cursor: saving ? "not-allowed" : "pointer",
            whiteSpace: "nowrap", fontSize: "0.875rem"
          }}
        >
          {saving ? "..." : "Save"}
        </button>
      </div>
    </div>
  );
}

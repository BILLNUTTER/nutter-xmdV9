import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { pairBot, getBotStatus, getSettings, updateSettings } from "@/lib/api";

const TOGGLE_FEATURES = [
  { key: "anticall", label: "Anti Call", icon: "📵", desc: "Reject incoming calls automatically", group: "Protection" },
  { key: "antilink", label: "Anti Link", icon: "🔗", desc: "Remove links shared in groups", group: "Protection" },
  { key: "antisticker", label: "Anti Sticker", icon: "🎭", desc: "Remove stickers in groups", group: "Protection" },
  { key: "antitag", label: "Anti Tag", icon: "🏷️", desc: "Block @everyone / @here tags", group: "Protection" },
  { key: "antibadword", label: "Anti Bad Word", icon: "🤬", desc: "Filter and remove offensive words", group: "Protection" },
  { key: "antispam", label: "Anti Spam", icon: "🛡️", desc: "Kick spammers automatically", group: "Protection" },
  { key: "antidelete", label: "Anti Delete", icon: "🔄", desc: "Recover deleted messages", group: "Protection" },
  { key: "chatbot", label: "Auto Reply", icon: "🤖", desc: "Auto-reply to DMs when offline", group: "Automation" },
  { key: "autoread", label: "Auto Read", icon: "👁️", desc: "Auto-read all incoming messages", group: "Automation" },
  { key: "alwaysonline", label: "Always Online", icon: "🟢", desc: "Stay always online on WhatsApp", group: "Automation" },
  { key: "autoviewstatus", label: "Auto View Status", icon: "👀", desc: "Auto-view all status updates", group: "Automation" },
  { key: "autolikestatus", label: "Auto Like Status", icon: "❤️", desc: "React to status updates", group: "Automation" },
  { key: "autotype", label: "Typing Indicator", icon: "⌨️", desc: "Show typing when responding", group: "Automation" },
  { key: "welcome", label: "Welcome Message", icon: "👋", desc: "Greet new group members", group: "Groups" },
  { key: "goodbye", label: "Goodbye Message", icon: "💫", desc: "Farewell message when someone leaves", group: "Groups" },
];

const PROTECTION_KEYS = TOGGLE_FEATURES.filter(f => f.group === "Protection").map(f => f.key);
const AUTOMATION_KEYS = TOGGLE_FEATURES.filter(f => f.group === "Automation").map(f => f.key);
const GROUP_KEYS = TOGGLE_FEATURES.filter(f => f.group === "Groups").map(f => f.key);

type DashTab = "link" | "settings";

interface BotStatus {
  connected: boolean;
  status: string;
  phone?: string;
  lastSeen: string | null;
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<DashTab>("link");
  const userId = localStorage.getItem("nutter_user_id");
  const userToken = localStorage.getItem("nutter_user_token");
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [settingsMsg, setSettingsMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!userId) { navigate("/connect"); return; }
    poll(userId);
    pollRef.current = setInterval(() => poll(userId), 5000);
    if (userToken) loadSettings(userId, userToken);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (countRef.current) clearInterval(countRef.current);
    };
  }, []);

  async function poll(uid: string) {
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

  function startCountdown(sec: number) {
    setCountdown(sec);
    if (countRef.current) clearInterval(countRef.current);
    countRef.current = setInterval(() => {
      setCountdown(p => { if (p <= 1) { clearInterval(countRef.current!); return 0; } return p - 1; });
    }, 1000);
  }

  async function handlePair() {
    setPairError("");
    const clean = phone.replace(/[^0-9]/g, "");
    if (!clean || clean.length < 7) { setPairError("Enter a valid phone number with country code"); return; }
    setPairLoading(true);
    try {
      const result = await pairBot(clean);
      localStorage.setItem("nutter_user_id", result.userId);
      localStorage.setItem("nutter_user_token", result.userToken);
      if (result.pairingCode) {
        setPairingCode(result.pairingCode);
        startCountdown(180);
      } else {
        await poll(result.userId);
      }
    } catch (err: unknown) {
      setPairError(err instanceof Error ? err.message : "Failed to generate code");
    } finally {
      setPairLoading(false);
    }
  }

  async function handleToggle(key: string, value: boolean) {
    if (!userId || !userToken) return;
    setSavingKey(key);
    try {
      const updated = await updateSettings(userId, userToken, { [key]: value });
      setSettings(updated);
    } catch (_) {} finally { setSavingKey(null); }
  }

  async function handleTextSave(key: string, value: string) {
    if (!userId || !userToken) return;
    setSavingKey(key);
    try {
      const updated = await updateSettings(userId, userToken, { [key]: value });
      setSettings(updated);
      setSettingsMsg("Saved!");
      setTimeout(() => setSettingsMsg(""), 2000);
    } catch (_) {} finally { setSavingKey(null); }
  }

  function logout() {
    localStorage.removeItem("nutter_user_id");
    localStorage.removeItem("nutter_user_token");
    navigate("/connect");
  }

  const isConnected = botStatus?.connected;
  const fmt = pairingCode ? pairingCode.slice(0, 4) + "-" + pairingCode.slice(4) : "";
  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#080d1a", color: "#e2e8f0", fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Navbar */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(8,13,26,0.95)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid #1e3a5f",
        padding: "0 1.5rem",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 60
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button onClick={() => navigate("/")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontSize: "1.25rem" }}>⚡</span>
            <span style={{
              fontWeight: 900, fontSize: "1rem",
              background: "linear-gradient(135deg, #00d4ff, #a855f7)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
            }}>NUTTER-XMD</span>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "0.25rem", background: "rgba(30,58,95,0.3)", borderRadius: "0.75rem", padding: "0.25rem" }}>
          {([["link", "🔗 Link Bot"], ["settings", "⚙️ Settings"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: "0.45rem 1.25rem",
                borderRadius: "0.6rem", border: "none",
                fontWeight: 700, fontSize: "0.875rem",
                cursor: "pointer",
                background: tab === key ? "linear-gradient(135deg, #00d4ff22, #a855f722)" : "transparent",
                color: tab === key ? "#e2e8f0" : "#64748b",
                borderTop: tab === key ? "1px solid rgba(0,212,255,0.2)" : "1px solid transparent",
                transition: "all 0.2s"
              }}
            >{label}</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {botStatus && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                backgroundColor: isConnected ? "#22c55e" : "#ef4444",
                boxShadow: isConnected ? "0 0 6px #22c55e" : "0 0 6px #ef4444",
                display: "inline-block"
              }} />
              <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
                {isConnected ? `+${botStatus.phone ?? ""}` : botStatus.status}
              </span>
            </div>
          )}
          <button
            onClick={logout}
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5", borderRadius: "0.5rem", padding: "0.35rem 0.875rem", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
          >Logout</button>
        </div>
      </nav>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1.5rem" }}>

        {/* LINK TAB */}
        {tab === "link" && (
          <div>
            {/* Status Banner */}
            <div style={{
              background: isConnected
                ? "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.03))"
                : "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.03))",
              border: `1px solid ${isConnected ? "rgba(34,197,94,0.25)" : "rgba(245,158,11,0.25)"}`,
              borderRadius: "1rem", padding: "1.5rem",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexWrap: "wrap", gap: "1rem",
              marginBottom: "2rem"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%",
                  background: isConnected ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
                  border: `1px solid ${isConnected ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem"
                }}>
                  {isConnected ? "✅" : "⚠️"}
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "1rem" }}>
                    {isConnected ? "Bot is Connected" : "Bot Not Connected"}
                  </div>
                  <div style={{ color: "#64748b", fontSize: "0.82rem", marginTop: "0.15rem" }}>
                    {isConnected
                      ? `Running on +${botStatus?.phone} · Last seen: ${botStatus?.lastSeen ? new Date(botStatus.lastSeen).toLocaleString() : "just now"}`
                      : `Status: ${botStatus?.status ?? "unknown"} · Enter your number below to link`}
                  </div>
                </div>
              </div>
              {isConnected && (
                <div style={{
                  background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)",
                  borderRadius: "0.5rem", padding: "0.4rem 1rem",
                  color: "#86efac", fontSize: "0.8rem", fontWeight: 600
                }}>LIVE</div>
              )}
            </div>

            {/* Pair section */}
            <div style={{ background: "#0d1a2e", border: "1px solid #1e3a5f", borderRadius: "1rem", padding: "2rem" }}>
              <h2 style={{ color: "#00d4ff", fontWeight: 800, fontSize: "1.15rem", marginBottom: "0.4rem" }}>
                🔗 {isConnected ? "Relink / Change Number" : "Link WhatsApp"}
              </h2>
              <p style={{ color: "#64748b", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
                Generate an 8-digit Baileys pairing code and enter it in WhatsApp under Linked Devices → Link with Phone Number.
              </p>

              {pairError && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "0.75rem", padding: "0.75rem 1rem", color: "#fca5a5", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
                  ❌ {pairError}
                </div>
              )}

              {!pairingCode ? (
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <input
                    type="tel"
                    placeholder="Phone with country code, e.g. 2349012345678"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handlePair()}
                    style={{
                      flex: "1 1 250px",
                      background: "#0a1628", border: "1px solid #1e3a5f",
                      color: "#e2e8f0", borderRadius: "0.75rem",
                      padding: "0.875rem 1rem", fontSize: "1rem"
                    }}
                  />
                  <button
                    onClick={handlePair}
                    disabled={pairLoading}
                    style={{
                      background: pairLoading ? "#1e3a5f" : "linear-gradient(135deg, #00d4ff, #a855f7)",
                      color: "white", fontWeight: 700, border: "none",
                      borderRadius: "0.75rem", padding: "0.875rem 1.75rem",
                      cursor: pairLoading ? "not-allowed" : "pointer", fontSize: "1rem",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {pairLoading ? "⏳ Generating..." : "🔑 Get Code"}
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{
                    background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.2)",
                    borderRadius: "1rem", padding: "2rem", textAlign: "center", marginBottom: "1.5rem"
                  }}>
                    <p style={{ color: "#64748b", fontSize: "0.82rem", marginBottom: "0.75rem" }}>Your pairing code for <strong style={{ color: "#e2e8f0" }}>+{phone}</strong></p>
                    <div style={{
                      fontFamily: "'Courier New', monospace",
                      fontSize: "3rem", fontWeight: 900,
                      letterSpacing: "0.4rem", color: "#00d4ff",
                      textShadow: "0 0 24px rgba(0,212,255,0.5)",
                      marginBottom: "0.75rem"
                    }}>{fmt}</div>
                    {countdown > 0 ? (
                      <span style={{
                        display: "inline-block",
                        background: countdown < 30 ? "rgba(239,68,68,0.1)" : "rgba(0,212,255,0.08)",
                        border: `1px solid ${countdown < 30 ? "rgba(239,68,68,0.2)" : "rgba(0,212,255,0.15)"}`,
                        borderRadius: "100px", padding: "0.25rem 0.75rem",
                        color: countdown < 30 ? "#fca5a5" : "#00d4ff", fontSize: "0.8rem", fontWeight: 600
                      }}>
                        ⏱ {mins}:{secs.toString().padStart(2, "0")} remaining
                      </span>
                    ) : (
                      <span style={{ color: "#ef4444", fontSize: "0.8rem" }}>Expired — request a new code</span>
                    )}
                  </div>

                  <div style={{
                    background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.15)",
                    borderRadius: "0.75rem", padding: "1.25rem", marginBottom: "1.25rem"
                  }}>
                    <p style={{ color: "#a78bfa", fontWeight: 700, fontSize: "0.875rem", marginBottom: "0.6rem" }}>📱 Steps to link in WhatsApp:</p>
                    <ol style={{ color: "#64748b", fontSize: "0.85rem", lineHeight: 2, paddingLeft: "1.1rem", margin: 0 }}>
                      <li>Open <strong style={{ color: "#e2e8f0" }}>WhatsApp</strong> on your phone</li>
                      <li>Go to <strong style={{ color: "#e2e8f0" }}>Settings → Linked Devices</strong></li>
                      <li>Tap <strong style={{ color: "#e2e8f0" }}>Link a Device</strong></li>
                      <li>Tap <strong style={{ color: "#e2e8f0" }}>Link with Phone Number</strong></li>
                      <li>Enter code: <strong style={{ color: "#00d4ff", fontFamily: "monospace", letterSpacing: "0.1em" }}>{fmt}</strong></li>
                    </ol>
                  </div>

                  <button
                    onClick={() => { setPairingCode(null); setCountdown(0); }}
                    style={{
                      background: "rgba(71,85,105,0.2)", border: "1px solid #1e3a5f",
                      color: "#94a3b8", borderRadius: "0.75rem", padding: "0.75rem 1.25rem",
                      cursor: "pointer", fontWeight: 600, fontSize: "0.875rem"
                    }}
                  >← Try Different Number</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {tab === "settings" && (
          <div>
            {settingsMsg && (
              <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: "0.75rem", padding: "0.75rem 1rem", color: "#86efac", marginBottom: "1.5rem" }}>
                ✅ {settingsMsg}
              </div>
            )}

            {!settings ? (
              <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>
                {!userId ? (
                  <p>You must <button onClick={() => setTab("link")} style={{ background: "none", border: "none", color: "#00d4ff", cursor: "pointer", fontWeight: 600, fontSize: "inherit" }}>link your bot</button> first to access settings.</p>
                ) : (
                  <p>Loading settings...</p>
                )}
              </div>
            ) : (
              <>
                <ToggleGroup label="🛡️ Protection" features={TOGGLE_FEATURES.filter(f => PROTECTION_KEYS.includes(f.key))} settings={settings} savingKey={savingKey} onToggle={handleToggle} />
                <ToggleGroup label="⚡ Automation" features={TOGGLE_FEATURES.filter(f => AUTOMATION_KEYS.includes(f.key))} settings={settings} savingKey={savingKey} onToggle={handleToggle} />
                <ToggleGroup label="👥 Group Features" features={TOGGLE_FEATURES.filter(f => GROUP_KEYS.includes(f.key))} settings={settings} savingKey={savingKey} onToggle={handleToggle} />

                <div style={{ marginTop: "2rem", background: "#0d1a2e", border: "1px solid #1e3a5f", borderRadius: "1rem", padding: "1.75rem" }}>
                  <h3 style={{ color: "#00d4ff", fontWeight: 800, fontSize: "1.05rem", marginBottom: "1.25rem" }}>⚙️ Advanced Settings</h3>
                  <div style={{ display: "grid", gap: "1rem" }}>
                    <SettingField label="🔑 Command Prefix" placeholder="." value={String(settings.prefix ?? ".")} onSave={v => handleTextSave("prefix", v)} saving={savingKey === "prefix"} maxLength={3} hint="Character to trigger bot commands (default: .)" />
                    <SettingField label="🌐 Bot Mode" placeholder="private" value={String(settings.mode ?? "private")} onSave={v => handleTextSave("mode", v)} saving={savingKey === "mode"} hint="private = only owner; public = anyone can use commands" />
                    <SettingField label="📵 Anti-Call Message" placeholder="Calls not allowed. Send a message instead." value={String(settings.anticallMsg ?? "")} onSave={v => handleTextSave("anticallMsg", v)} saving={savingKey === "anticallMsg"} multiline />
                    <SettingField label="👋 Welcome Message" placeholder="Welcome {user} to {group}!" value={String(settings.welcomeMsg ?? "")} onSave={v => handleTextSave("welcomeMsg", v)} saving={savingKey === "welcomeMsg"} multiline hint="Placeholders: {user} {group}" />
                    <SettingField label="💫 Goodbye Message" placeholder="Goodbye {user}, sad to see you go!" value={String(settings.goodbyeMsg ?? "")} onSave={v => handleTextSave("goodbyeMsg", v)} saving={savingKey === "goodbyeMsg"} multiline hint="Placeholders: {user} {group}" />
                    <SettingField label="❤️ Status React Emojis" placeholder="🔥 💯 ✨ 🎉 👍" value={String(settings.likeEmojis ?? "")} onSave={v => handleTextSave("likeEmojis", v)} saving={savingKey === "likeEmojis"} hint="Space-separated emojis for auto status reactions" />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <footer style={{ textAlign: "center", padding: "2rem", color: "#334155", fontSize: "0.78rem", borderTop: "1px solid #1e3a5f", marginTop: "3rem" }}>
        <span>⚡ NUTTER-XMD V.9.1.3 &nbsp;·&nbsp;</span>
        <a href="https://chat.whatsapp.com/JsKmQMpECJMHyxucHquF15?mode=gi_t" target="_blank" rel="noreferrer" style={{ color: "#25D166", textDecoration: "none" }}>Community Group</a>
        <span> &nbsp;·&nbsp; </span>
        <a href="https://whatsapp.com/channel/0029VbCcIrFEAKWNxpi8qR2V" target="_blank" rel="noreferrer" style={{ color: "#00d4ff", textDecoration: "none" }}>Official Channel</a>
      </footer>
    </div>
  );
}

function ToggleGroup({
  label, features, settings, savingKey, onToggle
}: {
  label: string;
  features: typeof TOGGLE_FEATURES;
  settings: Record<string, unknown>;
  savingKey: string | null;
  onToggle: (key: string, value: boolean) => void;
}) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ color: "#94a3b8", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>
        {label}
      </h3>
      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))" }}>
        {features.map(feat => {
          const val = settings[feat.key] as boolean ?? false;
          return (
            <div key={feat.key} style={{
              background: "#0d1a2e", border: "1px solid #1e3a5f", borderRadius: "0.875rem",
              padding: "1rem 1.1rem", display: "flex", alignItems: "center", justifyContent: "space-between",
              opacity: savingKey === feat.key ? 0.6 : 1, transition: "opacity 0.2s"
            }}>
              <div>
                <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: "0.9rem" }}>{feat.icon} {feat.label}</div>
                <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.15rem" }}>{feat.desc}</div>
              </div>
              <div
                onClick={() => !savingKey && onToggle(feat.key, !val)}
                style={{
                  width: 46, height: 26, borderRadius: 26, flexShrink: 0,
                  background: val ? "linear-gradient(135deg, #00d4ff, #a855f7)" : "#1e3a5f",
                  position: "relative", cursor: "pointer", transition: "background 0.3s", marginLeft: "0.75rem"
                }}
              >
                <div style={{
                  position: "absolute", width: 18, height: 18, borderRadius: "50%",
                  backgroundColor: "white", top: 4,
                  left: val ? 24 : 4,
                  transition: "left 0.3s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingField({
  label, placeholder, value, onSave, saving, multiline, hint, maxLength
}: {
  label: string; placeholder?: string; value: string;
  onSave: (v: string) => void; saving: boolean;
  multiline?: boolean; hint?: string; maxLength?: number;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  const base: React.CSSProperties = {
    flex: 1, background: "#0a1628", border: "1px solid #1e3a5f",
    color: "#e2e8f0", borderRadius: "0.6rem", padding: "0.7rem 0.875rem",
    fontSize: "0.9rem", resize: "vertical"
  };

  return (
    <div style={{ background: "rgba(30,58,95,0.2)", border: "1px solid #1e3a5f", borderRadius: "0.75rem", padding: "1rem" }}>
      <label style={{ color: "#94a3b8", fontSize: "0.82rem", fontWeight: 700, display: "block", marginBottom: hint ? "0.25rem" : "0.5rem" }}>{label}</label>
      {hint && <p style={{ color: "#475569", fontSize: "0.75rem", marginBottom: "0.5rem" }}>{hint}</p>}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        {multiline
          ? <textarea rows={2} placeholder={placeholder} value={local} onChange={e => setLocal(e.target.value)} style={base} />
          : <input type="text" placeholder={placeholder} value={local} maxLength={maxLength} onChange={e => setLocal(e.target.value)} style={base} />
        }
        <button
          onClick={() => onSave(local)}
          disabled={saving}
          style={{
            background: saving ? "#1e3a5f" : "linear-gradient(135deg, #00d4ff, #a855f7)",
            color: "white", fontWeight: 700, border: "none", borderRadius: "0.6rem",
            padding: "0.7rem 1rem", cursor: saving ? "not-allowed" : "pointer",
            fontSize: "0.85rem", whiteSpace: "nowrap"
          }}
        >{saving ? "..." : "Save"}</button>
      </div>
    </div>
  );
}

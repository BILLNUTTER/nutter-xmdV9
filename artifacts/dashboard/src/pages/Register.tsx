import { useState } from "react";
import { useLocation } from "wouter";
import { register, setToken } from "@/lib/api";

export default function Register() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !username.trim() || !password) { setError("All fields are required"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const { token } = await register(email.trim(), username.trim(), password);
      setToken(token);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "#0a1628", border: "1px solid #1e3a5f",
    color: "#e2e8f0", borderRadius: "0.75rem",
    padding: "0.875rem 1rem", fontSize: "0.95rem",
    outline: "none", transition: "border-color 0.2s"
  };

  return (
    <div style={{
      minHeight: "100vh", backgroundColor: "#080d1a",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif",
      padding: "1rem",
      background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(168,85,247,0.04) 0%, #080d1a 70%)"
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>⚡</div>
          <h1 style={{
            fontSize: "1.75rem", fontWeight: 900,
            background: "linear-gradient(135deg, #00d4ff, #a855f7)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            margin: "0 0 0.25rem"
          }}>NUTTER-XMD</h1>
          <p style={{ color: "#64748b", fontSize: "0.875rem", margin: 0 }}>Create your free account</p>
        </div>

        <div style={{
          background: "#0d1a2e", border: "1px solid #1e3a5f",
          borderRadius: "1.25rem", padding: "2rem"
        }}>
          {error && (
            <div style={{
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: "0.75rem", padding: "0.75rem 1rem",
              color: "#fca5a5", fontSize: "0.875rem", marginBottom: "1.25rem"
            }}>❌ {error}</div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", color: "#94a3b8", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}>Email Address</label>
              <input
                type="email" placeholder="your@email.com"
                value={email} onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                style={inputStyle}
                onFocus={e => (e.target.style.borderColor = "#00d4ff44")}
                onBlur={e => (e.target.style.borderColor = "#1e3a5f")}
              />
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", color: "#94a3b8", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}>Username</label>
              <input
                type="text" placeholder="3-20 characters, letters/numbers/underscores"
                value={username} onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                style={inputStyle}
                onFocus={e => (e.target.style.borderColor = "#00d4ff44")}
                onBlur={e => (e.target.style.borderColor = "#1e3a5f")}
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", color: "#94a3b8", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem" }}>Password</label>
              <input
                type="password" placeholder="At least 6 characters"
                value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                style={inputStyle}
                onFocus={e => (e.target.style.borderColor = "#00d4ff44")}
                onBlur={e => (e.target.style.borderColor = "#1e3a5f")}
              />
            </div>

            <button
              type="submit" disabled={loading}
              style={{
                width: "100%",
                background: loading ? "#1e3a5f" : "linear-gradient(135deg, #00d4ff, #a855f7)",
                color: "white", fontWeight: 700, border: "none",
                borderRadius: "0.75rem", padding: "0.9rem",
                cursor: loading ? "not-allowed" : "pointer", fontSize: "1rem"
              }}
            >
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <p style={{ textAlign: "center", color: "#64748b", fontSize: "0.875rem", marginTop: "1.25rem", marginBottom: 0 }}>
            Already have an account?{" "}
            <button
              onClick={() => navigate("/login")}
              style={{ background: "none", border: "none", color: "#00d4ff", cursor: "pointer", fontWeight: 600, fontSize: "inherit", padding: 0 }}
            >Sign in</button>
          </p>
        </div>

        <div style={{
          background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.3)",
          borderRadius: "0.75rem", padding: "0.85rem 1rem",
          display: "flex", gap: "0.6rem", alignItems: "flex-start"
        }}>
          <span style={{ fontSize: "1rem", flexShrink: 0 }}>⚠️</span>
          <p style={{ color: "#fbbf24", fontSize: "0.78rem", margin: 0, lineHeight: 1.5 }}>
            <strong>Important:</strong> Accounts that are created but never linked to a WhatsApp bot may be deleted automatically to free up resources. Link your bot immediately after registering.
          </p>
        </div>

        <p style={{ textAlign: "center", color: "#334155", fontSize: "0.75rem", marginTop: "1.5rem" }}>
          ⚡ NUTTER-XMD V.9.1.3 — Free, always on
        </p>
      </div>
    </div>
  );
}

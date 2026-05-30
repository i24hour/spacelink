import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API_URL =
  (typeof process !== "undefined" && process.env?.PLASMO_PUBLIC_API_URL) ||
  "https://deadlineai-api.onrender.com";

const WEB_URL =
  (typeof process !== "undefined" && process.env?.PLASMO_PUBLIC_WEB_URL) ||
  "https://web-i24hours-projects.vercel.app";

function isAllowedWebAuthOrigin(origin: string): boolean {
  try {
    return origin === new URL(WEB_URL).origin;
  } catch {
    return origin === WEB_URL;
  }
}

type LinkItem = {
  id: string;
  url: string;
  title: string;
  extractedDeadline: string | null;
  category: string | null;
  status: string;
  urgencyScore: number | null;
};

type User = {
  id: string;
  email: string;
  telegramConnected: boolean;
};

function IndexPopup() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedLinks, setSavedLinks] = useState<LinkItem[]>([]);
  const [tabInfo, setTabInfo] = useState<{ url: string; title: string } | null>(null);
  const [message, setMessage] = useState("");
  const [authError, setAuthError] = useState("");

  // Listen for Google auth messages from popup window
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!isAllowedWebAuthOrigin(event.origin)) return;
      if (event.data?.type === "DEADLINEAI_GOOGLE_ID_TOKEN") {
        exchangeGoogleToken(event.data.idToken);
      } else if (event.data?.type === "DEADLINEAI_GOOGLE_ERROR") {
        setAuthError("Google sign-in failed. Please try again.");
        setLoading(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    chrome.storage.local.get("token", (result) => {
      const stored = result.token || null;
      setToken(stored);
      if (!stored) setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Session expired");
        return r.json();
      })
      .then((data: User) => {
        setUser(data);
        loadLinks();
      })
      .catch(() => {
        // Token invalid, clear it
        chrome.storage.local.remove("token");
        setToken(null);
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs[0];
      if (t?.url && t.title) {
        setTabInfo({ url: t.url, title: t.title });
      }
    });
  }, []);

  async function exchangeGoogleToken(idToken: string) {
    try {
      const res = await fetch(`${API_URL}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();
      if (data.token) {
        chrome.storage.local.set({ token: data.token }, () => {
          setToken(data.token);
        });
      } else {
        setAuthError("Authentication failed");
      }
    } catch (e: any) {
      setAuthError(e?.message || "Authentication error");
    } finally {
      setLoading(false);
    }
  }

  function startGoogleAuth() {
    const extensionOrigin = new URL(chrome.runtime.getURL("popup.html")).origin;
    window.open(
      `${WEB_URL}/auth?origin=${encodeURIComponent(extensionOrigin)}`,
      "deadlineai_auth",
      "width=480,height=600"
    );
  }

  function handleDisconnect() {
    chrome.storage.local.remove("token", () => {
      setToken(null);
      setUser(null);
      setSavedLinks([]);
    });
  }

  async function loadLinks() {
    try {
      const res = await fetch(`${API_URL}/api/links`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setSavedLinks(data || []);
    } catch {
      setSavedLinks([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectTelegram() {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/auth/telegram-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
        setMessage("Telegram bot opened! Click Start in Telegram to connect.");
      }
    } catch (e: any) {
      setMessage(e?.message || "Failed to generate Telegram link");
    }
  }

  const handleSave = async () => {
    if (!token || !tabInfo) return;
    setSaving(true);
    setMessage("");

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: (await getActiveTabId()) as number },
        func: () => ({
          url: location.href,
          title: document.title,
          rawContent: document.body.innerText,
        }),
      });

      const payload = result?.result as { url: string; title: string; rawContent: string };

      const res = await fetch(`${API_URL}/api/links`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: payload.url,
          title: payload.title,
          rawContent: payload.rawContent.slice(0, 20000),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save");
      }

      const link = await res.json();
      setSavedLinks((prev) => [link, ...prev]);
      setMessage("Saved! DeadlineAI is analyzing the page...");
    } catch (e: any) {
      setMessage(e?.message || "Error saving page");
    } finally {
      setSaving(false);
    }
  };

  const duplicate = useMemo(() => {
    if (!tabInfo) return null;
    return savedLinks.find((l) => l.url === tabInfo.url) || null;
  }, [savedLinks, tabInfo]);

  if (loading && !token) {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px" }}>
          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 4, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", marginRight: 8 }}></span>
          DeadlineAI
        </div>
        <p className="text-muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
          Never miss a deadline. Save any opportunity from the web and get smart reminders on Telegram & Email.
        </p>
        {authError && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#f87171" }}>{authError}</div>
        )}
        <button className="btn btn-primary" style={{ marginTop: 14, width: "100%", gap: 8, display: "inline-flex" }} onClick={startGoogleAuth}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", marginRight: 6 }}></span>
          DeadlineAI
        </div>
        <button onClick={handleDisconnect} className="text-muted" style={{ fontSize: 11, background: "none", border: "none", cursor: "pointer" }}>
          Disconnect
        </button>
      </div>

      {user && (
        <div className="card" style={{ marginTop: 10, padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{user.email}</div>
            <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {user.telegramConnected ? (
                <span className="badge" style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}>
                  Telegram connected
                </span>
              ) : (
                <button
                  className="badge"
                  onClick={handleConnectTelegram}
                  style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc", cursor: "pointer", border: "none" }}
                >
                  Connect Telegram
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{tabInfo?.title || "Current page"}</div>
        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
          {tabInfo?.url || ""}
        </div>

        {duplicate ? (
          <div style={{ marginTop: 10 }}>
            <span className="badge" style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}>
              Already saved
            </span>
          </div>
        ) : (
          <button
            className="btn btn-primary"
            style={{ marginTop: 10, width: "100%" }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Deadline"}
          </button>
        )}

        {message && (
          <div style={{ marginTop: 8, fontSize: 12 }} className={message.startsWith("Saved") || message.includes("opened") ? "text-success" : "text-danger"}>
            {message}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Recent opportunities</div>
        <div style={{ display: "grid", gap: 8 }}>
          {savedLinks.slice(0, 6).map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="card"
              style={{ textDecoration: "none", color: "inherit", padding: 10 }}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{link.title}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                {link.category && <span className="badge">{link.category}</span>}
                {link.extractedDeadline && (
                  <span className="badge" style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc" }}>
                    {new Date(link.extractedDeadline).toLocaleDateString()}
                  </span>
                )}
                {(link.urgencyScore || 0) >= 7 && (
                  <span className="badge" style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}>
                    Urgent
                  </span>
                )}
              </div>
            </a>
          ))}
          {savedLinks.length === 0 && (
            <div className="text-muted" style={{ fontSize: 12 }}>No saved links yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

async function getActiveTabId(): Promise<number | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id);
    });
  });
}

export default IndexPopup;

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<IndexPopup />);
}

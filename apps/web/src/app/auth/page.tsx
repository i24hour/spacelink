"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const REDIRECT_URI = typeof window !== "undefined" ? `${window.location.origin}/auth` : "";

export default function AuthPage() {
  const handled = useRef(false);
  const [status, setStatus] = useState<"idle" | "authenticating" | "connected_telegram" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const search = new URLSearchParams(window.location.search);
    const tgLinkFromSearch = search.get("tgLink");
    if (tgLinkFromSearch) {
      sessionStorage.setItem("deadlineai_tg_link", tgLinkFromSearch);
    }

    // Check if this is a Google OAuth redirect (has id_token in hash)
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace("#", ""));
    const idToken = params.get("id_token");
    const pendingTgLink = sessionStorage.getItem("deadlineai_tg_link");

    if (!idToken && pendingTgLink) {
      const existingToken = localStorage.getItem("deadlineai_token");
      if (existingToken) {
        connectTelegramWithExistingSession(existingToken, pendingTgLink);
        return;
      }
    }

    if (idToken) {
      // We're in a popup after OAuth redirect. Send token to parent (extension).
      if (window.opener && !pendingTgLink) {
        window.opener.postMessage({ type: "DEADLINEAI_GOOGLE_ID_TOKEN", idToken }, "*");
        window.close();
      } else {
        // If opened directly (not as popup), exchange token ourselves
        exchangeToken(idToken, pendingTgLink || undefined);
      }
      return;
    }

    // Check if there was an error
    const error = params.get("error");
    if (error) {
      if (window.opener) {
        window.opener.postMessage({ type: "DEADLINEAI_GOOGLE_ERROR", error }, "*");
        window.close();
      } else {
        setStatus("error");
        setErrorMsg(error);
      }
    }
  }, []);

  async function connectTelegramWithExistingSession(token: string, telegramLinkToken: string) {
    setStatus("authenticating");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    try {
      await fetch(`${apiUrl}/api/auth/telegram-connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: telegramLinkToken }),
      });
      sessionStorage.removeItem("deadlineai_tg_link");
      setStatus("connected_telegram");
    } catch (e) {
      console.error(e);
      window.location.href = "/dashboard";
    }
  }

  async function exchangeToken(idToken: string, telegramLinkToken?: string) {
    setStatus("authenticating");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    try {
      const res = await fetch(`${apiUrl}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem("deadlineai_token", data.token);

        if (telegramLinkToken) {
          try {
            await fetch(`${apiUrl}/api/auth/telegram-connect`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${data.token}`,
              },
              body: JSON.stringify({ token: telegramLinkToken }),
            });
            sessionStorage.removeItem("deadlineai_tg_link");
            setStatus("connected_telegram");
            return;
          } catch (e) {
            console.error(e);
          }
        }

        window.location.href = "/dashboard";
      } else {
        setStatus("error");
        setErrorMsg(data.error || "Authentication failed");
      }
    } catch (e: any) {
      console.error(e);
      setStatus("error");
      setErrorMsg(e.message || "Authentication error");
    }
  }

  function startGoogleAuth() {
    if (!GOOGLE_CLIENT_ID) {
      alert("Google Client ID not configured");
      return;
    }
    const scope = encodeURIComponent("openid email profile");
    const nonce = Math.random().toString(36).slice(2);
    const url =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `response_type=id_token&` +
      `scope=${scope}&` +
      `nonce=${nonce}`;

    window.location.href = url;
  }

  const botName = process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME || "DeadlineAIBot";

  if (status === "authenticating") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">DeadlineAI</h1>
          <p className="mt-2 text-muted-foreground animate-pulse">Authenticating, please wait...</p>
        </div>
      </div>
    );
  }

  if (status === "connected_telegram") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">🎉 Account Linked!</h1>
          <p className="mt-2 text-muted-foreground">
            Your Google Account is now connected to the Telegram Bot.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs">
          <Button
            size="lg"
            onClick={() => {
              window.location.href = "/dashboard";
            }}
            className="w-full"
          >
            Go to Dashboard
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              window.location.href = `https://t.me/${botName}`;
            }}
            className="w-full"
          >
            Go to Telegram
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">DeadlineAI</h1>
        <p className="mt-2 text-muted-foreground">Sign in to save deadlines from any page.</p>
        {status === "error" && (
          <p className="mt-2 text-sm text-destructive">{errorMsg}</p>
        )}
      </div>
      <Button size="lg" onClick={startGoogleAuth} className="gap-2">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Sign in with Google
      </Button>
      <p className="text-xs text-muted-foreground">
        By signing in, you agree to receive deadline reminders via your connected channels.
      </p>
    </div>
  );
}

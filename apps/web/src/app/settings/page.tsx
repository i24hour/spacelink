"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, FetchTimeoutError, fetchWithTimeout, useApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type UserProfile = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  profileVisibility: "public" | "private";
  followersCount?: number;
  followingCount?: number;
  timezone: string;
  timezoneConfigured?: boolean;
  preferredChannels: string[];
  telegramId?: string;
  telegramConnected: boolean;
  plan: string;
};

const FETCH_TIMEOUT_MS = 45_000;
const SLOW_HINT_MS = 5_000;

const timezones: { id: string; label: string }[] = [
  { id: "Asia/Kolkata", label: "India (IST)" },
  { id: "America/Los_Angeles", label: "US Pacific (PT / PST)" },
  { id: "America/Denver", label: "US Mountain (MT)" },
  { id: "America/Chicago", label: "US Central (CT)" },
  { id: "America/New_York", label: "US Eastern (ET / EST)" },
  { id: "Europe/London", label: "UK (GMT / BST)" },
  { id: "Europe/Paris", label: "Europe (CET)" },
  { id: "Asia/Dubai", label: "Gulf (GST)" },
  { id: "Asia/Singapore", label: "Singapore (SGT)" },
  { id: "Asia/Tokyo", label: "Japan (JST)" },
  { id: "Australia/Sydney", label: "Australia (AEST)" },
  { id: "UTC", label: "UTC" },
];

const channels = [
  { id: "email", label: "Email" },
  { id: "telegram", label: "Telegram" },
];

function normalizeUser(data: Partial<UserProfile> & { id: string; email: string }): UserProfile {
  return {
    id: data.id,
    email: data.email,
    username: data.username || "",
    displayName: data.displayName ?? null,
    bio: data.bio ?? null,
    profileVisibility: data.profileVisibility === "public" ? "public" : "private",
    followersCount: data.followersCount,
    followingCount: data.followingCount,
    timezone: data.timezone || "UTC",
    timezoneConfigured: data.timezoneConfigured ?? false,
    preferredChannels: data.preferredChannels?.length ? data.preferredChannels : ["email"],
    telegramId: data.telegramId,
    telegramConnected: !!data.telegramConnected || !!data.telegramId,
    plan: data.plan || "free",
  };
}

export default function SettingsPage() {
  const { fetcher } = useApi();
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [slowHint, setSlowHint] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [profileAvailable, setProfileAvailable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [testResult, setTestResult] = useState<{ type: string; ok: boolean; msg: string } | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNeedsReauth(false);
    setSlowHint(false);

    const slowTimer = setTimeout(() => setSlowHint(true), SLOW_HINT_MS);

    try {
      const me = await fetchWithTimeout(
        () => fetcher("/api/users/me"),
        FETCH_TIMEOUT_MS,
        "Server is taking too long to respond"
      );

      let merged: UserProfile = normalizeUser(me);

      try {
        const profile = await fetchWithTimeout(
          () => fetcher("/api/profile"),
          10_000,
          "Profile request timed out"
        );
        merged = normalizeUser({ ...me, ...profile });
        setProfileAvailable(true);
      } catch {
        setProfileAvailable(false);
      }

      setUser(merged);
    } catch (e: unknown) {
      if (
        e instanceof ApiError &&
        (e.status === 401 || (e.status === 404 && e.message === "User not found"))
      ) {
        setNeedsReauth(true);
        setLoadError("Your session is no longer valid. Please sign in again.");
      } else {
        const message =
          e instanceof FetchTimeoutError
            ? "Server is waking up — this can take up to a minute on the free tier. Please retry."
            : e instanceof Error
              ? e.message
              : "Failed to load settings";
        setLoadError(message);
      }
      setUser(null);
    } finally {
      clearTimeout(slowTimer);
      setLoading(false);
      setSlowHint(false);
    }
  }, [fetcher]);

  const handleSignInAgain = () => {
    localStorage.removeItem("deadlineai_token");
    router.push("/auth");
  };

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const refreshCounts = () => {
      if (document.visibilityState !== "visible") return;
      fetcher("/api/users/me")
        .then((me: UserProfile) => {
          setUser((current) =>
            current
              ? normalizeUser({
                  ...current,
                  followersCount: me.followersCount,
                  followingCount: me.followingCount,
                })
              : current
          );
        })
        .catch(() => {});
    };
    window.addEventListener("focus", refreshCounts);
    document.addEventListener("visibilitychange", refreshCounts);
    return () => {
      window.removeEventListener("focus", refreshCounts);
      document.removeEventListener("visibilitychange", refreshCounts);
    };
  }, [fetcher]);

  const toggleChannel = (id: string) => {
    if (!user) return;
    const next = user.preferredChannels.includes(id)
      ? user.preferredChannels.filter((c) => c !== id)
      : [...user.preferredChannels, id];
    setUser({ ...user, preferredChannels: next });
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setTestResult(null);
    try {
      const prefsUpdated = await fetcher("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          timezone: user.timezone,
          preferredChannels: user.preferredChannels,
        }),
      });

      let profileUpdated: Partial<UserProfile> = {};
      if (profileAvailable) {
        try {
          profileUpdated = await fetcher("/api/profile", {
            method: "PATCH",
            body: JSON.stringify({
              username: user.username,
              displayName: user.displayName,
              bio: user.bio,
              profileVisibility: user.profileVisibility,
            }),
          });
        } catch {
          setProfileAvailable(false);
          setTestResult({
            type: "save",
            ok: true,
            msg: "Notification settings saved. Profile fields could not be updated — the profile API is not available yet.",
          });
          setUser(normalizeUser({ ...user, ...prefsUpdated }));
          return;
        }
      }

      setUser(normalizeUser({ ...user, ...prefsUpdated, ...profileUpdated }));
      setTestResult({ type: "save", ok: true, msg: "Settings saved successfully." });
    } catch (e: unknown) {
      setTestResult({
        type: "save",
        ok: false,
        msg: e instanceof Error ? e.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConnectTelegram = async () => {
    try {
      const data = await fetcher("/api/auth/telegram-link", { method: "POST" });
      if (data.url) {
        window.open(data.url, "_blank");
        setTestResult({ type: "telegram", ok: true, msg: "Telegram bot opened! Click Start in Telegram to connect." });
      }
    } catch (e: unknown) {
      setTestResult({
        type: "telegram",
        ok: false,
        msg: e instanceof Error ? e.message : "Failed to generate link",
      });
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setTestResult(null);
    try {
      const res = await fetcher("/api/notifications/test-email", { method: "POST" });
      setTestResult({ type: "email", ok: res.ok, msg: res.ok ? "Test email sent! Check your inbox." : res.error });
    } catch (e: unknown) {
      setTestResult({
        type: "email",
        ok: false,
        msg: e instanceof Error ? e.message : "Failed to send test email",
      });
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestTelegram = async () => {
    if (!user?.telegramConnected) {
      setTestResult({ type: "telegram", ok: false, msg: "Connect Telegram first." });
      return;
    }
    setTestingTelegram(true);
    setTestResult(null);
    try {
      const res = await fetcher("/api/notifications/test-telegram", { method: "POST" });
      setTestResult({ type: "telegram", ok: res.ok, msg: res.ok ? "Test message sent! Check Telegram." : res.error });
    } catch (e: unknown) {
      setTestResult({
        type: "telegram",
        ok: false,
        msg: e instanceof Error ? e.message : "Failed to send test Telegram",
      });
    } finally {
      setTestingTelegram(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-xl space-y-4">
        <Skeleton className="h-8 w-40" />
        {slowHint && (
          <div className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            Server waking up… the API can take up to a minute on cold start.
          </div>
        )}
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (loadError || !user) {
    return (
      <div className="max-w-xl space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Settings</h2>
        <div className="rounded-lg border border-border bg-muted px-4 py-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Could not load settings</p>
          <p className="mt-1">{loadError || "Something went wrong."}</p>
        </div>
        {needsReauth ? (
          <Button onClick={handleSignInAgain}>Sign in again</Button>
        ) : (
          <Button onClick={loadSettings}>Retry</Button>
        )}
      </div>
    );
  }

  const telegramBotLink = process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME
    ? `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME}`
    : "https://t.me/";

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Settings</h2>
        <p className="text-muted-foreground">Manage reminders and notification channels.</p>
      </div>

      {testResult && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            testResult.ok
              ? "border-border bg-muted text-foreground"
              : "border-border bg-muted/80 text-muted-foreground"
          }`}
        >
          {testResult.msg}
        </div>
      )}

      <Card className="glass-card backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-foreground">Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Theme</p>
            <p className="text-xs text-muted-foreground">Switch between light and dark mode</p>
          </div>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card className="glass-card backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-foreground">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!profileAvailable && (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              Profile editing is limited until the profile API is deployed. Notification settings below still work.
            </p>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Username</label>
            <Input
              value={user.username}
              onChange={(e) =>
                setUser({
                  ...user,
                  username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
                })
              }
              disabled={!profileAvailable}
              className="theme-input"
            />
            <p className="text-xs text-muted-foreground">
              Public URL: /profile/{user.username || "…"}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Display name</label>
            <Input
              value={user.displayName || ""}
              onChange={(e) => setUser({ ...user, displayName: e.target.value || null })}
              placeholder="Optional"
              disabled={!profileAvailable}
              className="theme-input"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Bio</label>
            <Input
              value={user.bio || ""}
              onChange={(e) => setUser({ ...user, bio: e.target.value || null })}
              placeholder="Short bio (optional)"
              disabled={!profileAvailable}
              className="theme-input"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Profile visibility</label>
            <div className="flex gap-2">
              {(["private", "public"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => profileAvailable && setUser({ ...user, profileVisibility: v })}
                  disabled={!profileAvailable}
                  className={`rounded-md border px-3 py-2 text-sm capitalize transition-colors ${
                    user.profileVisibility === v
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  } ${!profileAvailable ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Public profiles appear on the leaderboard. Mark individual links public on
              the dashboard to share deadlines.
            </p>
          </div>
          {(user.followersCount != null || user.followingCount != null) && (
            <p className="text-sm text-muted-foreground">
              {user.followersCount ?? 0} followers · {user.followingCount ?? 0} following
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-foreground">Notification channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium">Active channels</label>
            <div className="flex flex-wrap gap-3">
              {channels.map((ch) => {
                const active = user.preferredChannels.includes(ch.id);
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => toggleChannel(ch.id)}
                    className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-transparent text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {ch.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Select which channels to receive reminders on. At least one is required.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Timezone</label>
            {!user.timezoneConfigured && (
              <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                Choose your timezone so deadlines and reminders match your local time (IST, PT, PST, etc.).
              </p>
            )}
            <Select
              value={user.timezone}
              onValueChange={(v) => setUser({ ...user, timezone: v, timezoneConfigured: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz.id} value={tz.id}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Email Section */}
      <Card className="glass-card backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-foreground">Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Registered email:</span>{" "}
            {user.email}
          </div>
          <p className="text-sm text-muted-foreground">
            Deadline reminders will be sent to this address automatically.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestEmail}
            disabled={testingEmail}
          >
            {testingEmail ? "Sending..." : "Send test email"}
          </Button>
        </CardContent>
      </Card>

      {/* Telegram Section */}
      <Card className="glass-card backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-foreground">Telegram</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {user.telegramConnected ? (
            <div className="rounded-md border border-border bg-muted p-3 text-sm">
              <span className="font-medium text-foreground">Telegram connected</span>
              <p className="text-muted-foreground mt-1">
                You will receive deadline reminders in Telegram.
              </p>
            </div>
          ) : (
            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Not connected</span>
              <p className="mt-1">
                Connect your Telegram to receive smart deadline reminders directly in your chat.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            {!user.telegramConnected ? (
              <Button size="sm" onClick={handleConnectTelegram}>
                Connect Telegram
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestTelegram}
                disabled={testingTelegram}
              >
                {testingTelegram ? "Sending..." : "Send test Telegram"}
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <a href={telegramBotLink} target="_blank" rel="noreferrer">
                Open Bot
              </a>
            </Button>
          </div>

          {user.telegramConnected && (
            <p className="text-xs text-muted-foreground">
              The bot also responds to commands. Try <strong>/deadlines</strong> in Telegram to see your upcoming deadlines anytime.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Plan Section */}
      <Card className="glass-card backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-foreground">Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium capitalize">{user.plan}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {user.plan === "free"
                  ? "10 active reminders. Upgrade for unlimited."
                  : "Unlimited reminders and all features."}
              </p>
            </div>
            {user.plan === "free" && (
              <Button variant="outline" size="sm" disabled>
                Upgrade
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-2">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

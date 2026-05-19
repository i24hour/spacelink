"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type UserProfile = {
  id: string;
  email: string;
  timezone: string;
  timezoneConfigured?: boolean;
  preferredChannels: string[];
  telegramId?: string;
  telegramConnected: boolean;
  plan: string;
};

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

export default function SettingsPage() {
  const { fetcher } = useApi();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [testResult, setTestResult] = useState<{ type: string; ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetcher("/api/users/me")
      .then((data: UserProfile) => setUser(data))
      .catch(console.error)
      .finally(() => setLoading(false));
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
    try {
      const updated = await fetcher("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          timezone: user.timezone,
          preferredChannels: user.preferredChannels,
        }),
      });
      setUser(updated);
      setTestResult({ type: "save", ok: true, msg: "Settings saved successfully." });
    } catch (e: any) {
      setTestResult({ type: "save", ok: false, msg: e.message || "Failed to save" });
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
    } catch (e: any) {
      setTestResult({ type: "telegram", ok: false, msg: e.message || "Failed to generate link" });
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setTestResult(null);
    try {
      const res = await fetcher("/api/notifications/test-email", { method: "POST" });
      setTestResult({ type: "email", ok: res.ok, msg: res.ok ? "Test email sent! Check your inbox." : res.error });
    } catch (e: any) {
      setTestResult({ type: "email", ok: false, msg: e.message || "Failed to send test email" });
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
    } catch (e: any) {
      setTestResult({ type: "telegram", ok: false, msg: e.message || "Failed to send test Telegram" });
    } finally {
      setTestingTelegram(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const telegramBotLink = process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME
    ? `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME}`
    : "https://t.me/";

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage reminders and notification channels.</p>
      </div>

      {testResult && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            testResult.ok
              ? "border-emerald-800/30 bg-emerald-900/10 text-emerald-400"
              : "border-red-800/30 bg-red-900/10 text-red-400"
          }`}
        >
          {testResult.msg}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Notification channels</CardTitle>
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
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
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
      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
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
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {user.telegramConnected ? (
            <div className="rounded-md bg-emerald-900/10 p-3 text-sm border border-emerald-800/30">
              <span className="font-medium text-emerald-400">Telegram connected</span>
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
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
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

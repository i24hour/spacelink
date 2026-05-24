import { prisma } from "../lib/prisma";
import {
  formatNowInTimezone,
  needsTimezoneSetup,
  timezoneLabel,
} from "../lib/timezones";
import { answerCallbackQuery, sendTelegramRaw } from "../services/notifications/telegram";
import { parseDateFromUserText } from "./deadline-parse";
import { clearPendingRemindersForLink } from "./reminders-smart";
import {
  extractUrlDataWithFallback,
  isDeadlinePassed,
  saveExtractedUrlData,
  updateLinkFromExtraction,
} from "./extraction-url";
import {
  applyReminderScheduleChoice,
  activateRemindersForLink,
  parseReminderScheduleCallback,
} from "./telegram-reminder-pick";
import { parseDailyReminderHour, formatDailyReminderHour } from "../lib/daily-reminder-time";
import {
  formatNextReminderLine,
  getNextPendingReminder,
  setUserDailyReminderHour,
} from "./reminder-engine";
import { runTelegramAssistant } from "./telegram-assistant";
import {
  lastDeadlineListByChat,
  refreshTrackedLinksListMessage,
  sendTrackedLinksList,
} from "./telegram-list";
import {
  applyTimezoneChoice,
  parseTimezoneCallback,
  sendTimezoneSetupPrompt,
} from "./telegram-timezone-pick";

// Detect if text contains a URL (with or without protocol)
function extractUrl(text: string): string | null {
  const candidates = text.match(/https?:\/\/[^\s<>"'`]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"'`]*)?/gi) || [];

  for (const rawCandidate of candidates) {
    let cleaned = rawCandidate.trim();

    // Remove common wrappers from both sides: (), [], {}, <>, quotes.
    cleaned = cleaned.replace(/^[\(\[\{<"'`]+/, "");
    cleaned = cleaned.replace(/[\)\]\}>"'`]+$/, "");

    // Remove trailing punctuation / wrappers accidentally attached to links.
    // Do this repeatedly so strings like "https://x.y/path)." become clean.
    let prev = "";
    while (cleaned !== prev) {
      prev = cleaned;
      cleaned = cleaned.replace(/[.,!?;:…]+$/g, "");
      cleaned = cleaned.replace(/[\)\]\}>"'`]+$/g, "");
    }

    if (!cleaned) continue;

    const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

    try {
      const parsed = new URL(withProtocol);
      if (!/^https?:$/.test(parsed.protocol)) continue;
      if (!parsed.hostname || !parsed.hostname.includes(".")) continue;
      return parsed.toString();
    } catch {
      continue;
    }
  }

  return null;
}

function formatRelativeDeadline(deadline: Date): string {
  const diffMs = deadline.getTime() - Date.now();
  const isPast = diffMs < 0;
  const totalSeconds = Math.max(0, Math.floor(Math.abs(diffMs) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const suffix = isPast ? "ago" : "left";
  return `${days}d ${hours}h ${minutes}m ${seconds}s ${suffix} (total ${totalMinutes}m ${seconds}s)`;
}

function formatPreciseTimeLeft(deadline: Date) {
  const diffMs = deadline.getTime() - Date.now();
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  return { days, hours, minutes, seconds, totalMinutes };
}

function formatDeadlineInTimezone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

type PendingDeadlineConfirmation = {
  linkId: string;
  awaiting: "manual_date";
};

const pendingDeadlineConfirmations = new Map<string, PendingDeadlineConfirmation>();

function normalizeCommand(raw: string): string {
  const first = raw.trim().split(/\s+/)[0] || "";
  return first.split("@")[0].toLowerCase();
}

function saysNoDeadline(text: string): boolean {
  const s = text.trim().toLowerCase();
  return (
    s.includes("no deadline") ||
    s.includes("no date") ||
    s.includes("without deadline") ||
    s === "skip" ||
    s === "none"
  );
}

async function updateLinkDeadlineAndReschedule(linkId: string, deadline: Date) {
  const updated = await prisma.savedLink.update({
    where: { id: linkId },
    data: {
      extractedDeadline: deadline,
      status: "active",
    },
  });

  await clearPendingRemindersForLink(linkId);
  return updated;
}

async function clearLinkDeadlineAndPendingReminders(linkId: string) {
  await prisma.savedLink.update({
    where: { id: linkId },
    data: {
      extractedDeadline: null,
      status: "active",
    },
  });
  await prisma.reminder.deleteMany({ where: { savedLinkId: linkId, sentStatus: "pending" } });
}

async function blockUntilTimezoneConfigured(
  chatId: string,
  user: { timezone: string; timezoneConfigured: boolean }
): Promise<boolean> {
  if (!needsTimezoneSetup(user)) return false;
  await sendTimezoneSetupPrompt(chatId);
  return true;
}

async function deleteTrackedLink(userId: string, rawQuery: string, chatId: string) {
  const query = rawQuery.trim();
  if (!query) return null;

  const asNumber = Number.parseInt(query, 10);
  if (Number.isFinite(asNumber) && String(asNumber) === query) {
    const ids = lastDeadlineListByChat.get(chatId) || [];
    const idx = asNumber - 1;
    if (idx >= 0 && idx < ids.length) {
      const byId = await prisma.savedLink.findFirst({
        where: { id: ids[idx], userId, status: { in: ["active", "pending"] } },
      });
      if (byId) return byId;
    }
  }

  const links = await prisma.savedLink.findMany({
    where: { userId, status: { in: ["active", "pending"] } },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });

  const lower = query.toLowerCase();
  return (
    links.find((l) => l.url === query) ||
    links.find((l) => l.title.toLowerCase().includes(lower)) ||
    links.find((l) => l.url.toLowerCase().includes(lower)) ||
    null
  );
}

export async function handleTelegramCallback(
  chatId: string,
  callbackQueryId: string,
  data: string,
  messageId?: number
) {
  const linkedUser = await prisma.user.findFirst({ where: { telegramId: chatId } });
  if (!linkedUser) {
    await answerCallbackQuery(callbackQueryId, "Sign in first");
    return;
  }

  const tzChoice = parseTimezoneCallback(data);
  if (tzChoice) {
    const result = await applyTimezoneChoice(chatId, linkedUser.id, tzChoice);
    await answerCallbackQuery(callbackQueryId, "Timezone saved");
    await sendTelegramRaw(chatId, result.message, "HTML");
    return;
  }

  if (data === "list:refresh" && messageId) {
    await refreshTrackedLinksListMessage(chatId, messageId, linkedUser.id, linkedUser.timezone);
    await answerCallbackQuery(callbackQueryId, "List updated");
    return;
  }

  const reminderPick = parseReminderScheduleCallback(data);
  if (reminderPick) {
    await answerCallbackQuery(callbackQueryId, "Reminders set");
    void applyReminderScheduleChoice(
      chatId,
      linkedUser.id,
      reminderPick.linkId,
      reminderPick.mode,
      { promptMessageId: messageId }
    )
      .then((result) => {
        if (result.silent || !result.message) return;
        if (result.ok) return sendTelegramRaw(chatId, result.message, "HTML");
        return sendTelegramRaw(chatId, result.message, "HTML");
      })
      .catch((err) => {
        console.error("Reminder schedule error:", err);
        return sendTelegramRaw(
          chatId,
          "⚠️ Could not set reminders. Please tap the button once more.",
          "HTML"
        );
      });
    return;
  }

  if (data.startsWith("del:")) {
    const idx = Number.parseInt(data.slice(4), 10);
    const ids = lastDeadlineListByChat.get(chatId) || [];
    const linkId = ids[idx];

    if (!linkId) {
      await answerCallbackQuery(callbackQueryId, "List expired — send /list again");
      return;
    }

    const link = await prisma.savedLink.findFirst({
      where: { id: linkId, userId: linkedUser.id },
    });

    if (!link) {
      await answerCallbackQuery(callbackQueryId, "Already removed");
      if (messageId) {
        await refreshTrackedLinksListMessage(
          chatId,
          messageId,
          linkedUser.id,
          linkedUser.timezone
        );
      }
      return;
    }

    await prisma.savedLink.delete({ where: { id: link.id } });
    pendingDeadlineConfirmations.delete(chatId);
    await answerCallbackQuery(callbackQueryId, `Deleted: ${link.title.slice(0, 40)}`);

    if (messageId) {
      await refreshTrackedLinksListMessage(
        chatId,
        messageId,
        linkedUser.id,
        linkedUser.timezone
      );
    } else {
      await sendTrackedLinksList(chatId, linkedUser.id, linkedUser.timezone);
    }
  }
}

export async function handleTelegramMessage(chatId: string, text: string) {
  const raw = text.trim();
  const cmd = normalizeCommand(raw);
  const detectedUrl = extractUrl(raw);
  const linkedUser = await prisma.user.findFirst({ where: { telegramId: chatId } });
  const webAppUrl = process.env.WEB_APP_URL || "https://web-i24hours-projects.vercel.app";

  async function connectThisChatUrl(): Promise<string> {
    const { createTelegramChatLinkToken } = await import("../lib/auth.js");
    const token = createTelegramChatLinkToken(chatId);
    return `${webAppUrl}/auth?tgLink=${encodeURIComponent(token)}`;
  }

  // /start deep-link auth
  if (cmd.startsWith("/start")) {
    const token = raw.split(/\s+/)[1];
    if (token) {
      const { consumeTelegramLinkToken } = await import("../lib/auth.js");
      const userId = consumeTelegramLinkToken(token);
      if (userId) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
          await sendTelegramRaw(chatId, "That link is no longer valid. Please generate a new connect link.", "HTML");
          return;
        }

        const preferredChannels = user.preferredChannels.includes("telegram")
          ? user.preferredChannels
          : [...user.preferredChannels, "telegram"];

        await prisma.user.update({
          where: { id: userId },
          data: {
            telegramId: chatId,
            preferredChannels: { set: preferredChannels },
          },
        });
        const connected = await prisma.user.findUnique({ where: { id: userId } });
        await sendTelegramRaw(
          chatId,
          "🎉 <b>You're connected!</b>\n\nNow just paste any link here and I'll extract deadlines, track them, and remind you.",
          "HTML"
        );
        if (connected && needsTimezoneSetup(connected)) {
          await sendTimezoneSetupPrompt(chatId);
        }
        return;
      }
      await sendTelegramRaw(chatId, "That link expired. Open the extension and click Connect Telegram again.", "HTML");
      return;
    }

    if (linkedUser) {
      if (needsTimezoneSetup(linkedUser)) {
        await sendTimezoneSetupPrompt(chatId);
        return;
      }
      await sendTelegramRaw(
        chatId,
        "✅ <b>You are connected.</b>\n\nYour account is already linked. Paste any opportunity link and I'll track it.\n\n<b>Quick commands:</b>\n/status - Connection status\n/deadlines - Upcoming deadlines\n/help - All commands",
        "HTML"
      );
      return;
    }

    await sendTelegramRaw(
      chatId,
      `👋 <b>Welcome to DeadlineAI!</b>\n\nI track deadlines from any link you paste — hackathons, internships, grants, programs, and more.\n\n<b>Get started:</b>\n1️⃣ <a href="${await connectThisChatUrl()}">Sign in with Google (connect this chat)</a>\n2️⃣ Come back here and paste any link\n3️⃣ I'll extract the deadline and remind you daily\n\n<b>Commands:</b>\n/status - Connection status\n/deadlines - Your upcoming deadlines\n/help - All commands\n\nJust paste a link to start!`,
      "HTML"
    );
    return;
  }

  // /timezone — change or set timezone anytime
  if (cmd === "/timezone") {
    if (!linkedUser) {
      await sendTelegramRaw(
        chatId,
        `❌ Sign in first.\n\n<a href="${await connectThisChatUrl()}">Connect with Google</a>`,
        "HTML"
      );
      return;
    }
    await sendTimezoneSetupPrompt(chatId);
    return;
  }

  // /status
  if (cmd === "/status") {
    if (linkedUser) {
      const nowStr = formatNowInTimezone(linkedUser.timezone);
      const dailyAt = formatDailyReminderHour(linkedUser.dailyReminderHour ?? 9, linkedUser.timezone);
      const next = await getNextPendingReminder(linkedUser.id);
      const tzLine = needsTimezoneSetup(linkedUser)
        ? "⚠️ <b>Timezone not set</b> — tap /timezone to choose IST, PT, PST, etc."
        : `🌍 Timezone: <b>${timezoneLabel(linkedUser.timezone)}</b>\n🕐 Now: <b>${nowStr}</b>\n🔔 Daily reminder time: <b>${dailyAt}</b>`;
      const nextLine = formatNextReminderLine(linkedUser, next);
      await sendTelegramRaw(
        chatId,
        `✅ <b>Connected</b>\n\nLogged in as: <code>${linkedUser.email}</code>\n\n${tzLine}\n${nextLine}\n\nPaste any link to track deadlines.`,
        "HTML"
      );
      return;
    }
    await sendTelegramRaw(
      chatId,
      `❌ <b>Not connected</b>\n\n<a href="${await connectThisChatUrl()}">Sign in with Google and connect this Telegram chat</a>`,
      "HTML"
    );
    return;
  }

  // /list and /deadlines — card-style list with inline delete buttons
  if (cmd === "/list" || cmd === "/deadlines") {
    if (!linkedUser) {
      await sendTelegramRaw(chatId, "You need to sign in first. Visit https://web-i24hours-projects.vercel.app/auth", "HTML");
      return;
    }
    if (await blockUntilTimezoneConfigured(chatId, linkedUser)) return;
    await sendTrackedLinksList(chatId, linkedUser.id, linkedUser.timezone);
    return;
  }

  // /delete
  if (cmd.startsWith("/delete")) {
    if (!linkedUser) {
      await sendTelegramRaw(chatId, "You need to sign in first. Visit https://web-i24hours-projects.vercel.app/auth", "HTML");
      return;
    }
    if (await blockUntilTimezoneConfigured(chatId, linkedUser)) return;

    const query = raw.replace(/^\/delete\s*/i, "").trim();
    if (!query) {
      await sendTelegramRaw(
        chatId,
        "Usage: /delete <number|title|url>\n\nExample:\n/delete 2\n/delete a16z",
        "HTML"
      );
      return;
    }

    const target = await deleteTrackedLink(linkedUser.id, query, chatId);
    if (!target) {
      await sendTelegramRaw(chatId, "I couldn't find that tracked link. Use /list first, then /delete <number>.", "HTML");
      return;
    }

    await prisma.savedLink.delete({ where: { id: target.id } });
    pendingDeadlineConfirmations.delete(chatId);
    await sendTelegramRaw(chatId, `🗑️ Deleted: <b>${target.title}</b>`, "HTML");
    return;
  }

  // /help
  if (cmd === "/help") {
    await sendTelegramRaw(
      chatId,
      "<b>DeadlineAI Bot</b>\n\nTrack deadlines from any opportunity link.\n\n<b>Get started:</b>\n<a href=\"https://web-i24hours-projects.vercel.app/auth\">👉 Sign in with Google</a>\n\n<b>How it works:</b>\n1️⃣ Sign in above\n2️⃣ Pick your timezone (IST, PT, PST, …)\n3️⃣ Paste any link here\n4️⃣ AI extracts the deadline in your timezone\n\n<b>Commands:</b>\n/timezone - Set or change timezone\n/list - All tracked links (with delete buttons)\n/deadlines - Same as /list\n/delete &lt;number|title|url&gt; - Delete a tracked link\n/help - This message",
      "HTML"
    );
    return;
  }

  // Change daily reminder hour via text (default 9 AM in user timezone)
  if (linkedUser) {
    const hour = parseDailyReminderHour(raw);
    if (hour !== null && /remind/i.test(raw)) {
      await setUserDailyReminderHour(linkedUser.id, hour);
      const label = formatDailyReminderHour(hour, linkedUser.timezone);
      await sendTelegramRaw(
        chatId,
        `✅ <b>Daily reminder time updated</b>\n\nAll active links will ping at <b>${label}</b> (${linkedUser.timezone}).\n\nCheck /status for the next scheduled ping.`,
        "HTML"
      );
      return;
    }
  }

  // Manual date flow when a saved link has no on-page deadline (TBD)
  if (linkedUser) {
    if (await blockUntilTimezoneConfigured(chatId, linkedUser)) return;

    const pending = pendingDeadlineConfirmations.get(chatId);
    if (pending && !detectedUrl) {
      if (pending.awaiting === "manual_date") {
        if (saysNoDeadline(raw)) {
          await clearLinkDeadlineAndPendingReminders(pending.linkId);
          pendingDeadlineConfirmations.delete(chatId);
          await sendTelegramRaw(chatId, "✅ Done. Kept this link without any deadline.", "HTML");
          return;
        }

        const parsed = await parseDateFromUserText(raw, linkedUser.timezone);
        if (parsed) {
          const updated = await updateLinkDeadlineAndReschedule(pending.linkId, parsed);
          pendingDeadlineConfirmations.delete(chatId);
          await activateRemindersForLink(chatId, updated, linkedUser);
          return;
        }

        await sendTelegramRaw(
          chatId,
          "I couldn't parse that date. Send a clear date/time (example: 2026-06-30 11:59 PM IST) or type <b>no deadline</b>.",
          "HTML"
        );
        return;
      }
    }
  }

  // Natural-language "time left in hours" questions
  const asksTimeLeft =
    /\b(hours?|hrs?)\b/.test(cmd) ||
    /how much time/.test(cmd) ||
    /time left/.test(cmd) ||
    /remaining time/.test(cmd);

  if (linkedUser && asksTimeLeft) {
    if (await blockUntilTimezoneConfigured(chatId, linkedUser)) return;

    const next = await prisma.savedLink.findFirst({
      where: {
        userId: linkedUser.id,
        status: { in: ["active", "pending"] },
        extractedDeadline: { gte: new Date() },
      },
      orderBy: { extractedDeadline: "asc" },
    });

    if (!next || !next.extractedDeadline) {
      await sendTelegramRaw(
        chatId,
        "I couldn't find an upcoming deadline. Paste a link first, then ask me for hours left.",
        "HTML"
      );
      return;
    }

    const deadline = new Date(next.extractedDeadline);
    const left = formatPreciseTimeLeft(deadline);

    await sendTelegramRaw(
      chatId,
      `⏳ <b>Time left</b>\n\n<b>${next.title}</b>\n<b>${left.days}d ${left.hours}h ${left.minutes}m ${left.seconds}s left</b>\n(total ${left.totalMinutes}m ${left.seconds}s)\nDeadline: ${formatDeadlineInTimezone(deadline, linkedUser.timezone)}`,
      "HTML"
    );
    return;
  }

  // URL detection - user pasted a link
  if (detectedUrl) {
    const url = detectedUrl;
    // Check if user exists
    const user = linkedUser;
    if (user && (await blockUntilTimezoneConfigured(chatId, user))) return;

    if (!user) {
      await sendTelegramRaw(
        chatId,
        `🔐 <b>Please sign in first</b>\n\n<a href="${await connectThisChatUrl()}">👉 Sign in with Google and connect this Telegram chat</a>\n\nThen come back and paste your link!`,
        "HTML"
      );
      return;
    }

    const existing = await prisma.savedLink.findFirst({
      where: { userId: user.id, url },
    });

    const stillUpcoming =
      existing?.extractedDeadline && !isDeadlinePassed(existing.extractedDeadline);

    if (existing && stillUpcoming) {
      const date = formatDeadlineInTimezone(
        new Date(existing.extractedDeadline!),
        user.timezone
      );
      const left = formatRelativeDeadline(new Date(existing.extractedDeadline!));
      await sendTelegramRaw(
        chatId,
        `✅ <b>Already on your list</b>\n\n<b>${existing.title}</b>\n📅 ${date} · ${left}\n\nUse /list to see it.`,
        "HTML"
      );
      return;
    }

    const restarting = Boolean(existing);
    await sendTelegramRaw(
      chatId,
      restarting
        ? "🔄 Re-checking this link and updating the deadline…"
        : "🔄 Reading the page and extracting deadline info...",
      "HTML"
    );

    try {
      const extracted = await extractUrlDataWithFallback(url, user.timezone);
      if (!extracted) {
        await sendTelegramRaw(
          chatId,
          "❌ Couldn't extract a deadline from this page. You can try saving it via the browser extension for better results.",
          "HTML"
        );
        return;
      }

      const result = existing
        ? await updateLinkFromExtraction(existing.id, extracted)
        : await saveExtractedUrlData(url, user.id, extracted, {
            autoScheduleReminders: false,
          });

      if (!result.extractedDeadline) {
        pendingDeadlineConfirmations.set(chatId, {
          linkId: result.id,
          awaiting: "manual_date",
        });
        await sendTelegramRaw(
          chatId,
          `✅ <b>${restarting ? "Updated" : "Saved"}</b>, but I could not find an explicit deadline yet.\n\n<b>${result.title}</b>\n📅 TBD\n\nIf you know the date, send it now (example: 2026-06-30 11:59 PM IST).`,
          "HTML"
        );
        return;
      }

      if (isDeadlinePassed(result.extractedDeadline)) {
        const dateStr = formatDeadlineInTimezone(
          new Date(result.extractedDeadline),
          user.timezone
        );
        const ago = formatRelativeDeadline(new Date(result.extractedDeadline));
        await sendTelegramRaw(
          chatId,
          `⏰ <b>This deadline has already passed</b>\n\n` +
            `<b>${result.title}</b>\n` +
            `📅 ${dateStr}\n` +
            `(${ago})\n\n` +
            `It won't appear in /list (only upcoming deadlines). ` +
            `If the date on the page is wrong, send the correct date here or paste again after the site updates.`,
          "HTML"
        );
        return;
      }

      if (restarting) {
        await sendTelegramRaw(
          chatId,
          `♻️ <b>Link refreshed</b> — deadline is still upcoming.`,
          "HTML"
        );
      }

      await activateRemindersForLink(chatId, result, user, {
        category: result.category,
        estimatedMinutes: result.estimatedCompletionMinutes,
      });
    } catch (e: any) {
      console.error("Telegram URL processing error:", e);
      await sendTelegramRaw(chatId, "❌ Error processing that link. Please try again or use the browser extension.", "HTML");
    }
    return;
  }

  // Natural-language list requests (avoid LLM markdown tables)
  const lowerRaw = raw.toLowerCase();
  if (
    linkedUser &&
    (cmd === "list" ||
      /^list\s+(all|my|everything)/.test(lowerRaw) ||
      /^(show|get)\s+(all\s+)?(my\s+)?(links|deadlines|items)/.test(lowerRaw) ||
      /^what\s+do\s+i\s+have/.test(lowerRaw) ||
      /^all\s+(my\s+)?(links|deadlines|things)/.test(lowerRaw))
  ) {
    if (await blockUntilTimezoneConfigured(chatId, linkedUser)) return;
    await sendTrackedLinksList(chatId, linkedUser.id, linkedUser.timezone);
    return;
  }

  // Natural language — LLM + database tools (set deadline, delete, refresh, etc.)
  if (linkedUser) {
    if (await blockUntilTimezoneConfigured(chatId, linkedUser)) return;

    try {
      const reply = await runTelegramAssistant(linkedUser, raw);
      if (reply?.text) {
        await sendTelegramRaw(chatId, reply.text, "HTML");
        if (reply.reminderPickLinkId) {
          const link = await prisma.savedLink.findUnique({
            where: { id: reply.reminderPickLinkId },
          });
          if (link?.extractedDeadline) {
            await activateRemindersForLink(chatId, link, linkedUser);
          }
        }
        return;
      }
    } catch (e) {
      console.error("Telegram assistant error:", e);
    }
  }

  await sendTelegramRaw(
    chatId,
    `I didn't understand that.\n\n👉 <b>Paste a link</b> (like istocks.codes) to track a deadline\n👉 <a href="${await connectThisChatUrl()}">Sign in with Google and connect this chat</a>\n👉 Use <b>/status</b> to check connection\n👉 Use <b>/help</b> for all commands`,
    "HTML"
  );
}

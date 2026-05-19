import { prisma } from "../lib/prisma";
import { sendTelegramRaw } from "../services/notifications/telegram";
import { extractWithLLM } from "../lib/llm";
import { scheduleSmartRemindersForLink } from "./reminders-smart";
import { extractUrlDataWithFallback, saveExtractedUrlData } from "./extraction-url";
import { runTelegramAssistant } from "./telegram-assistant";

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
const lastDeadlineListByChat = new Map<string, string[]>();

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

async function parseDateFromUserText(input: string): Promise<Date | null> {
  const direct = new Date(input);
  if (!Number.isNaN(direct.getTime())) return direct;

  const extracted = await extractWithLLM(`
Extract a deadline date-time from this text.
Text: ${input}

Return JSON only:
{
  "deadline": "2026-05-20T23:59:00"
}

If no clear date exists, return:
{ "deadline": null }
`.trim());

  if (!extracted || extracted.deadline == null) return null;
  const parsed = new Date(extracted.deadline);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function updateLinkDeadlineAndReschedule(linkId: string, deadline: Date) {
  const updated = await prisma.savedLink.update({
    where: { id: linkId },
    data: {
      extractedDeadline: deadline,
      status: "active",
    },
  });

  await prisma.reminder.deleteMany({ where: { savedLinkId: linkId, sentStatus: "pending" } });
  await scheduleSmartRemindersForLink(updated as any);
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

export async function handleTelegramMessage(chatId: string, text: string) {
  const raw = text.trim();
  const cmd = raw.toLowerCase();
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
        await sendTelegramRaw(
          chatId,
          "🎉 <b>You're connected!</b>\n\nNow just paste any link here (e.g. istocks.codes) and I'll:\n• Extract the deadline with AI\n• Track it for you\n• Send daily countdowns\n• Alert you every hour when it's urgent\n\n<b>Commands:</b>\n/deadlines - See your deadlines\n/help - All commands",
          "HTML"
        );
        return;
      }
      await sendTelegramRaw(chatId, "That link expired. Open the extension and click Connect Telegram again.", "HTML");
      return;
    }

    if (linkedUser) {
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

  // /status
  if (cmd === "/status") {
    if (linkedUser) {
      await sendTelegramRaw(
        chatId,
        `✅ <b>Connected</b>\n\nLogged in as: <code>${linkedUser.email}</code>\n\nPaste any link to track deadlines.`,
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

  // /deadlines
  if (cmd === "/deadlines") {
    const user = linkedUser;
    if (!user) {
      await sendTelegramRaw(chatId, "You need to sign in first. Visit https://web-i24hours-projects.vercel.app/auth", "HTML");
      return;
    }
    const links = await prisma.savedLink.findMany({
      where: { userId: user.id, status: { in: ["active", "pending"] } },
      orderBy: { extractedDeadline: "asc" },
      take: 15,
    });

    if (links.length === 0) {
      await sendTelegramRaw(chatId, "No deadlines tracked yet. Paste a link here or save via the browser extension!", "HTML");
      return;
    }

    const lines = links.map((l, i) => {
      const date = l.extractedDeadline
        ? formatDeadlineInTimezone(new Date(l.extractedDeadline), user.timezone)
        : "TBD";
      const timeLeft = l.extractedDeadline ? formatRelativeDeadline(new Date(l.extractedDeadline)) : "";
      return `${i + 1}. <b>${l.title}</b>\n   📅 ${date}${timeLeft ? ` · ${timeLeft}` : ""}${l.category ? ` · ${l.category}` : ""}${l.urgencyScore && l.urgencyScore >= 7 ? " 🔥" : ""}`;
    });
    lastDeadlineListByChat.set(chatId, links.map((l) => l.id));

    await sendTelegramRaw(chatId, `<b>Your upcoming deadlines</b>\n\n${lines.join("\n\n")}`, "HTML");
    return;
  }

  // /delete
  if (cmd.startsWith("/delete")) {
    if (!linkedUser) {
      await sendTelegramRaw(chatId, "You need to sign in first. Visit https://web-i24hours-projects.vercel.app/auth", "HTML");
      return;
    }

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
      await sendTelegramRaw(chatId, "I couldn't find that tracked link. Use /deadlines first, then /delete <number>.", "HTML");
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
      "<b>DeadlineAI Bot</b>\n\nTrack deadlines from any opportunity link.\n\n<b>Get started:</b>\n<a href=\"https://web-i24hours-projects.vercel.app/auth\">👉 Sign in with Google</a>\n\n<b>How it works:</b>\n1️⃣ Sign in above\n2️⃣ Paste any link here (e.g. istocks.codes)\n3️⃣ AI extracts the deadline\n4️⃣ Get daily countdowns + hourly alerts when urgent\n\n<b>Commands:</b>\n/deadlines - Your upcoming deadlines\n/delete &lt;number|title|url&gt; - Delete a tracked link\n/help - This message",
      "HTML"
    );
    return;
  }

  // Manual date flow when a saved link has no on-page deadline (TBD)
  if (linkedUser) {
    const pending = pendingDeadlineConfirmations.get(chatId);
    if (pending && !detectedUrl) {
      if (pending.awaiting === "manual_date") {
        if (saysNoDeadline(raw)) {
          await clearLinkDeadlineAndPendingReminders(pending.linkId);
          pendingDeadlineConfirmations.delete(chatId);
          await sendTelegramRaw(chatId, "✅ Done. Kept this link without any deadline.", "HTML");
          return;
        }

        const parsed = await parseDateFromUserText(raw);
        if (parsed) {
          await updateLinkDeadlineAndReschedule(pending.linkId, parsed);
          pendingDeadlineConfirmations.delete(chatId);
          await sendTelegramRaw(
            chatId,
            `✅ Updated deadline saved: <b>${formatDeadlineInTimezone(parsed, linkedUser.timezone)}</b>`,
            "HTML"
          );
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
    if (!user) {
      await sendTelegramRaw(
        chatId,
        `🔐 <b>Please sign in first</b>\n\n<a href="${await connectThisChatUrl()}">👉 Sign in with Google and connect this Telegram chat</a>\n\nThen come back and paste your link!`,
        "HTML"
      );
      return;
    }

    // Check for duplicates
    const existing = await prisma.savedLink.findFirst({
      where: { userId: user.id, url },
    });
    if (existing) {
      const date = existing.extractedDeadline
        ? formatDeadlineInTimezone(new Date(existing.extractedDeadline), user.timezone)
        : "TBD";
      const left = existing.extractedDeadline ? formatRelativeDeadline(new Date(existing.extractedDeadline)) : "";
      await sendTelegramRaw(
        chatId,
        `⚠️ Already tracking this link!\n\n<b>${existing.title}</b>\n📅 ${date}${left ? ` · ${left}` : ""}\n\nUse /deadlines to see all.`,
        "HTML"
      );
      return;
    }

    await sendTelegramRaw(chatId, "🔄 Reading the page and extracting deadline info...", "HTML");

    try {
      const extracted = await extractUrlDataWithFallback(url);
      if (!extracted) {
        await sendTelegramRaw(chatId, "❌ Couldn't extract a deadline from this page. You can try saving it via the browser extension for better results.", "HTML");
        return;
      }

      const result = await saveExtractedUrlData(url, user.id, extracted);

      if (!result.extractedDeadline) {
        pendingDeadlineConfirmations.set(chatId, {
          linkId: result.id,
          awaiting: "manual_date",
        });
        await sendTelegramRaw(
          chatId,
          `✅ <b>Saved</b>, but I could not find an explicit deadline yet.\n\n<b>${result.title}</b>\n📅 TBD\n\nIf you know the date, send it now (example: 2026-06-30 11:59 PM IST).`,
          "HTML"
        );
        return;
      }

      const deadline = new Date(result.extractedDeadline);
      const date = formatDeadlineInTimezone(deadline, user.timezone);
      const left = formatRelativeDeadline(deadline);

      await sendTelegramRaw(
        chatId,
        `✅ <b>Deadline tracked!</b>\n\n<b>${result.title}</b>\n📅 ${date} · ${left}${result.category ? `\n🏷 ${result.category}` : ""}${result.estimatedCompletionMinutes ? `\n⏱ ~${result.estimatedCompletionMinutes} min to complete` : ""}\n\nI'll send you daily countdowns and hourly alerts when the deadline is near.`,
        "HTML"
      );
    } catch (e: any) {
      console.error("Telegram URL processing error:", e);
      await sendTelegramRaw(chatId, "❌ Error processing that link. Please try again or use the browser extension.", "HTML");
    }
    return;
  }

  // Unknown message
  if (linkedUser) {
    try {
      const llmReply = await runTelegramAssistant(linkedUser, raw);
      if (llmReply) {
        await sendTelegramRaw(chatId, llmReply, "HTML");
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

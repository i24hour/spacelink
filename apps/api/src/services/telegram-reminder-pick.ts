import type { SavedLink, User } from "@deadlineai/db";
import { prisma } from "../lib/prisma";
import {
  REMINDER_SCHEDULE_LABELS,
  type ReminderScheduleMode,
  clearPendingRemindersForLink,
  persistReminderSchedule,
  scheduleSmartRemindersForLink,
} from "./reminders-smart";
import {
  editTelegramMessage,
  sendTelegramMessage,
  type InlineKeyboard,
} from "./notifications/telegram";

/** Prevents parallel callback taps from stacking duplicate reminder rows. */
const scheduleLocks = new Map<string, Promise<{ ok: boolean; alreadySet?: boolean; message: string }>>();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

export function buildReminderScheduleKeyboard(linkId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "📅 Daily reminders", callback_data: `rem:all:${linkId}` }],
      [{ text: "📅 Daily · last 10 days", callback_data: `rem:10d:${linkId}` }],
      [{ text: "📅 Daily · last 5 days", callback_data: `rem:5d:${linkId}` }],
    ],
  };
}

export function parseReminderScheduleCallback(
  data: string
): { mode: ReminderScheduleMode; linkId: string } | null {
  const m = data.match(/^rem:(all|10d|5d):(.+)$/);
  if (!m) return null;
  const mode =
    m[1] === "all" ? "daily_all" : m[1] === "10d" ? "daily_10d" : "daily_5d";
  return { mode, linkId: m[2] };
}

export async function sendReminderSchedulePrompt(
  chatId: string,
  link: SavedLink,
  user: User,
  extra?: { category?: string | null; estimatedMinutes?: number | null }
) {
  const deadline = link.extractedDeadline ? new Date(link.extractedDeadline) : null;
  if (!deadline) return;

  const dateStr = formatDeadlineInTimezone(deadline, user.timezone);
  const msLeft = deadline.getTime() - Date.now();
  const hoursLeft = Math.max(0, Math.floor(msLeft / (1000 * 60 * 60)));
  const inFinalDay = msLeft > 0 && msLeft <= 24 * 60 * 60 * 1000;

  const category = extra?.category ?? link.category;
  const est = extra?.estimatedMinutes ?? link.estimatedCompletionMinutes;

  let text =
    `✅ <b>Deadline found!</b>\n\n` +
    `<b>${escapeHtml(link.title)}</b>\n` +
    `📅 ${escapeHtml(dateStr)}`;

  if (category) text += `\n🏷 ${escapeHtml(category)}`;
  if (est) text += `\n⏱ ~${est} min to complete`;

  text +=
    `\n\n<b>Choose reminder style:</b>\n` +
    `1️⃣ Daily — every day until deadline\n` +
    `2️⃣ Daily — only in the last <b>10 days</b>\n` +
    `3️⃣ Daily — only in the last <b>5 days</b>\n\n` +
    `⏰ <i>All options include hourly alerts in the final 24 hours.</i>`;

  if (inFinalDay) {
    text += `\n\n⚡ <b>Less than 24h left</b> — hourly reminders will start right away (${hoursLeft}h remaining).`;
  }

  await sendTelegramMessage(chatId, text, {
    parseMode: "HTML",
    replyMarkup: buildReminderScheduleKeyboard(link.id),
  });
}

export async function applyReminderScheduleChoice(
  chatId: string,
  userId: string,
  linkId: string,
  mode: ReminderScheduleMode,
  options?: { promptMessageId?: number }
) {
  const lockKey = `${linkId}:${mode}`;
  const inFlight = scheduleLocks.get(lockKey);
  if (inFlight) {
    return {
      ok: true as const,
      alreadySet: true as const,
      silent: true as const,
      message: "",
    };
  }

  const run = async (): Promise<{
    ok: boolean;
    alreadySet?: boolean;
    silent?: boolean;
    message: string;
  }> => {
  const link = await prisma.savedLink.findFirst({
    where: { id: linkId, userId },
  });
  if (!link || !link.extractedDeadline) {
    return { ok: false, message: "Link not found or has no deadline." };
  }

  const meta = (link.metadata || {}) as Record<string, unknown>;
  if (meta.reminder_schedule === mode) {
    const existing = await prisma.reminder.count({
      where: { savedLinkId: linkId, sentStatus: "pending" },
    });
    if (existing > 0) {
      return {
        ok: true,
        alreadySet: true,
        silent: true,
        message: "",
      };
    }
  }

  await clearPendingRemindersForLink(linkId);
  await persistReminderSchedule(linkId, mode);

  const updated = await prisma.savedLink.findUnique({ where: { id: linkId } });
  if (!updated) return { ok: false, message: "Could not update link." };

  const result = await scheduleSmartRemindersForLink(updated, mode);
  const label = REMINDER_SCHEDULE_LABELS[mode];

  const msLeft = new Date(link.extractedDeadline).getTime() - Date.now();
  const hourlyNote =
    msLeft <= 24 * 60 * 60 * 1000
      ? "\n⏰ Hourly alerts every hour until the deadline."
      : "\n⏰ Hourly alerts start in the final 24 hours before the deadline.";

  let scheduleLine = "";
  if (result && result.total > 0) {
    const ch = result.channels.join(" + ");
    const dailyN = result.daily / Math.max(1, result.channels.length);
    const hourlyN = result.hourly / Math.max(1, result.channels.length);
    scheduleLine =
      `\n\n📬 <b>Scheduled:</b> ${dailyN} daily ping${dailyN === 1 ? "" : "s"}` +
      (hourlyN > 0 ? `, then ~${hourlyN} hourly near the end` : "") +
      ` · via ${escapeHtml(ch)}`;
    if (result.channels.length > 1) {
      scheduleLine +=
        `\n<i>Using email and Telegram — turn one off in web Settings if you want fewer pings.</i>`;
    }
  }

  const confirmText =
      `✅ <b>Reminders set</b>\n\n` +
      `<b>${escapeHtml(link.title)}</b>\n` +
      `📋 ${escapeHtml(label)}` +
      hourlyNote +
      scheduleLine;

  if (options?.promptMessageId) {
    await editTelegramMessage(chatId, options.promptMessageId, confirmText, {
      parseMode: "HTML",
    }).catch(() => {});
  }

  return {
    ok: true,
    message: options?.promptMessageId ? "" : confirmText,
  };
  };

  const promise = run();
  scheduleLocks.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    scheduleLocks.delete(lockKey);
  }
}

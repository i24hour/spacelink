import type { SavedLink, User } from "@deadlineai/db";
import { prisma } from "../lib/prisma";
import {
  acquireScheduleLock,
  releaseScheduleLock,
} from "../lib/telegram-state";
import { REMINDER_SCHEDULE_LABELS, type ReminderScheduleMode } from "./reminders-smart";
import {
  formatNextReminderLine,
  formatScheduleConfirmation,
  getNextPendingReminder,
  rebuildRemindersForLink,
} from "./reminder-engine";
import {
  editTelegramMessage,
  sendTelegramMessage,
  type InlineKeyboard,
} from "./notifications/telegram";

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
      [{ text: "📅 Daily · all days", callback_data: `rem:all:${linkId}` }],
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

/** Auto-schedule default reminders when a deadline is saved (no button required). */
export async function activateRemindersForLink(
  chatId: string,
  link: SavedLink,
  user: User,
  extra?: { category?: string | null; estimatedMinutes?: number | null }
) {
  const deadline = link.extractedDeadline ? new Date(link.extractedDeadline) : null;
  if (!deadline) return;

  const dateStr = formatDeadlineInTimezone(deadline, user.timezone);
  const category = extra?.category ?? link.category;
  const est = extra?.estimatedMinutes ?? link.estimatedCompletionMinutes;

  const summary = await rebuildRemindersForLink(link.id, "daily_all");

  let text =
    `✅ <b>Deadline saved</b>\n\n` +
    `<b>${escapeHtml(link.title)}</b>\n` +
    `📅 ${escapeHtml(dateStr)}`;
  if (category) text += `\n🏷 ${escapeHtml(category)}`;
  if (est) text += `\n⏱ ~${est} min to complete`;

  if ("error" in summary) {
    text += `\n\n⚠️ ${escapeHtml(summary.error)}`;
    await sendTelegramMessage(chatId, text, { parseMode: "HTML" });
    return;
  }

  text = `${text}\n\n${formatScheduleConfirmation(user, link, summary)}`;
  const next = await getNextPendingReminder(user.id);
  text += `\n${formatNextReminderLine(user, next)}`;

  await sendTelegramMessage(chatId, text, {
    parseMode: "HTML",
    replyMarkup: buildReminderScheduleKeyboard(link.id),
  });
}

export type ReminderScheduleChoiceResult = {
  ok: boolean;
  message: string;
  silent?: boolean;
  alreadySet?: boolean;
};

export async function applyReminderScheduleChoice(
  chatId: string,
  userId: string,
  linkId: string,
  mode: ReminderScheduleMode,
  options?: { promptMessageId?: number }
): Promise<ReminderScheduleChoiceResult> {
  const lockKey = `${linkId}:${mode}`;
  const acquired = await acquireScheduleLock(linkId, mode);
  if (!acquired) {
    return { ok: true as const, alreadySet: true as const, silent: true as const, message: "" };
  }

  try {
    const link = await prisma.savedLink.findFirst({
      where: { id: linkId, userId },
      include: { user: true },
    });
    if (!link || !link.extractedDeadline) {
      return { ok: false, message: "Link not found or has no deadline." };
    }

    const summary = await rebuildRemindersForLink(linkId, mode);
    if ("error" in summary) {
      return { ok: false, message: summary.error };
    }

    const user = link.user;
    let confirmText =
      formatScheduleConfirmation(user, link, summary) +
      `\n📋 ${escapeHtml(REMINDER_SCHEDULE_LABELS[mode])}`;
    const next = await getNextPendingReminder(userId);
    confirmText += `\n${formatNextReminderLine(user, next)}`;

    if (options?.promptMessageId) {
      await editTelegramMessage(chatId, options.promptMessageId, confirmText, {
        parseMode: "HTML",
      }).catch(() => {});
    }

    return { ok: true, message: options?.promptMessageId ? "" : confirmText };
  } finally {
    await releaseScheduleLock(linkId, mode);
  }
}

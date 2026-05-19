import type { SavedLink } from "@deadlineai/db";
import { prisma } from "../lib/prisma";
import {
  type InlineKeyboard,
  editTelegramMessage,
  sendTelegramMessage,
} from "./notifications/telegram";

/** Maps Telegram chat → ordered link ids from the last /list or /deadlines message */
export const lastDeadlineListByChat = new Map<string, string[]>();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
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
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function formatShortCountdown(deadline: Date): string {
  const diffMs = deadline.getTime() - Date.now();
  if (diffMs < 0) return "⚠️ passed";
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `⏳ ${days}d ${hours}h left`;
  if (hours > 0) return `⏳ ${hours}h left`;
  return `⏳ ${minutes}m left`;
}

export function buildTrackedLinksListMessage(
  links: SavedLink[],
  timezone: string
): string {
  if (links.length === 0) {
    return "📭 <b>No tracked links yet</b>\n\nPaste a URL here or save from the browser extension.";
  }

  const blocks = links.map((link, i) => {
    const n = i + 1;
    const title = escapeHtml(truncate(link.title, 56));
    const category = link.category ? ` · ${escapeHtml(link.category)}` : "";

    if (!link.extractedDeadline) {
      return (
        `<b>${n}.</b> ${title}${category}\n` +
        `   📅 <i>No deadline yet</i>\n` +
        `   🔗 <a href="${escapeHtml(link.url)}">open link</a>`
      );
    }

    const deadline = new Date(link.extractedDeadline);
    const dateStr = formatDeadlineInTimezone(deadline, timezone);
    const countdown = formatShortCountdown(deadline);
    const urgent = link.urgencyScore && link.urgencyScore >= 7 ? " 🔥" : "";

    return (
      `<b>${n}.</b> ${title}${category}${urgent}\n` +
      `   📅 ${escapeHtml(dateStr)}\n` +
      `   ${countdown}\n` +
      `   🔗 <a href="${escapeHtml(link.url)}">open link</a>`
    );
  });

  return (
    `📋 <b>Your tracked links</b> (${links.length})\n\n` +
    `${blocks.join("\n\n")}\n\n` +
    `<i>Tap a delete button below to remove an item.</i>`
  );
}

export function buildDeleteKeyboard(linkCount: number): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = [];
  const perRow = 3;

  for (let i = 0; i < linkCount; i += perRow) {
    const row = [];
    for (let j = i; j < Math.min(i + perRow, linkCount); j++) {
      row.push({ text: `🗑 ${j + 1}`, callback_data: `del:${j}` });
    }
    rows.push(row);
  }

  rows.push([{ text: "🔄 Refresh list", callback_data: "list:refresh" }]);
  return { inline_keyboard: rows };
}

export async function fetchTrackedLinks(userId: string, limit = 20) {
  return prisma.savedLink.findMany({
    where: { userId, status: { in: ["active", "pending"] } },
    orderBy: [{ extractedDeadline: "asc" }, { createdAt: "desc" }],
    take: limit,
  });
}

export async function sendTrackedLinksList(
  chatId: string,
  userId: string,
  timezone: string
) {
  const links = await fetchTrackedLinks(userId);
  lastDeadlineListByChat.set(
    chatId,
    links.map((l) => l.id)
  );

  const text = buildTrackedLinksListMessage(links, timezone);
  const keyboard = links.length > 0 ? buildDeleteKeyboard(links.length) : undefined;

  return sendTelegramMessage(chatId, text, {
    parseMode: "HTML",
    replyMarkup: keyboard,
  });
}

export async function refreshTrackedLinksListMessage(
  chatId: string,
  messageId: number,
  userId: string,
  timezone: string
) {
  const links = await fetchTrackedLinks(userId);
  lastDeadlineListByChat.set(
    chatId,
    links.map((l) => l.id)
  );

  const text = buildTrackedLinksListMessage(links, timezone);
  const keyboard = links.length > 0 ? buildDeleteKeyboard(links.length) : undefined;

  return editTelegramMessage(chatId, messageId, text, {
    parseMode: "HTML",
    replyMarkup: keyboard,
  });
}

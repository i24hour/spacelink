import type { SavedLink, User } from "@deadlineai/db";
import { DateTime } from "luxon";
import { prisma } from "../lib/prisma";
import { normalizeTimezone } from "../lib/timezones";
import { formatDailyReminderHour } from "../lib/daily-reminder-time";
import {
  clearPendingRemindersForLink,
  persistReminderSchedule,
  scheduleSmartRemindersForLink,
  type ReminderScheduleMode,
  type ReminderScheduleSummary,
} from "./reminders-smart";

export function telegramChannelsForUser(user: Pick<User, "telegramId">): string[] {
  return user.telegramId ? ["telegram"] : [];
}

/** Clear + rebuild all pending reminder rows for one link. */
export async function rebuildRemindersForLink(
  linkId: string,
  modeOverride?: ReminderScheduleMode
): Promise<ReminderScheduleSummary | { error: string }> {
  const link = await prisma.savedLink.findUnique({ where: { id: linkId } });
  if (!link) return { error: "Link not found" };
  if (!link.extractedDeadline) return { error: "No deadline on this link" };

  if (link.extractedDeadline.getTime() <= Date.now()) {
    await clearPendingRemindersForLink(linkId);
    return { error: "Deadline already passed" };
  }

  const user = await prisma.user.findUnique({ where: { id: link.userId } });
  if (!user?.telegramId) {
    return { error: "Connect Telegram first (/status)" };
  }

  await clearPendingRemindersForLink(linkId);
  if (modeOverride) {
    await persistReminderSchedule(linkId, modeOverride);
  }

  const refreshed = await prisma.savedLink.findUnique({ where: { id: linkId } });
  if (!refreshed) return { error: "Could not reload link" };

  const summary = await scheduleSmartRemindersForLink(refreshed, modeOverride);
  if (!summary) return { error: "Could not schedule reminders" };
  if (summary.total === 0) {
    return { error: "No reminder slots left before this deadline — it may be too soon." };
  }

  return summary;
}

export async function rebuildRemindersForAllUserLinks(userId: string) {
  const links = await prisma.savedLink.findMany({
    where: {
      userId,
      status: { in: ["active", "pending"] },
      extractedDeadline: { gt: new Date() },
    },
  });

  const results = [];
  for (const link of links) {
    results.push({ linkId: link.id, title: link.title, ...(await rebuildRemindersForLink(link.id)) });
  }
  return results;
}

export async function getNextPendingReminder(userId: string) {
  return prisma.reminder.findFirst({
    where: {
      sentStatus: "pending",
      reminderTime: { gt: new Date() },
      savedLink: { userId, status: { in: ["active", "pending"] } },
    },
    orderBy: { reminderTime: "asc" },
    include: { savedLink: { select: { title: true, url: true } } },
  });
}

export function formatNextReminderLine(
  user: Pick<User, "timezone">,
  next: { reminderTime: Date; savedLink: { title: string } } | null
): string {
  if (!next) return "No upcoming reminders scheduled.";
  const zone = normalizeTimezone(user.timezone);
  const when = DateTime.fromJSDate(next.reminderTime, { zone }).toFormat("LLL d · h:mm a ZZZZ");
  return `Next ping: <b>${when}</b> — ${next.savedLink.title}`;
}

export function formatScheduleConfirmation(
  user: User,
  link: SavedLink,
  summary: ReminderScheduleSummary
): string {
  const dailyN = Math.round(summary.daily / Math.max(1, summary.channels.length));
  const hourlyN = Math.round(summary.hourly / Math.max(1, summary.channels.length));
  const dailyAt = formatDailyReminderHour(user.dailyReminderHour ?? 9, user.timezone);

  let lines =
    `✅ <b>Reminders active</b>\n\n` +
    `<b>${link.title}</b>\n` +
    `📋 ${dailyN} daily ping${dailyN === 1 ? "" : "s"} at <b>${dailyAt}</b> (${user.timezone})\n`;

  if (hourlyN > 0) {
    lines += `⏰ ${hourlyN} hourly alerts on the hour in the final 24h\n`;
  }

  lines += `\n<i>Tap below to switch daily-only style (10d / 5d).</i>`;
  return lines;
}

export async function setUserDailyReminderHour(userId: string, hour24: number) {
  if (hour24 < 0 || hour24 > 23) throw new Error("Hour must be 0–23");
  const user = await prisma.user.update({
    where: { id: userId },
    data: { dailyReminderHour: hour24 },
  });
  await rebuildRemindersForAllUserLinks(userId);
  return user;
}

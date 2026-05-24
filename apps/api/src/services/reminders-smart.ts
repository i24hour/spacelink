import type { SavedLink } from "@deadlineai/db";
import { DateTime } from "luxon";
import { normalizeTimezone } from "../lib/timezones";
import { prisma } from "../lib/prisma";

/** How daily countdown reminders are scheduled before the deadline */
export type ReminderScheduleMode = "daily_all" | "daily_10d" | "daily_5d";

export const REMINDER_SCHEDULE_LABELS: Record<ReminderScheduleMode, string> = {
  daily_all: "Daily reminders (every day until deadline)",
  daily_10d: "Daily reminders (last 10 days before deadline)",
  daily_5d: "Daily reminders (last 5 days before deadline)",
};

type ReminderRow = {
  savedLinkId: string;
  reminderTime: Date;
  reminderType: string;
  channel: string;
  sentStatus: string;
  aiMessage: null;
};

function readScheduleMode(link: SavedLink, override?: ReminderScheduleMode): ReminderScheduleMode {
  if (override) return override;
  const meta = (link.metadata || {}) as Record<string, unknown>;
  const stored = meta.reminder_schedule;
  if (stored === "daily_all" || stored === "daily_10d" || stored === "daily_5d") {
    return stored;
  }
  return "daily_all";
}

function dailyOffsetsForMode(mode: ReminderScheduleMode, daysUntil: number): number[] {
  const maxDay = Math.max(0, Math.min(daysUntil, 30));
  const all = Array.from({ length: maxDay }, (_, i) => i + 1);
  if (mode === "daily_10d") return all.filter((d) => d <= 10);
  if (mode === "daily_5d") return all.filter((d) => d <= 5);
  return all;
}

function addDailyReminders(
  reminders: ReminderRow[],
  linkId: string,
  deadline: Date,
  now: Date,
  channels: string[],
  mode: ReminderScheduleMode,
  daysUntil: number,
  userTimezone: string,
  dailyReminderHour: number
) {
  const zone = normalizeTimezone(userTimezone);
  const deadlineDt = DateTime.fromJSDate(deadline, { zone });
  const hour = Math.min(23, Math.max(0, dailyReminderHour));

  for (const d of dailyOffsetsForMode(mode, daysUntil)) {
    const reminderDate = deadlineDt
      .minus({ days: d })
      .set({ hour, minute: 0, second: 0, millisecond: 0 })
      .toJSDate();

    if (reminderDate > now) {
      for (const ch of channels) {
        reminders.push({
          savedLinkId: linkId,
          reminderTime: reminderDate,
          reminderType: "daily_countdown",
          channel: ch,
          sentStatus: "pending",
          aiMessage: null,
        });
      }
    }
  }
}

/** Hourly alerts on round clock hours in the user's timezone (final 24h before deadline). */
function addHourlyLast24hReminders(
  reminders: ReminderRow[],
  linkId: string,
  deadline: Date,
  now: Date,
  channels: string[],
  userTimezone: string
) {
  const zone = normalizeTimezone(userTimezone);
  const deadlineDt = DateTime.fromJSDate(deadline, { zone });
  const nowDt = DateTime.fromJSDate(now, { zone });

  const windowStart = deadlineDt.minus({ hours: 24 });
  const startDt = nowDt > windowStart ? nowDt : windowStart;

  // Next round hour in user's timezone (e.g. 5:30 PM → first ping at 6:00 PM).
  let cursor = startDt.set({ minute: 0, second: 0, millisecond: 0 });
  if (cursor <= nowDt) {
    cursor = cursor.plus({ hours: 1 });
  }

  while (cursor <= deadlineDt) {
    const reminderDate = cursor.toJSDate();
    for (const ch of channels) {
      reminders.push({
        savedLinkId: linkId,
        reminderTime: reminderDate,
        reminderType: "hourly_urgent",
        channel: ch,
        sentStatus: "pending",
        aiMessage: null,
      });
    }
    cursor = cursor.plus({ hours: 1 });
  }
}

export async function clearPendingRemindersForLink(linkId: string) {
  await prisma.reminder.deleteMany({
    where: { savedLinkId: linkId, sentStatus: "pending" },
  });
}

export async function persistReminderSchedule(linkId: string, mode: ReminderScheduleMode) {
  const link = await prisma.savedLink.findUnique({ where: { id: linkId } });
  const meta = ((link?.metadata as Record<string, unknown>) || {}) as Record<string, unknown>;
  await prisma.savedLink.update({
    where: { id: linkId },
    data: {
      metadata: { ...meta, reminder_schedule: mode } as object,
    },
  });
}

export type ReminderScheduleSummary = {
  mode: ReminderScheduleMode;
  total: number;
  daily: number;
  hourly: number;
  finalHour: number;
  channels: string[];
};

export async function scheduleSmartRemindersForLink(
  link: SavedLink,
  modeOverride?: ReminderScheduleMode
): Promise<ReminderScheduleSummary | undefined> {
  const user = await prisma.user.findUnique({ where: { id: link.userId } });
  if (!user) return;

  const deadline = link.extractedDeadline;
  if (!deadline) return;

  const now = new Date();
  const msUntil = deadline.getTime() - now.getTime();
  if (msUntil <= 0) return;

  const daysUntil = Math.ceil(msUntil / (1000 * 60 * 60 * 24));
  const mode = readScheduleMode(link, modeOverride);
  const channels = new Set(
    user.preferredChannels.length ? user.preferredChannels : ["telegram"]
  );
  if (user.telegramId) channels.add("telegram");
  // Email reminders paused — Telegram only for now.
  channels.delete("email");
  const channelList = channels.size > 0 ? [...channels] : ["telegram"];

  const dailyRows: ReminderRow[] = [];
  const hourlyRows: ReminderRow[] = [];
  const finalRows: ReminderRow[] = [];

  addDailyReminders(
    dailyRows,
    link.id,
    deadline,
    now,
    channelList,
    mode,
    daysUntil,
    user.timezone,
    user.dailyReminderHour ?? 9
  );
  addHourlyLast24hReminders(
    hourlyRows,
    link.id,
    deadline,
    now,
    channelList,
    user.timezone
  );

  const deadlineDt = DateTime.fromJSDate(deadline, {
    zone: normalizeTimezone(user.timezone),
  });
  const oneHourBefore = deadlineDt.minus({ hours: 1 }).toJSDate();
  if (oneHourBefore > now) {
    for (const ch of channelList) {
      finalRows.push({
        savedLinkId: link.id,
        reminderTime: oneHourBefore,
        reminderType: "final_hour",
        channel: ch,
        sentStatus: "pending",
        aiMessage: null,
      });
    }
  }

  const reminders = [...dailyRows, ...hourlyRows, ...finalRows];
  if (reminders.length === 0) {
    return {
      mode,
      total: 0,
      daily: 0,
      hourly: 0,
      finalHour: 0,
      channels: channelList,
    };
  }

  // Cron enqueues due rows every minute — no per-row BullMQ jobs at schedule time.
  await prisma.reminder.createMany({ data: reminders });

  return {
    mode,
    total: reminders.length,
    daily: dailyRows.length,
    hourly: hourlyRows.length,
    finalHour: finalRows.length,
    channels: channelList,
  };
}

import type { SavedLink } from "@deadlineai/db";
import { prisma } from "../lib/prisma";
import { reminderDispatchQueue } from "../queues/dispatcher";

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
  daysUntil: number
) {
  for (const d of dailyOffsetsForMode(mode, daysUntil)) {
    const reminderDate = new Date(deadline);
    reminderDate.setDate(reminderDate.getDate() - d);
    reminderDate.setHours(9, 0, 0, 0);

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

/** Hourly alerts for every hour in the final 24 hours before deadline (always on). */
function addHourlyLast24hReminders(
  reminders: ReminderRow[],
  linkId: string,
  deadline: Date,
  now: Date,
  channels: string[]
) {
  const windowStart = new Date(deadline.getTime() - 24 * 60 * 60 * 1000);
  let cursor = windowStart > now ? windowStart : new Date(now);
  cursor.setMinutes(0, 0, 0);
  if (cursor <= now) {
    cursor = new Date(now);
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(cursor.getHours() + 1);
  }

  while (cursor < deadline) {
    for (const ch of channels) {
      reminders.push({
        savedLinkId: linkId,
        reminderTime: new Date(cursor),
        reminderType: "hourly_urgent",
        channel: ch,
        sentStatus: "pending",
        aiMessage: null,
      });
    }
    cursor.setHours(cursor.getHours() + 1);
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

export async function scheduleSmartRemindersForLink(
  link: SavedLink,
  modeOverride?: ReminderScheduleMode
) {
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
  const channelList = [...channels];

  const reminders: ReminderRow[] = [];

  addDailyReminders(reminders, link.id, deadline, now, channelList, mode, daysUntil);
  addHourlyLast24hReminders(reminders, link.id, deadline, now, channelList);

  const oneHourBefore = new Date(deadline.getTime() - 60 * 60 * 1000);
  if (oneHourBefore > now) {
    for (const ch of channelList) {
      reminders.push({
        savedLinkId: link.id,
        reminderTime: oneHourBefore,
        reminderType: "final_hour",
        channel: ch,
        sentStatus: "pending",
        aiMessage: null,
      });
    }
  }

  const created = [];
  for (const row of reminders) {
    created.push(await prisma.reminder.create({ data: row }));
  }

  for (const r of created) {
    await reminderDispatchQueue.add(
      "send-reminder",
      { reminderId: r.id },
      { delay: Math.max(0, r.reminderTime.getTime() - Date.now()) }
    );
  }

  return { mode, count: created.length };
}

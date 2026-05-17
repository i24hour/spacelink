import type { Reminder, SavedLink } from "@deadlineai/db";
import { prisma } from "../lib/prisma";
import { reminderDispatchQueue } from "../queues/dispatcher";

type ReminderSeed = {
  savedLinkId: string;
  reminderTime: Date;
  reminderType: string;
  channel: string;
  sentStatus: string;
  aiMessage: null;
};

function offsetDate(date: Date, ms: number) {
  return new Date(date.getTime() - ms);
}

function buildReminderTimes(link: SavedLink): Date[] {
  const deadline = link.extractedDeadline;
  if (!deadline) return [];

  if (link.rollingApplication) {
    const times: Date[] = [];
    let d = new Date();
    d.setDate(d.getDate() + 7);
    for (let i = 0; i < 12; i++) {
      times.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }
    return times;
  }

  const urgency = link.urgencyScore ?? 5;
  const offsets: number[] = [];

  if (urgency >= 7) {
    offsets.push(7 * 24 * 60 * 60 * 1000);
    offsets.push(3 * 24 * 60 * 60 * 1000);
    offsets.push(1 * 24 * 60 * 60 * 1000);
    offsets.push(6 * 60 * 60 * 1000);
    offsets.push(1 * 60 * 60 * 1000);
  } else if (urgency >= 4) {
    offsets.push(3 * 24 * 60 * 60 * 1000);
    offsets.push(1 * 24 * 60 * 60 * 1000);
  } else {
    offsets.push(1 * 24 * 60 * 60 * 1000);
  }

  return offsets.map((ms) => offsetDate(deadline, ms)).filter((d) => d > new Date());
}

export async function scheduleRemindersForLink(link: SavedLink) {
  const user = await prisma.user.findUnique({ where: { id: link.userId } });
  if (!user) return;

  const times = buildReminderTimes(link);
  if (times.length === 0) return;

  const channels = user.preferredChannels.length
    ? user.preferredChannels
    : ["email"];

  const now = new Date();

  const data: ReminderSeed[] = [];

  for (const t of times) {
    for (const ch of channels) {
      data.push({
        savedLinkId: link.id,
        reminderTime: t,
        reminderType: t < link.extractedDeadline! ? "pre_deadline" : "rolling",
        channel: ch,
        sentStatus: t > now ? "pending" : "skipped",
        aiMessage: null,
      });
    }
  }

  // Use createMany if IDs are cuid and not needed immediately, but we need IDs for queue jobs.
  const created: Reminder[] = [];
  for (const row of data) {
    created.push(
      await prisma.reminder.create({
        data: row as any,
      })
    );
  }

  for (const r of created) {
    if (r.sentStatus === "pending") {
      await reminderDispatchQueue.add(
        "send-reminder",
        { reminderId: r.id },
        { delay: Math.max(0, r.reminderTime.getTime() - Date.now()) }
      );
    }
  }
}

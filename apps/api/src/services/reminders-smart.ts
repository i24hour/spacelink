import { SavedLink } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { reminderDispatchQueue } from "../queues/dispatcher";

export async function scheduleSmartRemindersForLink(link: SavedLink) {
  const user = await prisma.user.findUnique({ where: { id: link.userId } });
  if (!user) return;

  const deadline = link.extractedDeadline;
  if (!deadline) return;

  const now = new Date();
  const msUntil = deadline.getTime() - now.getTime();
  const daysUntil = Math.ceil(msUntil / (1000 * 60 * 60 * 24));

  if (daysUntil < 0) return; // Already expired

  const channels = user.preferredChannels.length ? user.preferredChannels : ["email"];
  const reminders: { savedLinkId: string; reminderTime: Date; reminderType: string; channel: string; sentStatus: string; aiMessage: null }[] = [];

  // DAILY COUNTDOWN reminders (every day until deadline)
  for (let d = 1; d <= Math.min(daysUntil, 30); d++) {
    const reminderDate = new Date(deadline);
    reminderDate.setDate(reminderDate.getDate() - d);
    reminderDate.setHours(9, 0, 0, 0); // 9 AM daily reminder

    if (reminderDate > now) {
      for (const ch of channels) {
        reminders.push({
          savedLinkId: link.id,
          reminderTime: reminderDate,
          reminderType: "daily_countdown",
          channel: ch,
          sentStatus: "pending",
          aiMessage: null,
        });
      }
    }
  }

  // HOURLY INTENSIVE reminders (last 24 hours)
  if (daysUntil <= 1) {
    const hoursLeft = Math.ceil(msUntil / (1000 * 60 * 60));
    for (let h = hoursLeft; h > 0; h--) {
      const reminderDate = new Date(now);
      reminderDate.setHours(reminderDate.getHours() + h);
      reminderDate.setMinutes(0, 0, 0);

      for (const ch of channels) {
        reminders.push({
          savedLinkId: link.id,
          reminderTime: reminderDate,
          reminderType: "hourly_urgent",
          channel: ch,
          sentStatus: "pending",
          aiMessage: null,
        });
      }
    }
  } else {
    // Standard pre-deadline reminders for non-urgent deadlines
    const offsets = [
      7 * 24 * 60 * 60 * 1000,  // 7 days
      3 * 24 * 60 * 60 * 1000,  // 3 days
      1 * 24 * 60 * 60 * 1000,  // 1 day
    ];

    for (const ms of offsets) {
      const t = new Date(deadline.getTime() - ms);
      if (t > now) {
        for (const ch of channels) {
          reminders.push({
            savedLinkId: link.id,
            reminderTime: t,
            reminderType: "pre_deadline",
            channel: ch,
            sentStatus: "pending",
            aiMessage: null,
          });
        }
      }
    }
  }

  // Last 1 hour reminder
  const oneHourBefore = new Date(deadline.getTime() - 60 * 60 * 1000);
  if (oneHourBefore > now) {
    for (const ch of channels) {
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

  const created: any[] = [];
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
}

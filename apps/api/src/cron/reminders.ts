import { prisma } from "../lib/prisma";
import { dispatchDueReminder } from "../services/reminder-dispatch";

export async function processDueRemindersOnce() {
  const now = new Date();
  const due = await prisma.reminder.findMany({
    where: {
      sentStatus: "pending",
      reminderTime: { lte: now },
    },
    orderBy: { reminderTime: "asc" },
    take: 100,
  });

  if (due.length === 0) return { due: 0, sent: 0 };

  let sent = 0;
  for (const r of due) {
    try {
      const result = await dispatchDueReminder(r.id);
      if (result.delivered) sent += 1;
    } catch (err) {
      console.error(`Reminder dispatch failed ${r.id}:`, err);
    }
  }

  console.log(`Reminders: processed ${sent}/${due.length} due`);
  return { due: due.length, sent };
}

export function startCron() {
  const intervalMs = Number(process.env.CRON_INTERVAL_MS || "30000");

  void processDueRemindersOnce();

  setInterval(() => {
    void processDueRemindersOnce();
  }, intervalMs);

  console.log(`Reminder cron started (every ${intervalMs}ms)`);
}

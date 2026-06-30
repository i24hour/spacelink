import { prisma } from "../lib/prisma";
import { withLock } from "../lib/redis-lock";
import { dispatchDueReminder } from "../services/reminder-dispatch";

const LOCK_NAME = "reminder-cron";
const LOCK_TTL_SECONDS = 60;
// A reminder still in "sending" this long past its due time is treated as
// crashed and reset to "pending" by the recovery sweep.
const STUCK_SENDING_TIMEOUT_MS = 10 * 60 * 1000;

export async function processDueRemindersOnce() {
  return withLock(LOCK_NAME, LOCK_TTL_SECONDS, async () => {
    const now = new Date();

    // Recovery sweep: a reminder stuck in "sending" well past its due time
    // almost certainly had its dispatch crash mid-flight (instance killed,
    // unhandled rejection, etc.). Reset to "pending" so the next tick retries.
    const stuckThreshold = new Date(now.getTime() - STUCK_SENDING_TIMEOUT_MS);
    const recovered = await prisma.reminder.updateMany({
      where: {
        sentStatus: "sending",
        reminderTime: { lte: stuckThreshold },
      },
      data: { sentStatus: "pending" },
    });
    if (recovered.count > 0) {
      console.log(`Reminders: recovered ${recovered.count} stuck "sending" reminder(s)`);
    }

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
  });
}

export function startCron() {
  const intervalMs = Number(process.env.CRON_INTERVAL_MS || "30000");

  void processDueRemindersOnce();

  setInterval(() => {
    void processDueRemindersOnce();
  }, intervalMs);

  console.log(`Reminder cron started (every ${intervalMs}ms)`);
}

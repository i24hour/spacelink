import { prisma } from "../lib/prisma";
import { dispatchDueReminder } from "../services/reminder-dispatch";

export function startCron() {
  const intervalMs = Number(process.env.CRON_INTERVAL_MS || "60000");

  setInterval(async () => {
    try {
      const now = new Date();
      const due = await prisma.reminder.findMany({
        where: {
          sentStatus: "pending",
          reminderTime: { lte: now },
        },
        orderBy: { reminderTime: "asc" },
        take: 100,
      });

      if (due.length === 0) return;

      let sent = 0;
      for (const r of due) {
        try {
          const result = await dispatchDueReminder(r.id);
          if (result.delivered) sent += 1;
        } catch (err) {
          console.error(`Cron: failed reminder ${r.id}:`, err);
        }
      }

      console.log(`Cron: dispatched ${sent}/${due.length} due reminders`);
    } catch (err) {
      console.error("Cron error:", err);
    }
  }, intervalMs);
}

import { prisma } from "../lib/prisma";
import { reminderDispatchQueue } from "../queues/dispatcher";

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
        take: 100,
      });

      for (const r of due) {
        await reminderDispatchQueue.add(
          "send-reminder",
          { reminderId: r.id },
          { jobId: r.id }
        );
      }

      if (due.length > 0) {
        console.log(`Cron: enqueued ${due.length} due reminders`);
      }
    } catch (err) {
      console.error("Cron error:", err);
    }
  }, intervalMs);
}

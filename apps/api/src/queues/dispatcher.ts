import { Queue, Worker } from "bullmq";
import { redis } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { generateReminderMessage } from "../services/ai-message";
import { sendEmail } from "../services/notifications/email";
import { sendTelegramRaw } from "../services/notifications/telegram";
import { sendWhatsApp } from "../services/notifications/whatsapp";

export const reminderDispatchQueue = new Queue("reminder-dispatch", {
  connection: redis,
  defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5000 } },
});

export const reminderDispatchWorker = new Worker(
  "reminder-dispatch",
  async (job) => {
    const { reminderId } = job.data as { reminderId: string };

    const reminder = await prisma.reminder.findUnique({
      where: { id: reminderId },
      include: { savedLink: true },
    });

    if (!reminder || reminder.sentStatus !== "pending") {
      return { skipped: true };
    }

    const link = reminder.savedLink;
    const user = await prisma.user.findUnique({ where: { id: link.userId } });
    if (!user) return { skipped: true };

    const deadlineTime = link.extractedDeadline?.getTime() || Date.now();
    const minutesUntil = Math.max(0, (deadlineTime - Date.now()) / (1000 * 60));

    const message = await generateReminderMessage(link, user, minutesUntil, reminder.reminderType);

    let result: { delivered: boolean; error?: string; data?: any } = {
      delivered: false,
      error: "Unknown channel",
    };

    if (reminder.channel === "email") {
      result = await sendEmail(user.email, `Deadline reminder: ${link.title}`, message);
    } else if (reminder.channel === "telegram" && user.telegramId) {
      result = await sendTelegramRaw(user.telegramId, message, "HTML");
    } else if (reminder.channel === "whatsapp" && user.whatsappNumber) {
      result = await sendWhatsApp(user.whatsappNumber, message);
    }

    await prisma.reminder.update({
      where: { id: reminderId },
      data: { sentStatus: result.delivered ? "sent" : "failed", aiMessage: message },
    });

    await prisma.notificationLog.create({
      data: {
        reminderId,
        deliveryStatus: result.delivered ? "delivered" : "failed",
        responseData: result.data ? (result.data as any) : { error: result.error },
      },
    });

    return { delivered: result.delivered };
  },
  { connection: redis }
);

reminderDispatchWorker.on("completed", (job, result) => {
  console.log(`Reminder ${job.data.reminderId} dispatched:`, result);
});

reminderDispatchWorker.on("failed", (job, err) => {
  console.error(`Reminder ${job?.data?.reminderId} failed:`, err);
});

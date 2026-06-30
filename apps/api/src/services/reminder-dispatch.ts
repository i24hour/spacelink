import { prisma } from "../lib/prisma";
import { generateReminderMessage } from "./ai-message";
import { buildReminderDoneKeyboard } from "./link-completion";
// import { sendEmail } from "./notifications/email";
import { sendTelegramMessage } from "./notifications/telegram";
import { sendWhatsApp } from "./notifications/whatsapp";

export async function dispatchDueReminder(reminderId: string) {
  // Atomically claim this reminder so only one instance processes it.
  const claim = await prisma.reminder.updateMany({
    where: { id: reminderId, sentStatus: "pending" },
    data: { sentStatus: "sending" },
  });

  if (claim.count === 0) {
    return { skipped: true as const };
  }

  const reminder = await prisma.reminder.findUnique({
    where: { id: reminderId },
    include: { savedLink: true },
  });

  if (!reminder) {
    return { skipped: true as const };
  }

  const link = reminder.savedLink;
  const user = await prisma.user.findUnique({ where: { id: link.userId } });
  if (!user) {
    await prisma.reminder.update({
      where: { id: reminderId },
      data: { sentStatus: "failed", aiMessage: "User not found" },
    });
    return { skipped: true as const };
  }

  const deadlineTime = link.extractedDeadline?.getTime() || Date.now();
  const minutesUntil = Math.max(0, (deadlineTime - Date.now()) / (1000 * 60));

  const payload = await generateReminderMessage(link, user, minutesUntil, reminder.reminderType);

  let result: { delivered: boolean; error?: string; data?: unknown } = {
    delivered: false,
    error: "Unknown channel",
  };

  // Email reminders paused — Telegram only for now.
  if (reminder.channel === "email") {
    await prisma.reminder.update({
      where: { id: reminderId },
      data: { sentStatus: "failed", aiMessage: "Email reminders disabled temporarily" },
    });
    await prisma.notificationLog.create({
      data: {
        reminderId,
        deliveryStatus: "failed",
        responseData: { error: "Email reminders disabled temporarily" },
      },
    });
    return { skipped: true as const, channel: "email" };
  }

  // if (reminder.channel === "email") {
  //   result = await sendEmail(user.email, `Deadline reminder: ${link.title}`, payload.text);
  // } else
  if (reminder.channel === "telegram" && user.telegramId) {
    result = await sendTelegramMessage(user.telegramId, payload.html, {
      parseMode: "HTML",
      replyMarkup: buildReminderDoneKeyboard(link.id),
    });
  } else if (reminder.channel === "whatsapp" && user.whatsappNumber) {
    result = await sendWhatsApp(user.whatsappNumber, payload.text);
  } else if (reminder.channel === "telegram" && !user.telegramId) {
    result = { delivered: false, error: "Telegram not connected" };
  }

  await prisma.reminder.update({
    where: { id: reminderId },
    data: { sentStatus: result.delivered ? "sent" : "failed", aiMessage: payload.text },
  });

  await prisma.notificationLog.create({
    data: {
      reminderId,
      deliveryStatus: result.delivered ? "delivered" : "failed",
      responseData: result.data ? (result.data as object) : { error: result.error },
    },
  });

  return { delivered: result.delivered, channel: reminder.channel, linkTitle: link.title };
}

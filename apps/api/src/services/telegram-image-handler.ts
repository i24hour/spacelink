import type { User } from "@deadlineai/db";
import { prisma } from "../lib/prisma";
import {
  extractImageDataWithVision,
  imagePlaceholderUrl,
} from "./extraction-image";
import {
  isDeadlinePassed,
  saveExtractedUrlData,
  updateLinkFromExtraction,
} from "./extraction-url";
import { downloadTelegramFile, sendTelegramRaw } from "./notifications/telegram";
import { activateRemindersForLink } from "./telegram-reminder-pick";

export type TelegramImageInput = {
  fileId: string;
  messageId: number;
  caption?: string;
  mimeType?: string;
};

function formatDeadlineInTimezone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function formatRelativeDeadline(deadline: Date): string {
  const diffMs = deadline.getTime() - Date.now();
  const isPast = diffMs < 0;
  const totalSeconds = Math.max(0, Math.floor(Math.abs(diffMs) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const suffix = isPast ? "ago" : "left";
  return `${days}d ${hours}h ${minutes}m ${suffix}`;
}

export async function handleTelegramImage(
  chatId: string,
  user: User,
  input: TelegramImageInput,
  options?: {
    onManualDateNeeded: (linkId: string) => void;
  }
) {
  await sendTelegramRaw(chatId, "📷 Reading your image...", "HTML");

  const file = await downloadTelegramFile(input.fileId);
  if (!file) {
    await sendTelegramRaw(
      chatId,
      "❌ Couldn't download that image from Telegram. Please try again.",
      "HTML"
    );
    return;
  }

  const mimeType = input.mimeType || file.mimeType;
  const base64 = file.buffer.toString("base64");

  try {
    const extracted = await extractImageDataWithVision(
      base64,
      mimeType,
      user.timezone,
      input.caption
    );

    if (!extracted) {
      await sendTelegramRaw(
        chatId,
        "❌ Couldn't read deadline info from this image. Try a clearer screenshot or paste the link as text.",
        "HTML"
      );
      return;
    }

    const linkUrl =
      extracted.sourceUrl || imagePlaceholderUrl(user.id, input.messageId);

    const existing = await prisma.savedLink.findFirst({
      where: { userId: user.id, url: linkUrl },
    });

    const result = existing
      ? await updateLinkFromExtraction(existing.id, extracted)
      : await saveExtractedUrlData(linkUrl, user.id, extracted, {
          autoScheduleReminders: false,
        });

    if (!result.extractedDeadline) {
      options?.onManualDateNeeded(result.id);
      await sendTelegramRaw(
        chatId,
        `✅ <b>Saved from image</b>, but I couldn't find a clear deadline.\n\n<b>${result.title}</b>\n📅 TBD\n\nSend the date now (example: 20 May 2026 5 PM IST).`,
        "HTML"
      );
      return;
    }

    if (isDeadlinePassed(result.extractedDeadline)) {
      const dateStr = formatDeadlineInTimezone(
        new Date(result.extractedDeadline),
        user.timezone
      );
      const ago = formatRelativeDeadline(new Date(result.extractedDeadline));
      await sendTelegramRaw(
        chatId,
        `⏰ <b>This deadline has already passed</b>\n\n<b>${result.title}</b>\n📅 ${dateStr}\n(${ago})\n\nSend a corrected date if the image was wrong.`,
        "HTML"
      );
      return;
    }

    await activateRemindersForLink(chatId, result, user, {
      category: result.category,
      estimatedMinutes: result.estimatedCompletionMinutes,
    });
  } catch (err) {
    console.error("Telegram image processing error:", err);
    await sendTelegramRaw(
      chatId,
      "❌ Error processing that image. Try again or paste the link as text.",
      "HTML"
    );
  }
}

import { prisma } from "../lib/prisma";
import {
  TIMEZONE_OPTIONS,
  formatNowInTimezone,
  normalizeTimezone,
  timezoneLabel,
} from "../lib/timezones";
import { sendTelegramMessage, type InlineKeyboard } from "./notifications/telegram";

export function buildTimezoneKeyboard(): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = [];
  for (let i = 0; i < TIMEZONE_OPTIONS.length; i += 2) {
    const row = TIMEZONE_OPTIONS.slice(i, i + 2).map((z) => ({
      text: z.short,
      callback_data: `tz:${z.id}`,
    }));
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

export function parseTimezoneCallback(data: string): string | null {
  if (!data.startsWith("tz:")) return null;
  const zone = data.slice(3);
  return normalizeTimezone(zone);
}

export async function sendTimezoneSetupPrompt(chatId: string) {
  const text =
    "🌍 <b>Choose your timezone</b>\n\n" +
    "All deadlines and reminders will be saved and shown in this timezone.\n" +
    "Pick the one you use most (e.g. <b>IST</b> for India, <b>PT</b> for US Pacific).\n\n" +
    "<i>You only need to do this once. Change anytime with /timezone</i>";

  await sendTelegramMessage(chatId, text, {
    parseMode: "HTML",
    replyMarkup: buildTimezoneKeyboard(),
  });
}

export async function applyTimezoneChoice(chatId: string, userId: string, zone: string) {
  const normalized = normalizeTimezone(zone);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      timezone: normalized,
      timezoneConfigured: true,
    },
  });

  const nowStr = formatNowInTimezone(normalized);
  return {
    ok: true as const,
    timezone: updated.timezone,
    message:
      `✅ <b>Timezone saved</b>\n\n` +
      `${timezoneLabel(normalized)}\n` +
      `🕐 Right now for you: <b>${nowStr}</b>\n\n` +
      `Paste a link or say <code>Set deadline for … 19 May 2026</code> — dates will use this timezone.`,
  };
}

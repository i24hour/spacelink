const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

export type InlineKeyboardButton = {
  text: string;
  callback_data: string;
};

export type InlineKeyboard = {
  inline_keyboard: InlineKeyboardButton[][];
};

type TelegramSendOptions = {
  parseMode?: string;
  replyMarkup?: InlineKeyboard;
};

async function telegramApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: TelegramSendOptions
) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn("Telegram bot token missing");
    return { delivered: false, error: "No bot token" };
  }
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode || undefined,
      reply_markup: options?.replyMarkup,
      disable_web_page_preview: true,
    };
    const data = await telegramApi<{ ok?: boolean; description?: string }>("sendMessage", payload);
    if (!data.ok && options?.parseMode) {
      return sendTelegramMessage(chatId, text, { ...options, parseMode: undefined });
    }
    if (!data.ok) throw new Error(data.description || "Telegram API error");
    return { delivered: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { delivered: false, error: message };
  }
}

export async function editTelegramMessage(
  chatId: string,
  messageId: number,
  text: string,
  options?: TelegramSendOptions
) {
  if (!TELEGRAM_BOT_TOKEN) {
    return { delivered: false, error: "No bot token" };
  }
  try {
    const data = await telegramApi<{ ok?: boolean; description?: string }>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options?.parseMode || undefined,
      reply_markup: options?.replyMarkup,
      disable_web_page_preview: true,
    });
    if (!data.ok) throw new Error(data.description || "Telegram API error");
    return { delivered: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { delivered: false, error: message };
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false };
  return telegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

export async function sendTelegramRaw(chatId: string, text: string, parseMode?: string) {
  return sendTelegramMessage(chatId, text, { parseMode: parseMode || undefined });
}

export async function sendTelegram(chatId: string, text: string) {
  return sendTelegramRaw(chatId, text, "Markdown");
}

export async function setTelegramWebhook(url: string) {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, error: "No bot token" };
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`
  );
  return res.json();
}

export async function deleteTelegramWebhook() {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, error: "No bot token" };
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`
  );
  return res.json();
}

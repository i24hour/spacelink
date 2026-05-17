const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

export async function sendTelegramRaw(chatId: string, text: string, parseMode?: string) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn("Telegram bot token missing");
    return { delivered: false, error: "No bot token" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
        headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode || undefined,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      description?: string;
    };
    if (!data.ok && parseMode) {
      // Retry without parse_mode in case markdown caused issues
      return sendTelegramRaw(chatId, text);
    }
    if (!data.ok) throw new Error(data.description || "Telegram API error");
    return { delivered: true, data };
  } catch (err: any) {
    return { delivered: false, error: err?.message || String(err) };
  }
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

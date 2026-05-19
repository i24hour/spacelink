import { Router } from "express";
import { handleTelegramCallback, handleTelegramMessage } from "../services/telegram-handler";
import { sendTelegramRaw, setTelegramWebhook } from "../services/notifications/telegram";

const router = Router();

router.post("/", async (req, res) => {
  const update = req.body;

  try {
    const callback = update?.callback_query;
    if (callback?.id && callback?.data) {
      const chatId = callback.message?.chat?.id ?? callback.from?.id;
      if (chatId) {
        await handleTelegramCallback(
          String(chatId),
          String(callback.id),
          String(callback.data),
          callback.message?.message_id
        );
      }
      return res.sendStatus(200);
    }

    const msg = update?.message;
    const chatId = msg?.chat?.id;
    const text = msg?.text || "";

    if (!chatId) return res.sendStatus(200);

    await handleTelegramMessage(String(chatId), text);
    return res.sendStatus(200);
  } catch (err) {
    console.error("Telegram webhook error:", err);
    const chatId =
      update?.message?.chat?.id ??
      update?.callback_query?.message?.chat?.id ??
      update?.callback_query?.from?.id;
    if (chatId) {
      await sendTelegramRaw(
        String(chatId),
        "⚠️ Something went wrong on our side. We're fixing it — try again in a minute or send /status.",
        "HTML"
      ).catch(() => {});
    }
    return res.sendStatus(200);
  }
});

// Setup helper endpoint
router.post("/setup", async (_req, res) => {
  if (!process.env.TELEGRAM_WEBHOOK_URL) {
    return res.status(400).json({ error: "TELEGRAM_WEBHOOK_URL not set" });
  }
  const result = await setTelegramWebhook(process.env.TELEGRAM_WEBHOOK_URL);
  return res.json(result);
});

export default router;

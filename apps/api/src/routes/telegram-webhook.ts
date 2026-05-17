import { Router } from "express";
import { handleTelegramMessage } from "../services/telegram-handler";
import { setTelegramWebhook } from "../services/notifications/telegram";

const router = Router();

router.post("/", async (req, res) => {
  const update = req.body;
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text = msg?.text || "";

  if (!chatId) return res.sendStatus(200);

  await handleTelegramMessage(String(chatId), text);
  return res.sendStatus(200);
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

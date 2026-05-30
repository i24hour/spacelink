import { Router } from "express";
import {
  handleTelegramCallback,
  handleTelegramImageMessage,
  handleTelegramMessage,
} from "../services/telegram-handler";
import { sendTelegramRaw, setTelegramWebhook } from "../services/notifications/telegram";
import {
  requireTelegramSetupSecret,
  requireTelegramWebhookSecret,
} from "../lib/telegram-webhook-auth";
import { getTelegramWebhookSecret } from "../lib/secrets";

const router = Router();

type TelegramPhotoSize = { file_id: string };
type TelegramDocument = { file_id: string; mime_type?: string };

function pickTelegramImage(message: {
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
}): { fileId: string; mimeType?: string } | null {
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, mimeType: "image/jpeg" };
  }

  const doc = message.document;
  if (doc?.mime_type?.startsWith("image/")) {
    return { fileId: doc.file_id, mimeType: doc.mime_type };
  }

  return null;
}

router.post("/", requireTelegramWebhookSecret, async (req, res) => {
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

    const image = pickTelegramImage(msg);
    if (image) {
      await handleTelegramImageMessage(String(chatId), {
        fileId: image.fileId,
        messageId: msg.message_id,
        caption: msg.caption || undefined,
        mimeType: image.mimeType,
      });
      return res.sendStatus(200);
    }

    if (text) {
      await handleTelegramMessage(String(chatId), text);
    }
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

// Setup helper endpoint (requires TELEGRAM_WEBHOOK_SECRET as Bearer token)
router.post("/setup", requireTelegramSetupSecret, async (_req, res) => {
  if (!process.env.TELEGRAM_WEBHOOK_URL) {
    return res.status(400).json({ error: "TELEGRAM_WEBHOOK_URL not set" });
  }
  const secret = getTelegramWebhookSecret();
  const result = await setTelegramWebhook(process.env.TELEGRAM_WEBHOOK_URL, secret || undefined);
  return res.json(result);
});

export default router;

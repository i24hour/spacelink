import { Router } from "express";
import { prisma } from "../lib/prisma";
import { consumeTelegramLinkToken } from "../lib/auth";
import { sendTelegramRaw, setTelegramWebhook } from "../services/notifications/telegram";

const router = Router();

router.post("/", async (req, res) => {
  const update = req.body;
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text = msg?.text || "";
  const parts = text.trim().split(" ");
  const command = parts[0];
  const arg = parts[1];

  if (!chatId) return res.sendStatus(200);

  // Deep-link auth: /start TOKEN
  if (command === "/start" && arg) {
    const userId = consumeTelegramLinkToken(arg);
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          telegramId: String(chatId),
          preferredChannels: { set: ["telegram"] },
        },
      });
      await sendTelegramRaw(
        String(chatId),
        "\ud83c\udf89 Your Telegram is now connected to <b>DeadlineAI</b>!\n\nYou'll receive smart deadline reminders here.\n\n<b>Commands:</b>\n/deadlines - See upcoming deadlines\n/help - Show all commands",
        "HTML"
      );
    } else {
      await sendTelegramRaw(
        String(chatId),
        "That link has expired or is invalid. Please open the DeadlineAI extension and click <b>Connect Telegram</b> again.",
        "HTML"
      );
    }
    return res.sendStatus(200);
  }

  // Normal /start (no token)
  if (command === "/start") {
    await sendTelegramRaw(
      String(chatId),
      "\ud83d\udc4b Welcome to <b>DeadlineAI Bot</b>!\n\nTo get started:\n1. Install the DeadlineAI browser extension\n2. Sign in with Google\n3. Click <b>Connect Telegram</b> in the extension\n\nThen I'll send you smart reminders before every deadline.",
      "HTML"
    );
    return res.sendStatus(200);
  }

  // /deadlines command
  if (command === "/deadlines") {
    const user = await prisma.user.findFirst({
      where: { telegramId: String(chatId) },
    });

    if (!user) {
      await sendTelegramRaw(
        String(chatId),
        "You haven't connected your account yet.\n\nOpen the DeadlineAI extension and click <b>Connect Telegram</b>.",
        "HTML"
      );
      return res.sendStatus(200);
    }

    const links = await prisma.savedLink.findMany({
      where: {
        userId: user.id,
        status: { in: ["active", "pending"] },
      },
      orderBy: { extractedDeadline: "asc" },
      take: 10,
    });

    if (links.length === 0) {
      await sendTelegramRaw(
        String(chatId),
        "No upcoming deadlines! Save a page via the extension and I'll track it here.\n\nTry <b>/help</b> for more commands.",
        "HTML"
      );
      return res.sendStatus(200);
    }

    const lines = links.map((l, i) => {
      const date = l.extractedDeadline
        ? new Date(l.extractedDeadline).toLocaleDateString()
        : "TBD";
      const left = l.extractedDeadline
        ? Math.ceil((new Date(l.extractedDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
      const daysLeft = left != null && left >= 0 ? `${left}d left` : left != null ? `${Math.abs(left)}d ago` : "";
      return `${i + 1}. <b>${l.title}</b>\n   \ud83d\udcc5 ${date}${daysLeft ? ` · ${daysLeft}` : ""}${l.category ? ` · ${l.category}` : ""}${l.urgencyScore && l.urgencyScore >= 7 ? " \ud83d\udd25" : ""}`;
    });

    await sendTelegramRaw(
      String(chatId),
      `<b>Your upcoming deadlines</b>\n\n${lines.join("\n\n")}`,
      "HTML"
    );
    return res.sendStatus(200);
  }

  // /help command
  if (command === "/help") {
    await sendTelegramRaw(
      String(chatId),
      "<b>DeadlineAI Bot</b>\n\n/start - Connect your account\n/deadlines - Show upcoming deadlines\n/help - This message\n\nJust save any page via the browser extension and I'll remind you before the deadline.",
      "HTML"
    );
    return res.sendStatus(200);
  }

  // Auto-detect if user sends anything else
  await sendTelegramRaw(
    String(chatId),
    "I didn't understand that.\n\nUse <b>/deadlines</b> to see your upcoming deadlines, or <b>/help</b> for all commands.",
    "HTML"
  );
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

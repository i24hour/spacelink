import { Router } from "express";
import { universalAuth, AuthRequest } from "../lib/universal-auth";
import { prisma } from "../lib/prisma";
import { sendEmail } from "../services/notifications/email";
import { sendTelegramRaw } from "../services/notifications/telegram";

const router = Router();

router.post("/test-email", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const result = await sendEmail(
      user.email,
      "DeadlineAI test email",
      "Hey! This is a test notification from DeadlineAI. If you're seeing this, your email reminders are ready to go."
    );

    return res.json({ ok: result.delivered, error: result.error });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/test-telegram", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.telegramId) {
      return res.status(400).json({ error: "Telegram not connected" });
    }

    const result = await sendTelegramRaw(
      user.telegramId,
      "\u2705 Test notification from DeadlineAI!\n\nYour Telegram reminders are ready. Save an opportunity and we'll remind you here before the deadline.",
      "Markdown"
    );

    return res.json({ ok: result.delivered, error: result.error });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

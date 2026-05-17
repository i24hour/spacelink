import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  verifyGoogleToken,
  upsertUserFromGoogle,
  generateToken,
  requireAuth,
  AuthRequest,
  createTelegramLinkToken,
  consumeTelegramChatLinkToken,
} from "../lib/auth";

const router = Router();

router.post("/google", async (req, res) => {
  try {
    const schema = z.object({ idToken: z.string().min(1) });
    const { idToken } = schema.parse(req.body);

    const googleUser = await verifyGoogleToken(idToken);
    const user = await upsertUserFromGoogle(googleUser);
    const token = generateToken(user.id);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        timezone: user.timezone,
        preferredChannels: user.preferredChannels,
        telegramId: user.telegramId,
      },
    });
  } catch (err: any) {
    console.error("Google auth error:", err);
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    return res.status(401).json({ error: err.message || "Authentication failed" });
  }
});

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({
      id: user.id,
      email: user.email,
      timezone: user.timezone,
      preferredChannels: user.preferredChannels,
      telegramId: user.telegramId,
      telegramConnected: !!user.telegramId,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/telegram-link", requireAuth, async (req: AuthRequest, res) => {
  try {
    const token = createTelegramLinkToken(req.userId!);
    return res.json({ token, url: `https://t.me/${process.env.TELEGRAM_BOT_NAME || "DeadlineAIBot"}?start=${token}` });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/telegram-connect", requireAuth, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({ token: z.string().min(1) });
    const { token } = schema.parse(req.body);

    const chatId = consumeTelegramChatLinkToken(token);
    if (!chatId) return res.status(400).json({ error: "Invalid or expired Telegram connect token" });

    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const preferredChannels = user.preferredChannels.includes("telegram")
      ? user.preferredChannels
      : [...user.preferredChannels, "telegram"];

    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramId: chatId,
        preferredChannels: { set: preferredChannels },
      },
    });

    return res.json({ ok: true, telegramConnected: true });
  } catch (err: any) {
    console.error("telegram-connect error:", err);
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

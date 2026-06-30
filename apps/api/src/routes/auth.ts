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

    const payload = consumeTelegramChatLinkToken(token);
    if (!payload) return res.status(400).json({ error: "Invalid or expired Telegram connect token" });

    // If the token was generated from a known user session (e.g. extension/web "Connect
    // Telegram"), it contains the userId and must match the current session. This prevents
    // a leaked deep-link token from linking the user's account to another Telegram chat.
    if (payload.userId && payload.userId !== req.userId) {
      return res.status(403).json({ error: "Token does not belong to this account" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Safety check: don't let a chat-only token overwrite an existing link to a different user.
    const existingChatUser = payload.userId
      ? null
      : await prisma.user.findFirst({ where: { telegramId: payload.chatId } });
    if (existingChatUser && existingChatUser.id !== user.id) {
      return res.status(409).json({ error: "This Telegram chat is already linked to another account" });
    }

    const preferredChannels = user.preferredChannels.includes("telegram")
      ? user.preferredChannels
      : [...user.preferredChannels, "telegram"];

    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramId: payload.chatId,
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

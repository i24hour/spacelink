import { Router } from "express";
import { universalAuth, AuthRequest } from "../lib/universal-auth";
import { prisma } from "../lib/prisma";
import { normalizeTimezone } from "../lib/timezones";
import { z } from "zod";

const router = Router();

router.get("/me", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({
      id: user.id,
      email: user.email,
      timezone: user.timezone,
      timezoneConfigured: user.timezoneConfigured,
      preferredChannels: user.preferredChannels,
      telegramId: user.telegramId,
      telegramConnected: !!user.telegramId,
      plan: user.plan,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/me", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const schema = z.object({
      timezone: z.string().optional(),
      preferredChannels: z.array(z.enum(["email", "telegram", "whatsapp"])).optional(),
      telegramId: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const update: {
      timezone?: string;
      timezoneConfigured?: boolean;
      preferredChannels?: string[];
      telegramId?: string;
    } = {};

    if (data.timezone !== undefined) {
      update.timezone = normalizeTimezone(data.timezone);
      update.timezoneConfigured = true;
    }
    if (data.preferredChannels !== undefined) {
      update.preferredChannels = data.preferredChannels;
    }
    if (data.telegramId !== undefined) {
      update.telegramId = data.telegramId;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: update,
    });
    return res.json({
      id: updated.id,
      email: updated.email,
      timezone: updated.timezone,
      timezoneConfigured: updated.timezoneConfigured,
      preferredChannels: updated.preferredChannels,
      telegramId: updated.telegramId,
      telegramConnected: !!updated.telegramId,
      plan: updated.plan,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

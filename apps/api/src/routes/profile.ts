import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { universalAuth, AuthRequest } from "../lib/universal-auth";
import { validateUsername, normalizeUsername } from "../lib/username";
import { getFollowCounts } from "../lib/profile-access";

const router = Router();

function serializeOwnProfile(user: {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  profileVisibility: string;
  timezone: string;
  timezoneConfigured: boolean;
  dailyReminderHour: number;
  preferredChannels: string[];
  telegramId: string | null;
  plan: string;
}) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    profileVisibility: user.profileVisibility,
    timezone: user.timezone,
    timezoneConfigured: user.timezoneConfigured,
    dailyReminderHour: user.dailyReminderHour,
    preferredChannels: user.preferredChannels,
    telegramId: user.telegramId,
    telegramConnected: !!user.telegramId,
    plan: user.plan,
  };
}

router.get("/", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const counts = await getFollowCounts(userId);
    return res.json({
      ...serializeOwnProfile(user),
      ...counts,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const schema = z.object({
      username: z.string().min(3).max(30).optional(),
      displayName: z.string().max(80).nullable().optional(),
      bio: z.string().max(500).nullable().optional(),
      profileVisibility: z.enum(["public", "private"]).optional(),
    });
    const data = schema.parse(req.body);

    if (data.username !== undefined) {
      const normalized = normalizeUsername(data.username);
      const err = validateUsername(normalized);
      if (err) return res.status(400).json({ error: err });

      const taken = await prisma.user.findFirst({
        where: { username: normalized, NOT: { id: userId } },
      });
      if (taken) return res.status(409).json({ error: "Username already taken" });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        username: data.username !== undefined ? normalizeUsername(data.username) : undefined,
        displayName: data.displayName,
        bio: data.bio,
        profileVisibility: data.profileVisibility,
      },
    });

    const counts = await getFollowCounts(userId);
    return res.json({ ...serializeOwnProfile(updated), ...counts });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    if (err.code === "P2002") return res.status(409).json({ error: "Username already taken" });
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

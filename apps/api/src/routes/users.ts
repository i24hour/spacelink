import { Router } from "express";
import { universalAuth, AuthRequest } from "../lib/universal-auth";
import { optionalUniversalAuth } from "../lib/optional-auth";
import { prisma } from "../lib/prisma";
import { normalizeTimezone } from "../lib/timezones";
import { setUserDailyReminderHour } from "../services/reminder-engine";
import {
  canViewFullProfile,
  getFollowCounts,
  isFollowing,
  publicLinkWhere,
} from "../lib/profile-access";
import { normalizeUsername } from "../lib/username";
import { z } from "zod";

const router = Router();

router.get("/search", optionalUniversalAuth, async (req: AuthRequest, res: any) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (q.length < 2) {
      return res.json({ users: [] });
    }

    const users = await prisma.user.findMany({
      where: {
        username: { contains: q, mode: "insensitive" },
      },
      take: 20,
      select: {
        username: true,
        displayName: true,
        profileVisibility: true,
        bio: true,
      },
      orderBy: { username: "asc" },
    });

    return res.json({
      users: users.map((u) => ({
        username: u.username,
        displayName: u.displayName,
        bio: u.bio,
        profileVisibility: u.profileVisibility,
      })),
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:username", optionalUniversalAuth, async (req: AuthRequest, res: any) => {
  try {
    const username = normalizeUsername(req.params.username);
    const viewerId = req.userId || null;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const isSelf = viewerId === user.id;
    const canView = await canViewFullProfile(user.id, viewerId);
    const counts = await getFollowCounts(user.id);
    const following =
      viewerId && !isSelf ? await isFollowing(viewerId, user.id) : false;

    const base = {
      username: user.username,
      displayName: user.displayName,
      bio: canView || isSelf ? user.bio : null,
      profileVisibility: user.profileVisibility,
      isPrivate: user.profileVisibility === "private" && !canView && !isSelf,
      isSelf,
      isFollowing: following,
      ...counts,
    };

    if (!canView && !isSelf) {
      return res.json({ ...base, links: [] });
    }

    const linkFilter = isSelf
      ? { userId: user.id, status: "active" as const }
      : publicLinkWhere(user.id);

    const links = await prisma.savedLink.findMany({
      where: linkFilter,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        url: true,
        category: true,
        extractedDeadline: true,
        urgencyScore: true,
        visibility: true,
        rollingApplication: true,
        status: true,
        createdAt: true,
      },
    });

    return res.json({
      ...base,
      links: isSelf ? links : links.filter((l) => l.visibility === "public"),
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:username/follow", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const followerId = req.userId as string;
    const username = normalizeUsername(req.params.username);
    const target = await prisma.user.findUnique({ where: { username } });
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.id === followerId) {
      return res.status(400).json({ error: "Cannot follow yourself" });
    }

    await prisma.follow.upsert({
      where: {
        followerId_followingId: { followerId, followingId: target.id },
      },
      create: { followerId, followingId: target.id },
      update: {},
    });

    const counts = await getFollowCounts(target.id);
    return res.json({ ok: true, isFollowing: true, ...counts });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:username/follow", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const followerId = req.userId as string;
    const username = normalizeUsername(req.params.username);
    const target = await prisma.user.findUnique({ where: { username } });
    if (!target) return res.status(404).json({ error: "User not found" });

    await prisma.follow.deleteMany({
      where: { followerId, followingId: target.id },
    });

    const counts = await getFollowCounts(target.id);
    return res.json({ ok: true, isFollowing: false, ...counts });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      profileVisibility: user.profileVisibility,
      timezone: user.timezone,
      timezoneConfigured: user.timezoneConfigured,
      dailyReminderHour: user.dailyReminderHour,
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
      dailyReminderHour: z.number().int().min(0).max(23).optional(),
      preferredChannels: z.array(z.enum(["email", "telegram", "whatsapp"])).optional(),
      telegramId: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const update: {
      timezone?: string;
      timezoneConfigured?: boolean;
      dailyReminderHour?: number;
      preferredChannels?: string[];
      telegramId?: string;
    } = {};

    if (data.timezone !== undefined) {
      update.timezone = normalizeTimezone(data.timezone);
      update.timezoneConfigured = true;
    }
    if (data.dailyReminderHour !== undefined) {
      const withHour = await setUserDailyReminderHour(userId, data.dailyReminderHour);
      if (data.timezone === undefined && data.preferredChannels === undefined && data.telegramId === undefined) {
        return res.json({
          id: withHour.id,
          email: withHour.email,
          username: withHour.username,
          displayName: withHour.displayName,
          profileVisibility: withHour.profileVisibility,
          timezone: withHour.timezone,
          timezoneConfigured: withHour.timezoneConfigured,
          dailyReminderHour: withHour.dailyReminderHour,
          preferredChannels: withHour.preferredChannels,
          telegramId: withHour.telegramId,
          telegramConnected: !!withHour.telegramId,
          plan: withHour.plan,
        });
      }
      update.dailyReminderHour = withHour.dailyReminderHour;
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
      username: updated.username,
      displayName: updated.displayName,
      profileVisibility: updated.profileVisibility,
      timezone: updated.timezone,
      timezoneConfigured: updated.timezoneConfigured,
      dailyReminderHour: updated.dailyReminderHour,
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

import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/", async (_req, res: any) => {
  try {
    const users = await prisma.user.findMany({
      where: { profileVisibility: "public" },
      select: {
        id: true,
        username: true,
        displayName: true,
        _count: {
          select: {
            savedLinks: { where: { status: "active" } },
            followers: true,
          },
        },
      },
    });

    const ranked = users
      .map((u) => ({
        username: u.username,
        displayName: u.displayName,
        activeLinkCount: u._count.savedLinks,
        followersCount: u._count.followers,
      }))
      .filter((u) => u.activeLinkCount > 0)
      .sort((a, b) => b.activeLinkCount - a.activeLinkCount)
      .slice(0, 50);

    return res.json({ leaderboard: ranked });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

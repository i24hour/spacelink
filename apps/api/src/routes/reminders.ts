import { Router } from "express";
import { universalAuth, AuthRequest } from "../lib/universal-auth";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const reminders = await prisma.reminder.findMany({
      where: {
        savedLink: { userId },
      },
      include: { savedLink: true },
      orderBy: { reminderTime: "asc" },
    });
    return res.json(reminders);
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/upcoming", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const reminders = await prisma.reminder.findMany({
      where: {
        savedLink: { userId },
        sentStatus: "pending",
        reminderTime: { gte: new Date() },
      },
      include: { savedLink: true },
      orderBy: { reminderTime: "asc" },
      take: 50,
    });
    return res.json(reminders);
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

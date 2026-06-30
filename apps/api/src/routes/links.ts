import { Router } from "express";
import { Prisma } from "@deadlineai/db";
import { z } from "zod";
import { isHttpUrl } from "@deadlineai/shared";
import { prisma } from "../lib/prisma";
import { universalAuth, AuthRequest } from "../lib/universal-auth";
import { linkProcessorQueue } from "../queues/processor";

const router = Router();

const createSchema = z.object({
  url: z.string().url().refine(isHttpUrl, {
    message: "URL must be http or https",
  }),
  title: z.string().min(1),
  rawContent: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  manualDeadline: z.string().datetime().optional(),
});

router.post("/", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const parsed = createSchema.parse(req.body);
    const userId = req.userId as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not synced yet" });
    }

    // Limit free plan
    if (user.plan === "free") {
      const count = await prisma.savedLink.count({
        where: { userId: user.id, status: { in: ["active", "pending"] } },
      });
      if (count >= 10) {
        return res.status(403).json({ error: "Free plan limit reached" });
      }
    }

    const link = await prisma.savedLink.create({
      data: {
        userId: user.id,
        url: parsed.url,
        title: parsed.title,
        rawContent: parsed.rawContent || "",
        metadata: (parsed.metadata || {}) as Prisma.InputJsonValue,
        extractedDeadline: parsed.manualDeadline ? new Date(parsed.manualDeadline) : null,
        status: "pending",
      },
    });

    await linkProcessorQueue.add("extract-link", { savedLinkId: link.id });

    return res.status(201).json(link);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const links = await prisma.savedLink.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return res.json(links);
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const { id } = req.params;

    const updateSchema = z.object({
      title: z.string().min(1).optional(),
      extractedDeadline: z.string().datetime().optional(),
      timezone: z.string().optional(),
      category: z.string().optional(),
      urgencyScore: z.number().min(1).max(10).optional(),
      rollingApplication: z.boolean().optional(),
      estimatedCompletionMinutes: z.number().optional(),
      status: z.enum(["active", "archived", "expired"]).optional(),
      visibility: z.enum(["public", "private"]).optional(),
    });

    const data = updateSchema.parse(req.body);

    const link = await prisma.savedLink.findFirst({
      where: { id, userId },
    });
    if (!link) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.savedLink.update({
      where: { id },
      data: {
        ...data,
        extractedDeadline: data.extractedDeadline
          ? new Date(data.extractedDeadline)
          : undefined,
      },
    });

    return res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", universalAuth, async (req: AuthRequest, res: any) => {
  try {
    const userId = req.userId as string;
    const { id } = req.params;
    const link = await prisma.savedLink.findFirst({
      where: { id, userId },
    });
    if (!link) return res.status(404).json({ error: "Not found" });
    await prisma.savedLink.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

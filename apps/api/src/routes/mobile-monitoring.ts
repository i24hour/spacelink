import crypto from "crypto";
import express, { Router } from "express";
import { z } from "zod";
import { generateMobileToken } from "../lib/auth";
import { hashMobileToken, mobileAuth, MobileAuthRequest } from "../lib/mobile-auth";
import { prisma } from "../lib/prisma";
import { universalAuth, AuthRequest } from "../lib/universal-auth";
import { sendTelegramRaw } from "../services/notifications/telegram";
import {
  buildFocusBehaviorContext,
  fallbackIntervention,
  telegramHeadlineForLevel,
  type FocusCheckHistoryItem,
} from "../services/focus-context";
import { analyzeScreenImage } from "../services/screen-analysis";

const router = Router();
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const exchangeAttempts = new Map<string, { startedAt: number; count: number }>();

function isPairingExchangeAllowed(ip: string): boolean {
  const now = Date.now();
  const current = exchangeAttempts.get(ip);
  if (!current || now - current.startedAt >= 60_000) {
    exchangeAttempts.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
}

function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function createPairingCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashPairingCode(code: string): string {
  return hashMobileToken(`pair:${code}`);
}

function mobileStatus(session: {
  id: string;
  goal: string;
  status: string;
  intervalMins: number;
  startedAt: Date;
  pausedAt: Date | null;
  stoppedAt: Date | null;
  lastCheckAt: Date | null;
} | null, device: { id: string; name: string; lastSeenAt: Date | null }) {
  return {
    device: {
      id: device.id,
      name: device.name,
      lastSeenAt: device.lastSeenAt,
    },
    session: session
      ? {
          id: session.id,
          goal: session.goal,
          status: session.status,
          intervalMinutes: session.intervalMins,
          startedAt: session.startedAt,
          pausedAt: session.pausedAt,
          stoppedAt: session.stoppedAt,
          lastCheckAt: session.lastCheckAt,
        }
      : null,
  };
}

async function getDevice(req: MobileAuthRequest) {
  return prisma.mobileDevice.findFirst({
    where: { id: req.mobileDeviceId, userId: req.userId, revokedAt: null },
  });
}

router.post("/pair-code", universalAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId as string;
    const code = createPairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

    await prisma.mobilePairingCode.deleteMany({
      where: { userId, usedAt: null },
    });
    await prisma.mobilePairingCode.create({
      data: { userId, codeHash: hashPairingCode(code), expiresAt },
    });

    return res.json({ code, expiresAt });
  } catch (error) {
    console.error("mobile pair-code error:", error);
    return res.status(500).json({ error: "Could not create pairing code" });
  }
});

router.post("/exchange", async (req, res) => {
  try {
    if (!isPairingExchangeAllowed(req.ip || "unknown")) {
      return res.status(429).json({ error: "Too many pairing attempts. Try again later." });
    }
    const data = z
      .object({
        code: z.string().regex(/^\d{6}$/),
        deviceName: z.string().trim().min(1).max(80).optional(),
      })
      .parse(req.body);
    const now = new Date();
    const pairing = await prisma.mobilePairingCode.findFirst({
      where: {
        codeHash: hashPairingCode(data.code),
        usedAt: null,
        expiresAt: { gt: now },
      },
    });

    if (!pairing) return res.status(400).json({ error: "Invalid or expired pairing code" });

    const deviceId = crypto.randomUUID();
    const token = generateMobileToken(pairing.userId, deviceId);
    const device = await prisma.$transaction(async (tx) => {
      const claimed = await tx.mobilePairingCode.updateMany({
        where: { id: pairing.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new Error("Pairing code has already been used");
      return tx.mobileDevice.create({
        data: {
          id: deviceId,
          userId: pairing.userId,
          name: data.deviceName || "Android phone",
          tokenHash: hashMobileToken(token),
          lastSeenAt: now,
        },
      });
    });

    return res.json({
      token,
      device: { id: device.id, name: device.name },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Code must be six digits" });
    console.error("mobile exchange error:", error);
    return res.status(500).json({ error: "Could not pair device" });
  }
});

router.get("/status", mobileAuth, async (req: MobileAuthRequest, res) => {
  const device = await getDevice(req);
  if (!device) return res.status(404).json({ error: "Device not found" });
  const session = await prisma.monitoringSession.findFirst({
    where: { userId: req.userId as string, deviceId: device.id, status: { in: ["active", "paused"] } },
    orderBy: { createdAt: "desc" },
  });
  return res.json(mobileStatus(session, device));
});

router.post("/start", mobileAuth, async (req: MobileAuthRequest, res) => {
  try {
    const device = await getDevice(req);
    if (!device) return res.status(404).json({ error: "Device not found" });
    const data = z
      .object({
        goal: z.string().trim().min(3).max(500),
        intervalMinutes: z
          .number()
          .int()
          .min(5)
          .max(60)
          .refine((value) => value % 5 === 0)
          .optional(),
      })
      .parse(req.body);
    const userId = req.userId as string;

    await prisma.monitoringSession.updateMany({
      where: { userId, status: { in: ["active", "paused"] } },
      data: { status: "stopped", stoppedAt: new Date() },
    });
    const session = await prisma.monitoringSession.create({
      data: {
        userId,
        deviceId: device.id,
        goal: data.goal,
        intervalMins: data.intervalMinutes || 60,
      },
    });
    return res.json(mobileStatus(session, device));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Goal is required and interval must be 5, 10, 15 ... 60 minutes",
      });
    }
    console.error("mobile start error:", error);
    return res.status(500).json({ error: "Could not start monitoring" });
  }
});

router.post("/pause", mobileAuth, async (req: MobileAuthRequest, res) => {
  const device = await getDevice(req);
  if (!device) return res.status(404).json({ error: "Device not found" });
  const session = await prisma.monitoringSession.findFirst({
    where: { userId: req.userId as string, deviceId: device.id, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!session) return res.status(404).json({ error: "No active monitoring session" });
  const updated = await prisma.monitoringSession.update({
    where: { id: session.id },
    data: { status: "paused", pausedAt: new Date() },
  });
  return res.json(mobileStatus(updated, device));
});

router.post("/resume", mobileAuth, async (req: MobileAuthRequest, res) => {
  const device = await getDevice(req);
  if (!device) return res.status(404).json({ error: "Device not found" });
  const session = await prisma.monitoringSession.findFirst({
    where: { userId: req.userId as string, deviceId: device.id, status: "paused" },
    orderBy: { createdAt: "desc" },
  });
  if (!session) return res.status(404).json({ error: "No paused monitoring session" });
  const updated = await prisma.monitoringSession.update({
    where: { id: session.id },
    data: { status: "active", pausedAt: null },
  });
  return res.json(mobileStatus(updated, device));
});

router.post("/stop", mobileAuth, async (req: MobileAuthRequest, res) => {
  const device = await getDevice(req);
  if (!device) return res.status(404).json({ error: "Device not found" });
  const result = await prisma.monitoringSession.updateMany({
    where: { userId: req.userId as string, deviceId: device.id, status: { in: ["active", "paused"] } },
    data: { status: "stopped", stoppedAt: new Date() },
  });
  return res.json({ ok: true, stopped: result.count });
});

router.post("/revoke", mobileAuth, async (req: MobileAuthRequest, res) => {
  const device = await getDevice(req);
  if (!device) return res.status(404).json({ error: "Device not found" });
  await prisma.$transaction([
    prisma.monitoringSession.updateMany({
      where: { deviceId: device.id, status: { in: ["active", "paused"] } },
      data: { status: "stopped", stoppedAt: new Date() },
    }),
    prisma.mobileDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } }),
  ]);
  return res.json({ ok: true });
});

router.post(
  "/screen-check",
  mobileAuth,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }),
  async (req: MobileAuthRequest, res) => {
    try {
      const device = await getDevice(req);
      if (!device) return res.status(404).json({ error: "Device not found" });
      const session = await prisma.monitoringSession.findFirst({
        where: { userId: req.userId as string, deviceId: device.id, status: "active" },
        orderBy: { createdAt: "desc" },
      });
      if (!session) return res.status(409).json({ error: "Monitoring is not active" });

      const image = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!image.length || image.length > MAX_SCREENSHOT_BYTES) {
        return res.status(400).json({ error: "Screenshot is missing or too large" });
      }

      const capturedAtRaw = String(req.headers["x-captured-at"] || "");
      const capturedAt = capturedAtRaw ? new Date(capturedAtRaw) : new Date();
      const safeCapturedAt = Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt;
      const recent = await prisma.screenCheck.findMany({
        where: { sessionId: session.id },
        orderBy: { capturedAt: "desc" },
        take: 24,
        select: {
          classification: true,
          observedActivity: true,
          suggestion: true,
          capturedAt: true,
          telegramSentAt: true,
        },
      });
      const mapCheck = (item: {
        classification: string;
        observedActivity: string | null;
        suggestion: string | null;
        capturedAt: Date;
        telegramSentAt: Date | null;
      }): FocusCheckHistoryItem => ({
        classification: item.classification,
        observedActivity: item.observedActivity,
        suggestion: item.suggestion,
        capturedAt: item.capturedAt,
        telegramSentAt: item.telegramSentAt,
      });
      const history: FocusCheckHistoryItem[] = recent.map(mapCheck);
      const since = new Date(safeCapturedAt.getTime() - 48 * 60 * 60 * 1000);
      const dayRows = await prisma.screenCheck.findMany({
        where: {
          capturedAt: { gte: since },
          classification: "productive",
          session: { userId: req.userId as string },
        },
        orderBy: { capturedAt: "desc" },
        take: 200,
        select: {
          classification: true,
          observedActivity: true,
          suggestion: true,
          capturedAt: true,
          telegramSentAt: true,
        },
      });
      const dayHistory: FocusCheckHistoryItem[] = dayRows.map(mapCheck);
      // Assume current may be off_track so the coach prompt gets the right escalation ladder.
      const behaviorContext = buildFocusBehaviorContext({
        historyNewestFirst: history,
        dayHistoryNewestFirst: dayHistory,
        intervalMins: session.intervalMins,
        now: safeCapturedAt,
        assumeCurrentOffTrack: true,
      });
      const mimeType = String(req.headers["content-type"] || "image/jpeg").split(";")[0];
      const analysis = await analyzeScreenImage(
        image.toString("base64"),
        mimeType,
        session.goal,
        behaviorContext
      );

      const fallbackArgs = {
        goal: session.goal,
        level: analysis.escalationLevel,
        projectedStreak: behaviorContext.projectedOffTrackStreak,
        projectedMinutes: behaviorContext.projectedMinutesOffTrack,
        nudgesIgnored: behaviorContext.nudgesIgnored,
        productiveStreakBeforeSlip: behaviorContext.productiveStreakBeforeSlip,
        productiveMinutesBeforeSlip: behaviorContext.productiveMinutesBeforeSlip,
        productiveMinutesYesterday: behaviorContext.productiveMinutesYesterday,
        lastInterventions: behaviorContext.lastInterventions,
      };

      let suggestion = analysis.suggestion;
      if (
        analysis.classification === "off_track" &&
        !analysis.sensitiveContent &&
        !suggestion
      ) {
        suggestion = fallbackIntervention(fallbackArgs);
      }

      const check = await prisma.screenCheck.create({
        data: {
          sessionId: session.id,
          deviceId: device.id,
          capturedAt: safeCapturedAt,
          classification: analysis.classification,
          confidence: analysis.confidence,
          observedActivity: analysis.observedActivity,
          reason: analysis.reason,
          suggestion,
          sensitiveContent: analysis.sensitiveContent,
        },
      });
      await prisma.monitoringSession.update({
        where: { id: session.id },
        data: { lastCheckAt: new Date() },
      });

      const user = await prisma.user.findUnique({ where: { id: req.userId as string } });
      let telegramSent = false;
      if (user?.telegramId && analysis.classification === "off_track" && !analysis.sensitiveContent) {
        const level = analysis.escalationLevel;
        const headline = telegramHeadlineForLevel(level);
        const factSuffix =
          level >= 1
            ? `\n\n<i>(check #${behaviorContext.projectedOffTrackStreak} · ~${behaviorContext.projectedMinutesOffTrack} min)</i>`
            : "";
        const intervention = escapeTelegramHtml(
          suggestion || fallbackIntervention({ ...fallbackArgs, level })
        );
        const message = `⚠️ <b>${escapeTelegramHtml(headline)}</b>\n\n${intervention}${factSuffix}`;
        const delivered = await sendTelegramRaw(user.telegramId, message, "HTML");
        telegramSent = delivered.delivered;
        if (telegramSent) {
          await prisma.screenCheck.update({ where: { id: check.id }, data: { telegramSentAt: new Date() } });
        }
      }

      return res.json({
        ok: true,
        check: {
          id: check.id,
          classification: analysis.classification,
          confidence: analysis.confidence,
          observedActivity: analysis.observedActivity,
          reason: analysis.reason,
          suggestion,
          sensitiveContent: analysis.sensitiveContent,
          escalationLevel: analysis.escalationLevel,
          telegramSent,
        },
      });
    } catch (error) {
      console.error("mobile screen-check error:", error);
      return res.status(500).json({ error: "Could not analyze screenshot" });
    }
  }
);

export default router;

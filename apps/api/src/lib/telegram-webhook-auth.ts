import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { getTelegramWebhookSecret } from "./secrets";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Rejects requests that don't carry Telegram's webhook secret header. */
export function requireTelegramWebhookSecret(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const expected = getTelegramWebhookSecret();

  // Dev-only: skip when secret is not configured locally
  if (!expected) {
    return next();
  }

  const provided = req.headers["x-telegram-bot-api-secret-token"];
  const token = typeof provided === "string" ? provided : "";

  if (!token || !safeEqual(token, expected)) {
    return res.sendStatus(403);
  }

  return next();
}

/** Protects webhook setup — same secret as Telegram sends on each update. */
export function requireTelegramSetupSecret(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const expected = getTelegramWebhookSecret();

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({ error: "TELEGRAM_WEBHOOK_SECRET not configured" });
    }
    return next();
  }

  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const headerSecret = req.headers["x-telegram-setup-secret"];
  const provided =
    bearer ||
    (typeof headerSecret === "string" ? headerSecret : "") ||
    (typeof req.query.secret === "string" ? req.query.secret : "");

  if (!provided || !safeEqual(provided, expected)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return next();
}

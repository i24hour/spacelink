import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";
import { prisma } from "./prisma";
import { JWT_SECRET, TELEGRAM_LINK_SECRET } from "./secrets";
import { generateUniqueUsername } from "./username";
const GOOGLE_CLIENT_IDS = (process.env.GOOGLE_CLIENT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const googleClient = new OAuth2Client();

export interface AuthRequest extends Request {
  userId?: string;
}

export function generateToken(userId: string) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { sub: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };
    return decoded;
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: "Invalid token" });
  }

  req.userId = decoded.sub;
  next();
}

export async function verifyGoogleToken(idToken: string) {
  if (GOOGLE_CLIENT_IDS.length === 0) {
    throw new Error("GOOGLE_CLIENT_IDS not configured");
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_IDS,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error("Invalid Google token");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture || null,
  };
}

export async function upsertUserFromGoogle(googleUser: {
  googleId: string;
  email: string;
  name: string;
  picture: string | null;
}) {
  const existing = await prisma.user.findUnique({ where: { email: googleUser.email } });
  if (existing) return existing;

  const username = await generateUniqueUsername(googleUser.email);
  const user = await prisma.user.create({
    data: {
      id: `g_${googleUser.googleId}`,
      email: googleUser.email,
      username,
      displayName: googleUser.name || null,
    },
  });
  return user;
}

const TELEGRAM_LINK_TTL_SECONDS = 60 * 10;

function createSignedTelegramToken(kind: "u" | "c", value: string): string {
  const expiresAt = (Math.floor(Date.now() / 1000) + TELEGRAM_LINK_TTL_SECONDS).toString(36);
  const encodedValue = Buffer.from(value, "utf8").toString("base64url");
  const payload = `${kind}_${expiresAt}_${encodedValue}`;
  const signature = crypto.createHmac("sha256", TELEGRAM_LINK_SECRET).update(payload).digest("hex").slice(0, 16);
  return `${payload}_${signature}`;
}

function consumeSignedTelegramToken(token: string, expectedKind: "u" | "c"): string | null {
  const lastUnderscore = token.lastIndexOf("_");
  if (lastUnderscore <= 0) return null;

  const payload = token.slice(0, lastUnderscore);
  const signature = token.slice(lastUnderscore + 1);

  const expectedSignature = crypto.createHmac("sha256", TELEGRAM_LINK_SECRET).update(payload).digest("hex").slice(0, 16);
  if (signature.length !== expectedSignature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;

  const parts = payload.split("_");
  if (parts.length < 3) return null;

  const kind = parts[0];
  const expiresAtRaw = parts[1];
  const encodedValue = parts.slice(2).join("_");

  if (kind !== expectedKind) return null;

  const expiresAt = Number.parseInt(expiresAtRaw, 36);
  if (!Number.isFinite(expiresAt)) return null;
  if (Math.floor(Date.now() / 1000) > expiresAt) return null;

  try {
    return Buffer.from(encodedValue, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function createTelegramLinkToken(userId: string): string {
  return createSignedTelegramToken("u", userId);
}

export function consumeTelegramLinkToken(token: string): string | null {
  return consumeSignedTelegramToken(token, "u");
}

export function createTelegramChatLinkToken(chatId: string, userId: string): string {
  return createSignedTelegramToken("c", `${chatId}:${userId}`);
}

/** Token for an unlinked Telegram chat that a user can claim after signing in. */
export function createTelegramChatOnlyLinkToken(chatId: string): string {
  return createSignedTelegramToken("c", chatId);
}

export function consumeTelegramChatLinkToken(token: string): { chatId: string; userId?: string } | null {
  const raw = consumeSignedTelegramToken(token, "c");
  if (!raw) return null;
  const [chatId, userId] = raw.split(":");
  if (!chatId) return null;
  return { chatId, userId };
}

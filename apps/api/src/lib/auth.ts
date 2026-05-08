import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "./prisma";

const JWT_SECRET = process.env.JWT_SECRET || "deadlineai-local-secret-change-me";
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
  const user = await prisma.user.upsert({
    where: { email: googleUser.email },
    create: {
      id: `g_${googleUser.googleId}`,
      email: googleUser.email,
    },
    update: {},
  });
  return user;
}

// Short-lived tokens for Telegram deep-link auth
const telegramLinkCache = new Map<string, { userId: string; expiresAt: number }>();

export function createTelegramLinkToken(userId: string): string {
  const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  telegramLinkCache.set(token, { userId, expiresAt: Date.now() + 1000 * 60 * 10 }); // 10 min expiry
  return token;
}

export function consumeTelegramLinkToken(token: string): string | null {
  const entry = telegramLinkCache.get(token);
  if (!entry) return null;
  telegramLinkCache.delete(token);
  if (Date.now() > entry.expiresAt) return null;
  return entry.userId;
}

// Cleanup expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of telegramLinkCache.entries()) {
    if (now > val.expiresAt) telegramLinkCache.delete(key);
  }
}, 1000 * 60 * 5);

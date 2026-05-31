import crypto from "crypto";
import { prisma } from "./prisma";

export const USERNAME_REGEX = /^[a-z0-9_]{3,30}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

export function validateUsername(username: string): string | null {
  const normalized = normalizeUsername(username);
  if (!USERNAME_REGEX.test(normalized)) {
    return "Username must be 3–30 characters: lowercase letters, numbers, underscores only";
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return "This username is reserved";
  }
  return null;
}

const RESERVED_USERNAMES = new Set([
  "me",
  "search",
  "leaderboard",
  "profile",
  "settings",
  "dashboard",
  "auth",
  "api",
  "admin",
]);

function randomSuffix(length = 6): string {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

export async function generateUniqueUsername(hint?: string): Promise<string> {
  const baseFromHint = hint
    ? normalizeUsername(hint.split("@")[0] || hint).replace(/_+/g, "_").slice(0, 20)
    : "";
  const base = baseFromHint && baseFromHint.length >= 3 ? baseFromHint : `user_${randomSuffix(4)}`;

  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate =
      attempt === 0 && USERNAME_REGEX.test(base)
        ? base
        : `${base.slice(0, 20)}_${randomSuffix(4)}`.slice(0, 30);
    const normalized = normalizeUsername(candidate);
    if (!USERNAME_REGEX.test(normalized)) continue;
    const existing = await prisma.user.findUnique({ where: { username: normalized } });
    if (!existing) return normalized;
  }

  return `user_${randomSuffix(8)}`;
}

export async function ensureUserUsername(userId: string, email?: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");
  if (user.username) return user.username;

  const username = await generateUniqueUsername(email || user.email);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { username },
  });
  return updated.username;
}

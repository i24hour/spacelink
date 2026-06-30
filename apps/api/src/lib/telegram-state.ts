import { redis } from "./redis";

type PendingDeadlineConfirmation = {
  linkId: string;
  awaiting: "manual_date";
};

const PREFIX = "deadlineai:telegram";

function key(...parts: string[]): string {
  return [PREFIX, ...parts].join(":");
}

export async function getPendingDeadlineConfirmation(
  chatId: string
): Promise<PendingDeadlineConfirmation | null> {
  const raw = await redis.get(key("pending", chatId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingDeadlineConfirmation;
  } catch {
    return null;
  }
}

export async function setPendingDeadlineConfirmation(
  chatId: string,
  value: PendingDeadlineConfirmation,
  ttlSeconds = 600
): Promise<void> {
  await redis.set(key("pending", chatId), JSON.stringify(value), "EX", ttlSeconds);
}

export async function deletePendingDeadlineConfirmation(chatId: string): Promise<void> {
  await redis.del(key("pending", chatId));
}

export async function getLastDeadlineList(chatId: string): Promise<string[]> {
  const raw = await redis.get(key("list", chatId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((i) => typeof i === "string")) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return [];
}

export async function setLastDeadlineList(
  chatId: string,
  linkIds: string[],
  ttlSeconds = 3600
): Promise<void> {
  await redis.set(key("list", chatId), JSON.stringify(linkIds), "EX", ttlSeconds);
}

/** Acquires a short-lived Redis lock for a (linkId, mode) reminder-schedule choice.
 *  Returns true if the lock was acquired. */
export async function acquireScheduleLock(
  linkId: string,
  mode: string,
  ttlSeconds = 30
): Promise<boolean> {
  const acquired = await redis.set(key("schedule-lock", linkId, mode), "1", "EX", ttlSeconds, "NX");
  return acquired === "OK";
}

export async function releaseScheduleLock(linkId: string, mode: string): Promise<void> {
  await redis.del(key("schedule-lock", linkId, mode));
}

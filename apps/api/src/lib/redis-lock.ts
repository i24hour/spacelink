import { redis } from "./redis";

const LOCK_PREFIX = "deadlineai:lock:";

function lockKey(name: string): string {
  return `${LOCK_PREFIX}${name}`;
}

export async function acquireLock(
  name: string,
  ttlSeconds: number
): Promise<{ release: () => Promise<void> } | null> {
  const key = lockKey(name);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const acquired = await redis.set(key, token, "EX", ttlSeconds, "NX");
  if (acquired !== "OK") return null;

  return {
    async release() {
      const current = await redis.get(key);
      if (current === token) {
        await redis.del(key);
      }
    },
  };
}

export async function withLock<T>(
  name: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T | null> {
  const lock = await acquireLock(name, ttlSeconds);
  if (!lock) return null;
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

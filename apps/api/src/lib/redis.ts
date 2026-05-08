import { Redis } from "ioredis";

export const redis = new Redis(process.env.UPSTASH_REDIS_URL || "", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const redisPub = redis.duplicate();

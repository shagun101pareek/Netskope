import type { Redis } from "ioredis";
import { AppError } from "./errors.js";

/**
 * Fixed-window counter. Fails closed: if Redis cannot count the attempt,
 * authentication does not proceed.
 */
export async function enforceRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  let count: number;

  try {
    count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
  } catch {
    throw new AppError(503, "RATE_LIMIT_UNAVAILABLE", "Authentication is temporarily unavailable.");
  }

  if (count > limit) {
    throw new AppError(429, "RATE_LIMITED", "Too many attempts. Try again later.");
  }
}

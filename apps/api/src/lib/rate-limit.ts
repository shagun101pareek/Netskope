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
  unavailableMessage = "Authentication is temporarily unavailable.",
): Promise<void> {
  let count: number;

  try {
    count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
  } catch {
    throw new AppError(503, "RATE_LIMIT_UNAVAILABLE", unavailableMessage);
  }

  if (count > limit) {
    throw new AppError(429, "RATE_LIMITED", "Too many attempts. Try again later.");
  }
}

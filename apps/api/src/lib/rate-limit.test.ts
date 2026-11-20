import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import { enforceRateLimit } from "./rate-limit.js";

function memoryRedis() {
  const counts = new Map<string, number>();

  return {
    async incr(key: string) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async expire() {
      return 1;
    },
  };
}

describe("enforceRateLimit", () => {
  it("allows attempts inside the window and rejects the next one", async () => {
    const redis = memoryRedis();

    await enforceRateLimit(redis as never, "login", 2, 60);
    await enforceRateLimit(redis as never, "login", 2, 60);

    await expect(enforceRateLimit(redis as never, "login", 2, 60)).rejects.toMatchObject({
      statusCode: 429,
      code: "RATE_LIMITED",
    });
  });

  it("fails closed when Redis cannot count", async () => {
    const redis = {
      async incr() {
        throw new Error("redis down");
      },
      async expire() {
        return 1;
      },
    };

    await expect(enforceRateLimit(redis as never, "login", 5, 60)).rejects.toBeInstanceOf(AppError);
  });
});

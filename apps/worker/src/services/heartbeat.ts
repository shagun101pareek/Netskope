import { prisma } from "@netskope/database";
import {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
  type WorkerHeartbeat,
} from "@netskope/shared";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

/**
 * Publishes a short-lived heartbeat only after Postgres responds.
 * If either dependency is down, the key is left to expire so the API reports the worker as down.
 * The process stays alive and retries, which is the recovery behavior for a transient outage.
 */
export function startHeartbeat(redis: Redis, logger: Logger): () => Promise<void> {
  let stopped = false;
  let inFlight = Promise.resolve();

  const publish = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    await prisma.$queryRaw`SELECT 1`;

    if (stopped) {
      return;
    }

    const payload: WorkerHeartbeat = {
      service: "worker",
      status: "ok",
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    };

    await redis.set(
      WORKER_HEARTBEAT_KEY,
      JSON.stringify(payload),
      "EX",
      WORKER_HEARTBEAT_TTL_SECONDS,
    );
  };

  const beat = (): void => {
    inFlight = inFlight
      .catch(() => undefined)
      .then(async () => {
        try {
          await publish();
        } catch (error) {
          logger.error({ err: error }, "heartbeat skipped because a dependency is unavailable");
        }
      });
  };

  beat();
  const timer = setInterval(beat, WORKER_HEARTBEAT_INTERVAL_MS);

  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight.catch(() => undefined);

    try {
      await redis.del(WORKER_HEARTBEAT_KEY);
    } catch (error) {
      logger.warn({ err: error }, "failed to clear worker heartbeat");
    }
  };
}

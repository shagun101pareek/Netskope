import { prisma } from "@netskope/database";
import { WORKER_HEARTBEAT_KEY, isWorkerHeartbeat, type DependencyStatus } from "@netskope/shared";
import type { Redis } from "ioredis";

export async function checkPostgres(): Promise<DependencyStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}

export async function checkRedis(redis: Redis): Promise<DependencyStatus> {
  try {
    return (await redis.ping()) === "PONG" ? "up" : "down";
  } catch {
    return "down";
  }
}

export async function checkWorker(redis: Redis): Promise<DependencyStatus> {
  try {
    const raw = await redis.get(WORKER_HEARTBEAT_KEY);

    if (!raw) {
      return "down";
    }

    return isWorkerHeartbeat(JSON.parse(raw) as unknown) ? "up" : "down";
  } catch {
    return "down";
  }
}

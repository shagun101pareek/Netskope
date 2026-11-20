import "./load-env.js";
import { prisma } from "@netskope/database";
import { Redis } from "ioredis";
import pino from "pino";
import { startHeartbeat } from "./services/heartbeat.js";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const logger = pino({
  name: "worker",
  level: process.env.LOG_LEVEL ?? "info",
});

const redis = new Redis(required("REDIS_URL"), {
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  enableOfflineQueue: false,
  retryStrategy(times: number) {
    return Math.min(times * 200, 2_000);
  },
});

redis.on("error", (error: unknown) => {
  logger.error({ err: error }, "redis connection error");
});

const stopHeartbeat = startHeartbeat(redis, logger);

logger.info("browser worker started");
logger.info("browser sessions are not launched from this process until instrumentation is added");

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down worker");
  await stopHeartbeat();
  redis.disconnect();
  await prisma.$disconnect();
}

process.on("SIGINT", () => {
  void shutdown("SIGINT").then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM").then(() => process.exit(0));
});

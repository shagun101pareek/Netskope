import { prisma } from "@netskope/database";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { AppError } from "./lib/errors.js";
import { env } from "./lib/env.js";
import { authRoutes } from "./modules/auth/auth.route.js";
import { healthRoutes } from "./modules/health/health.route.js";
import { intelligenceRoutes } from "./modules/scans/intelligence.route.js";
import { scanInsightRoutes } from "./modules/scans/scan-insights.route.js";
import { scanRoutes } from "./modules/scans/scans.route.js";
import { createReplayQueue, createScanQueue } from "./queues/scan-queue.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    if (typeof error === "object" && error !== null && "validation" in error && error.validation) {
      return reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: "Request validation failed." },
      });
    }

    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error." },
    });
  });

  await app.register(cors, {
    origin: env.webOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });
  await app.register(cookie);

  const redis = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    retryStrategy(times: number) {
      return Math.min(times * 200, 2_000);
    },
  });

  redis.on("error", (error: unknown) => {
    app.log.error({ err: error }, "redis connection error");
  });

  const scanQueue = createScanQueue(env.redisUrl);
  const replayQueue = createReplayQueue(env.redisUrl);
  scanQueue.on("error", (error: Error) => {
    app.log.error({ err: error }, "scan queue error");
  });
  replayQueue.on("error", (error: Error) => {
    app.log.error({ err: error }, "replay queue error");
  });

  app.decorate("redis", redis);
  app.decorate("scanQueue", scanQueue);
  app.decorate("replayQueue", replayQueue);
  app.decorateRequest("authUser", null);

  app.addHook("onClose", async () => {
    await scanQueue.close();
    await replayQueue.close();
    redis.disconnect();
    await prisma.$disconnect();
  });

  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(scanInsightRoutes, { prefix: "/api/v1/scans" });
  await app.register(intelligenceRoutes, { prefix: "/api/v1/scans" });
  await app.register(scanRoutes, { prefix: "/api/v1/scans" });

  return app;
}

import { prisma } from "@netskope/database";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { env } from "./lib/env.js";
import { healthRoutes } from "./modules/health/health.route.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.logLevel,
    },
  });

  await app.register(cors, {
    origin: env.webOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  const redis = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    enableOfflineQueue: false,
    retryStrategy(times: number) {
      return Math.min(times * 200, 2_000);
    },
  });

  redis.on("error", (error: unknown) => {
    app.log.error({ err: error }, "redis connection error");
  });

  app.decorate("redis", redis);

  app.addHook("onClose", async () => {
    redis.disconnect();
    await prisma.$disconnect();
  });

  await app.register(healthRoutes, { prefix: "/api/v1" });

  return app;
}

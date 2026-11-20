import { prisma } from "@netskope/database";
import { WORKER_HEARTBEAT_KEY, isWorkerHeartbeat, type DependencyStatus } from "@netskope/shared";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { summarizeHealth } from "./health.js";

const dependencyStatusSchema = {
  type: "string",
  enum: ["up", "down"],
} as const;

const healthResponseSchema = {
  type: "object",
  required: ["status", "service", "checks", "timestamp"],
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["ok", "degraded"] },
    service: { type: "string", enum: ["api"] },
    checks: {
      type: "object",
      required: ["postgres", "redis", "worker"],
      additionalProperties: false,
      properties: {
        postgres: dependencyStatusSchema,
        redis: dependencyStatusSchema,
        worker: dependencyStatusSchema,
      },
    },
    timestamp: { type: "string" },
  },
} as const;

async function checkPostgres(): Promise<DependencyStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}

async function checkRedis(redis: Redis): Promise<DependencyStatus> {
  try {
    return (await redis.ping()) === "PONG" ? "up" : "down";
  } catch {
    return "down";
  }
}

async function checkWorker(redis: Redis): Promise<DependencyStatus> {
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

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const checks = {
        postgres: await checkPostgres(),
        redis: await checkRedis(app.redis),
        worker: await checkWorker(app.redis),
      };
      const report = {
        ...summarizeHealth(checks),
        service: "api" as const,
        timestamp: new Date().toISOString(),
      };

      return reply.code(report.status === "ok" ? 200 : 503).send(report);
    },
  );
}

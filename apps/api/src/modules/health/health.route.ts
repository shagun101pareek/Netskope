import type { FastifyInstance } from "fastify";
import { checkPostgres, checkRedis, checkWorker } from "../../lib/dependencies.js";
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

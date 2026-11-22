import type { FastifyInstance } from "fastify";
import { AppError } from "../../lib/errors.js";
import { checkWorker } from "../../lib/dependencies.js";
import { enforceRateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../plugins/authenticate.js";
import { createScan, getScan, listScans } from "./scans.service.js";

const scanSchema = {
  type: "object",
  required: ["id", "url", "status", "startedAt", "completedAt", "createdAt", "errorMessage"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    url: { type: "string" },
    status: { type: "string", enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED"] },
    startedAt: { type: ["string", "null"] },
    completedAt: { type: ["string", "null"] },
    createdAt: { type: "string" },
    errorMessage: { type: ["string", "null"] },
  },
} as const;

const uuidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

export async function scanRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/",
    {
      preHandler: requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["url"],
          additionalProperties: false,
          properties: {
            url: { type: "string", minLength: 1, maxLength: 2048 },
          },
        },
        response: {
          201: {
            type: "object",
            required: ["scan"],
            additionalProperties: false,
            properties: { scan: scanSchema },
          },
        },
      },
    },
    async (request, reply) => {
      const worker = await checkWorker(app.redis);
      if (worker !== "up") {
        throw new AppError(503, "WORKER_UNAVAILABLE", "The scan worker is not accepting jobs.");
      }

      const user = request.authUser;
      if (!user) {
        throw new AppError(401, "UNAUTHORIZED", "Sign in again.");
      }

      await enforceRateLimit(
        app.redis,
        `rate:scan:${user.id}`,
        30,
        10 * 60,
        "Scan creation is temporarily unavailable.",
      );

      const body = request.body as { url: string };
      const scan = await createScan(user.id, body.url, app.scanQueue);
      return reply.code(201).send({ scan });
    },
  );

  app.get(
    "/",
    {
      preHandler: requireAuth,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "string" },
            cursor: { type: "string", pattern: uuidPattern },
          },
        },
      },
    },
    async (request) => {
      const user = request.authUser;
      if (!user) {
        throw new AppError(401, "UNAUTHORIZED", "Sign in again.");
      }

      const query = request.query as { limit?: string; cursor?: string };
      return listScans(user.id, query.limit, query.cursor);
    },
  );

  app.get(
    "/:id",
    {
      preHandler: requireAuth,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: {
            id: { type: "string", pattern: uuidPattern },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["scan"],
            additionalProperties: false,
            properties: { scan: scanSchema },
          },
        },
      },
    },
    async (request) => {
      const user = request.authUser;
      if (!user) {
        throw new AppError(401, "UNAUTHORIZED", "Sign in again.");
      }

      const params = request.params as { id: string };
      const scan = await getScan(user.id, params.id);
      return { scan };
    },
  );
}

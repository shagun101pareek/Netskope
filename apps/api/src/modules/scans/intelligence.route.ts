import { ReplayStatus, prisma } from "@netskope/database";
import type { ReplayJobData } from "@netskope/shared";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../lib/errors.js";
import { checkWorker } from "../../lib/dependencies.js";
import { requireAuth } from "../../plugins/authenticate.js";
import { dependencyGraph, listEndpoints, listInvocations, listSchemas, listTests, updateTest } from "./intelligence.service.js";
import { createReplay, getReplay } from "./replay.service.js";

const uuidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

export async function intelligenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/:id/endpoints", { preHandler: requireAuth }, async (request) => {
    const user = requiredUser(request.authUser);
    const params = request.params as { id: string };
    assertUuid(params.id);
    const query = request.query as {
      method?: string;
      status?: string;
      domain?: string;
      resourceType?: string;
      endpoint?: string;
      failed?: string;
      slow?: string;
    };
    return listEndpoints(user.id, params.id, query);
  });

  app.get("/:id/invocations", { preHandler: requireAuth }, async (request) => {
    const user = requiredUser(request.authUser);
    const params = request.params as { id: string };
    assertUuid(params.id);
    const query = request.query as { key?: string };
    return listInvocations(user.id, params.id, query.key ?? "");
  });

  app.get("/:id/schemas", { preHandler: requireAuth }, async (request) => {
    const user = requiredUser(request.authUser);
    const params = request.params as { id: string };
    assertUuid(params.id);
    return listSchemas(user.id, params.id);
  });

  app.get("/:id/tests", { preHandler: requireAuth }, async (request) => {
    const user = requiredUser(request.authUser);
    const params = request.params as { id: string };
    assertUuid(params.id);
    return listTests(user.id, params.id);
  });

  app.post("/:id/tests/run", { preHandler: requireAuth }, async (request) => {
    const user = requiredUser(request.authUser);
    const params = request.params as { id: string };
    assertUuid(params.id);
    const result = await listTests(user.id, params.id);
    return { ...result, ranAt: new Date().toISOString(), mode: "captured-data" };
  });

  app.patch("/:id/tests/:testKey", { preHandler: requireAuth }, async (request) => {
    const user = requiredUser(request.authUser);
    const params = request.params as { id: string; testKey: string };
    assertUuid(params.id);
    if (!/^[0-9a-f]{24}$/.test(params.testKey)) {
      throw new AppError(400, "VALIDATION_ERROR", "test key is not valid.");
    }
    const body = (request.body ?? {}) as { enabled?: boolean; expected?: number };
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      throw new AppError(400, "VALIDATION_ERROR", "enabled must be a boolean.");
    }
    if (body.expected !== undefined && typeof body.expected !== "number") {
      throw new AppError(400, "VALIDATION_ERROR", "expected must be a number.");
    }
    return updateTest(user.id, params.id, params.testKey, body);
  });

  app.get("/:id/dependencies", { preHandler: requireAuth }, async (request) => {
    const user = requiredUser(request.authUser);
    const params = request.params as { id: string };
    assertUuid(params.id);
    return dependencyGraph(user.id, params.id);
  });

  app.post("/:id/requests/:requestRowId/replays", { preHandler: requireAuth }, async (request, reply) => {
    const user = requiredUser(request.authUser);
    const params = request.params as { id: string; requestRowId: string };
    assertUuid(params.id);
    assertUuid(params.requestRowId);
    const worker = await checkWorker(app.redis);
    if (worker !== "up") {
      throw new AppError(503, "WORKER_UNAVAILABLE", "The scan worker is not accepting jobs.");
    }
    const body = (request.body ?? {}) as {
      method?: string;
      url?: string;
      headers?: Record<string, string>;
      body?: string | null;
      confirmed?: boolean;
      confirmMutation?: boolean;
      sendCredentials?: boolean;
    };
    const replay = await createReplay(user.id, params.id, params.requestRowId, body);
    try {
      await app.replayQueue.add("replay", { replayId: replay.id } satisfies ReplayJobData, {
        jobId: replay.id,
        attempts: 1,
        removeOnComplete: 1_000,
        removeOnFail: 1_000,
      });
    } catch (error) {
      await prisma.requestReplay.update({
        where: { id: replay.id },
        data: { status: ReplayStatus.FAILED, errorMessage: "The replay could not be queued.", completedAt: new Date() },
      });
      throw new AppError(503, "QUEUE_UNAVAILABLE", "The replay could not be queued.", { cause: error });
    }
    return reply.code(202).send({ replay });
  });

  app.get("/:id/replays/:replayId", { preHandler: requireAuth }, async (request) => {
    const user = requiredUser(request.authUser);
    const params = request.params as { id: string; replayId: string };
    assertUuid(params.id);
    assertUuid(params.replayId);
    return { replay: await getReplay(user.id, params.id, params.replayId) };
  });
}

function requiredUser(user: { id: string } | null): { id: string } {
  if (!user) {
    throw new AppError(401, "UNAUTHORIZED", "Sign in again.");
  }
  return user;
}

function assertUuid(value: string): void {
  if (!new RegExp(uuidPattern).test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "The id is not valid.");
  }
}

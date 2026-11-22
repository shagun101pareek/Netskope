import { scanEventChannel, type ScanStatusEvent } from "@netskope/shared";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../lib/errors.js";
import { env } from "../../lib/env.js";
import { requireAuth } from "../../plugins/authenticate.js";
import {
  compareScans,
  exportScan,
  getScanRequest,
  listScanRequests,
  scanAnalytics,
} from "./scan-insights.service.js";
import { getScan } from "./scans.service.js";

const uuidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

export async function scanInsightRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/compare",
    { preHandler: requireAuth },
    async (request) => {
      const user = request.authUser;
      if (!user) {
        throw new AppError(401, "UNAUTHORIZED", "Sign in again.");
      }
      const query = request.query as { left?: string; right?: string };
      if (!query.left || !query.right || !new RegExp(uuidPattern).test(query.left) || !new RegExp(uuidPattern).test(query.right)) {
        throw new AppError(400, "VALIDATION_ERROR", "left and right must be scan ids.");
      }
      return compareScans(user.id, query.left, query.right);
    },
  );

  app.get(
    "/:id/requests",
    { preHandler: requireAuth },
    async (request) => {
      const user = requiredUser(request.authUser);
      const params = request.params as { id: string };
      assertUuid(params.id);
      const query = request.query as {
        q?: string;
        method?: string;
        status?: string;
        requestClass?: string;
        sort?: string;
        limit?: string;
      };
      return listScanRequests(user.id, params.id, query);
    },
  );

  app.get(
    "/:id/requests/:requestRowId",
    { preHandler: requireAuth },
    async (request) => {
      const user = requiredUser(request.authUser);
      const params = request.params as { id: string; requestRowId: string };
      assertUuid(params.id);
      assertUuid(params.requestRowId);
      return { request: await getScanRequest(user.id, params.id, params.requestRowId) };
    },
  );

  app.get(
    "/:id/analytics",
    { preHandler: requireAuth },
    async (request) => {
      const user = requiredUser(request.authUser);
      const params = request.params as { id: string };
      assertUuid(params.id);
      return scanAnalytics(user.id, params.id);
    },
  );

  app.get(
    "/:id/export",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = requiredUser(request.authUser);
      const params = request.params as { id: string };
      assertUuid(params.id);
      const query = request.query as { format?: string };
      const exported = await exportScan(user.id, params.id, query.format);
      return reply
        .type(exported.contentType)
        .header("content-disposition", `attachment; filename="${exported.filename}"`)
        .send(exported.body);
    },
  );

  app.get(
    "/:id/events",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = requiredUser(request.authUser);
      const params = request.params as { id: string };
      assertUuid(params.id);
      const scan = await getScan(user.id, params.id);
      const eventHeaders = {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "access-control-allow-origin": env.webOrigin,
        "access-control-allow-credentials": "true",
        "x-accel-buffering": "no",
      };

      if (scan.status === "COMPLETED" || scan.status === "FAILED") {
        const event: ScanStatusEvent = { type: "status", status: scan.status, errorMessage: scan.errorMessage };
        return reply.headers(eventHeaders).send(`data: ${JSON.stringify(event)}\n\n`);
      }

      reply.hijack();
      reply.raw.writeHead(200, eventHeaders);

      const send = (event: ScanStatusEvent): void => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      send({ type: "status", status: scan.status, errorMessage: scan.errorMessage });

      const subscriber = app.redis.duplicate();
      let timer: ReturnType<typeof setInterval> | undefined;
      let closed = false;
      const close = (): void => {
        if (closed) {
          return;
        }
        closed = true;
        if (timer) {
          clearInterval(timer);
        }
        subscriber.disconnect();
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      };

      subscriber.on("message", (_channel: string, message: string) => {
        send(parseEvent(message));
        try {
          const event = JSON.parse(message) as ScanStatusEvent;
          if (event.status === "COMPLETED" || event.status === "FAILED") {
            close();
          }
        } catch {
          close();
        }
      });
      await subscriber.subscribe(scanEventChannel(scan.id));

      timer = setInterval(() => {
        void getScan(user.id, scan.id)
          .then((current) => {
            send({ type: "status", status: current.status, errorMessage: current.errorMessage });
            if (current.status === "COMPLETED" || current.status === "FAILED") {
              close();
            }
          })
          .catch(() => close());
      }, 2_000);

      request.raw.on("close", close);
    },
  );
}

function requiredUser(user: { id: string } | null): { id: string } {
  if (!user) {
    throw new AppError(401, "UNAUTHORIZED", "Sign in again.");
  }
  return user;
}

function assertUuid(value: string): void {
  if (!new RegExp(uuidPattern).test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "The id is not a valid scan or request id.");
  }
}

function parseEvent(message: string): ScanStatusEvent {
  try {
    const parsed: unknown = JSON.parse(message);
    if (parsed && typeof parsed === "object" && "status" in parsed) {
      return parsed as ScanStatusEvent;
    }
  } catch {
    // Fall through to a harmless status pulse.
  }
  return { type: "status", status: "RUNNING" };
}

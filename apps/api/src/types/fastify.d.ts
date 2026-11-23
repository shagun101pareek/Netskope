import type { ReplayJobData, ScanJobData } from "@netskope/shared";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
    scanQueue: Queue<ScanJobData>;
    replayQueue: Queue<ReplayJobData>;
  }

  interface FastifyRequest {
    authUser: { id: string; email: string } | null;
  }
}

export {};

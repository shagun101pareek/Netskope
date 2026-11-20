import type { ScanJobData } from "@netskope/shared";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
    scanQueue: Queue<ScanJobData>;
  }

  interface FastifyRequest {
    authUser: { id: string; email: string } | null;
  }
}

export {};

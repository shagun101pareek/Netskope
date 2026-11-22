import { createRequire } from "node:module";
import { SCAN_QUEUE_NAME, type ScanJobData } from "@netskope/shared";
import type { Queue } from "bullmq";

// Node's ESM loader does not see Queue on BullMQ's CommonJS re-export.
const { Queue: BullQueue } = createRequire(import.meta.url)("bullmq") as typeof import("bullmq");

export function createScanQueue(redisUrl: string): Queue<ScanJobData> {
  return new BullQueue<ScanJobData>(SCAN_QUEUE_NAME, {
    connection: {
      url: redisUrl,
      maxRetriesPerRequest: null,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    },
  });
}

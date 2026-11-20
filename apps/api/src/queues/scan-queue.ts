import { SCAN_QUEUE_NAME, type ScanJobData } from "@netskope/shared";
import { Queue } from "bullmq";

export function createScanQueue(redisUrl: string): Queue<ScanJobData> {
  return new Queue<ScanJobData>(SCAN_QUEUE_NAME, {
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

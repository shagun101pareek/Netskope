import { createRequire } from "node:module";
import { REPLAY_QUEUE_NAME, type ReplayJobData } from "@netskope/shared";
import type { Worker } from "bullmq";
import type { Logger } from "pino";
import { executeReplay } from "../replay/execute-replay.js";

const { Worker: BullWorker } = createRequire(import.meta.url)("bullmq") as typeof import("bullmq");

/** Runs confirmed replays in the worker process so a slow request cannot block the API. */
export function startReplayWorker(redisUrl: string, logger: Logger): Worker<ReplayJobData> {
  const worker = new BullWorker<ReplayJobData>(
    REPLAY_QUEUE_NAME,
    async (job) => {
      if (!job.data.replayId) {
        throw new Error("Replay job is missing replayId");
      }
      await executeReplay(job.data.replayId);
    },
    {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      concurrency: 2,
    },
  );

  worker.on("error", (error: Error) => {
    logger.error({ err: error }, "replay queue error");
  });
  worker.on("failed", (job, error) => {
    logger.error({ err: error, replayId: job?.data.replayId }, "replay job failed");
  });
  return worker;
}

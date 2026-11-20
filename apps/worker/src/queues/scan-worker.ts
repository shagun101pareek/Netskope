import { SCAN_QUEUE_NAME, type ScanJobData } from "@netskope/shared";
import { Worker, type Job } from "bullmq";
import type { Logger } from "pino";
import { acknowledgeScan, failScan } from "../processors/acknowledge-scan.js";

const FINAL_FAILURE_MESSAGE = "The scan worker could not accept the job.";

export function startScanWorker(redisUrl: string, logger: Logger): Worker<ScanJobData> {
  const worker = new Worker<ScanJobData>(
    SCAN_QUEUE_NAME,
    async (job: Job<ScanJobData>) => {
      if (!job.data.scanId) {
        throw new Error("Scan job is missing scanId");
      }

      await acknowledgeScan(job.data.scanId);
      logger.info({ scanId: job.data.scanId }, "scan accepted; browser capture is not implemented yet");
    },
    {
      connection: {
        url: redisUrl,
        maxRetriesPerRequest: null,
      },
      concurrency: 2,
    },
  );

  worker.on("error", (error: Error) => {
    logger.error({ err: error }, "scan queue error");
  });

  worker.on("failed", (job, error) => {
    if (!job?.data.scanId) {
      logger.error({ err: error }, "scan job failed without a scan id");
      return;
    }

    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      logger.warn(
        { err: error, scanId: job.data.scanId, attemptsMade: job.attemptsMade },
        "scan job will retry",
      );
      return;
    }

    logger.error({ err: error, scanId: job.data.scanId }, "scan job exhausted retries");
    void failScan(job.data.scanId, FINAL_FAILURE_MESSAGE).catch((updateError: unknown) => {
      logger.error({ err: updateError, scanId: job.data.scanId }, "failed to record the scan failure");
    });
  });

  return worker;
}

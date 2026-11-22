import { createRequire } from "node:module";
import { SCAN_QUEUE_NAME, scanEventChannel, type ScanJobData, type ScanStatusEvent } from "@netskope/shared";
import { UrlPolicyError } from "@netskope/shared/url-policy";
import type { Job, Worker } from "bullmq";

// Node's ESM loader does not see these names on BullMQ's CommonJS re-export.
const { UnrecoverableError, Worker: BullWorker } = createRequire(import.meta.url)("bullmq") as typeof import("bullmq");
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { captureScan } from "../browser/capture.js";
import { PermanentScanError } from "../browser/errors.js";
import { acknowledgeScan, failScan } from "../processors/acknowledge-scan.js";

const FALLBACK_FAILURE_MESSAGE = "The scan could not be completed.";

export function startScanWorker(redisUrl: string, logger: Logger, events?: Redis): Worker<ScanJobData> {
  const publish = async (scanId: string, event: ScanStatusEvent): Promise<void> => {
    if (!events) {
      return;
    }
    try {
      await events.publish(scanEventChannel(scanId), JSON.stringify(event));
    } catch (error) {
      logger.warn({ err: error, scanId }, "scan status publish failed");
    }
  };

  const worker = new BullWorker<ScanJobData>(
    SCAN_QUEUE_NAME,
    async (job: Job<ScanJobData>) => {
      if (!job.data.scanId) {
        throw new Error("Scan job is missing scanId");
      }

      await acknowledgeScan(job.data.scanId);
      await publish(job.data.scanId, { type: "status", status: "RUNNING" });
      try {
        const requestCount = await captureScan(job.data.scanId, logger);
        await publish(job.data.scanId, { type: "status", status: "COMPLETED", requestCount });
      } catch (error) {
        if (error instanceof PermanentScanError || error instanceof UrlPolicyError) {
          throw new UnrecoverableError(error.message);
        }
        throw error;
      }
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
    if (!job?.data.scanId || !error) {
      logger.error({ err: error }, "scan job failed without a scan id");
      return;
    }

    const attempts = job.opts.attempts ?? 1;
    if (!isFinalScanFailure(error, job.attemptsMade, attempts)) {
      logger.warn(
        { err: error, scanId: job.data.scanId, attemptsMade: job.attemptsMade },
        "scan job will retry",
      );
      return;
    }

    const message = scanFailureMessage(error);
    logger.error({ err: error, scanId: job.data.scanId }, "scan job failed");
    void failScan(job.data.scanId, message)
      .then(() => publish(job.data.scanId, { type: "status", status: "FAILED", errorMessage: message }))
      .catch((updateError: unknown) => {
        logger.error({ err: updateError, scanId: job.data.scanId }, "failed to record the scan failure");
      });
  });

  return worker;
}

export function isFinalScanFailure(error: Error, attemptsMade: number, attempts: number): boolean {
  return error.name === "UnrecoverableError" || attemptsMade >= attempts;
}

export function scanFailureMessage(error: Error): string {
  const line = error.message.split("\n")[0]?.trim() ?? "";
  if (line.length === 0 || line.length > 300) {
    return FALLBACK_FAILURE_MESSAGE;
  }
  return line;
}

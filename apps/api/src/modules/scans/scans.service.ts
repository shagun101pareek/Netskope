import { ScanStatus, prisma } from "@netskope/database";
import type { Queue } from "bullmq";
import type { ScanJobData } from "@netskope/shared";
import { AppError, isUniqueViolation } from "../../lib/errors.js";
import { assertSafeScanUrl, UrlPolicyError } from "../../lib/url-policy.js";
import { presentScan, type ScanResponse } from "./scan-presenter.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function createScan(
  userId: string,
  rawUrl: string,
  queue: Queue<ScanJobData>,
): Promise<ScanResponse> {
  let url: string;
  try {
    url = await assertSafeScanUrl(rawUrl);
  } catch (error) {
    if (error instanceof UrlPolicyError) {
      throw new AppError(400, "VALIDATION_ERROR", error.message);
    }
    throw error;
  }

  const active = await prisma.scan.findFirst({
    where: { userId, url, status: { in: [ScanStatus.PENDING, ScanStatus.RUNNING] } },
    select: { id: true },
  });

  if (active) {
    throw new AppError(409, "CONFLICT", "A scan of this URL is already in progress.");
  }

  let scan: ScanResponse;
  try {
    const created = await prisma.scan.create({
      data: { userId, url, status: ScanStatus.PENDING },
    });
    scan = presentScan(created);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, "CONFLICT", "A scan of this URL is already in progress.");
    }
    throw error;
  }

  try {
    await queue.add("scan", { scanId: scan.id }, { jobId: scan.id });
  } catch (error) {
    await prisma.scan.update({
      where: { id: scan.id },
      data: {
        status: ScanStatus.FAILED,
        completedAt: new Date(),
        errorMessage: "The scan could not be queued.",
      },
    });
    throw new AppError(503, "QUEUE_UNAVAILABLE", "The scan could not be queued.", { cause: error });
  }

  return scan;
}

export async function listScans(
  userId: string,
  rawLimit: unknown,
  cursor: string | undefined,
): Promise<{ scans: ScanResponse[]; nextCursor: string | null }> {
  const limit = parseLimit(rawLimit);

  if (cursor) {
    const cursorScan = await prisma.scan.findFirst({
      where: { id: cursor, userId },
      select: { id: true },
    });
    if (!cursorScan) {
      throw new AppError(400, "VALIDATION_ERROR", "The page cursor is not valid.");
    }
  }

  const rows = await prisma.scan.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const page = rows.slice(0, limit);
  const next = rows.length > limit ? page.at(-1) : undefined;

  return {
    scans: page.map(presentScan),
    nextCursor: next?.id ?? null,
  };
}

export async function getScan(userId: string, scanId: string): Promise<ScanResponse> {
  const scan = await prisma.scan.findFirst({
    where: { id: scanId, userId },
  });

  if (!scan) {
    throw new AppError(404, "NOT_FOUND", "Scan not found.");
  }

  return presentScan(scan);
}

function parseLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
    throw new AppError(400, "VALIDATION_ERROR", "limit must be an integer from 1 to 100.");
  }

  return parsed;
}

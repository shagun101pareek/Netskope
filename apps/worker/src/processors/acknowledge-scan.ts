import { ScanStatus, prisma } from "@netskope/database";

/**
 * Marks a queued scan as accepted by this worker.
 * Capture runs after this returns. A second delivery of a scan that is
 * already RUNNING, COMPLETED, or FAILED does not change it again.
 */
export async function acknowledgeScan(scanId: string): Promise<void> {
  const accepted = await prisma.scan.updateMany({
    where: { id: scanId, status: ScanStatus.PENDING },
    data: { status: ScanStatus.RUNNING, startedAt: new Date() },
  });

  if (accepted.count === 1) {
    return;
  }

  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    select: { status: true },
  });

  if (!scan) {
    throw new Error(`Scan ${scanId} does not exist`);
  }

  if (scan.status === ScanStatus.PENDING) {
    throw new Error(`Scan ${scanId} could not be marked running`);
  }
}

export async function failScan(scanId: string, errorMessage: string): Promise<void> {
  await prisma.scan.updateMany({
    where: { id: scanId, status: { in: [ScanStatus.PENDING, ScanStatus.RUNNING] } },
    data: {
      status: ScanStatus.FAILED,
      completedAt: new Date(),
      errorMessage,
    },
  });
}

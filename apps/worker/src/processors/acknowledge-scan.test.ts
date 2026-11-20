import "@netskope/shared/load-env";
import { prisma } from "@netskope/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { acknowledgeScan } from "./acknowledge-scan.js";

describe("acknowledgeScan", () => {
  const email = `day2-worker-${randomUUID()}@example.com`;
  let userId = "";
  let scanId = "";

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("moves a pending scan to running and ignores a second delivery", async () => {
    const user = await prisma.user.create({
      data: { email, passwordHash: "not-used" },
    });
    userId = user.id;
    const scan = await prisma.scan.create({
      data: { userId, url: `https://example.com/${randomUUID()}`, status: "PENDING" },
    });
    scanId = scan.id;

    await acknowledgeScan(scanId);
    await acknowledgeScan(scanId);

    const stored = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(stored.status).toBe("RUNNING");
    expect(stored.startedAt).toBeInstanceOf(Date);
    expect(stored.completedAt).toBeNull();
  });

  it("fails the job when the scan does not exist", async () => {
    await expect(acknowledgeScan(randomUUID())).rejects.toThrow(/does not exist/);
  });
});

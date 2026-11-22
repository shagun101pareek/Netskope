import "@netskope/shared/load-env";
import { prisma } from "@netskope/database";
import { randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { captureScan } from "./capture.js";
import { PermanentScanError } from "./errors.js";
import { closeBrowser } from "./session.js";

const logger = pino({ level: "silent" });

describe("captureScan", () => {
  const email = `day3-worker-${randomUUID()}@example.com`;
  let userId = "";

  afterAll(async () => {
    await closeBrowser();
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });

  it("refuses a private URL before navigation", async () => {
    const user = await prisma.user.create({
      data: { email, passwordHash: "not-used" },
    });
    userId = user.id;
    const scan = await prisma.scan.create({
      data: {
        userId,
        url: "http://127.0.0.1/",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    await expect(captureScan(scan.id, logger)).rejects.toBeInstanceOf(PermanentScanError);
    const stored = await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(stored.status).toBe("RUNNING");
  });

  it("loads a public page and stores the observed requests", async () => {
    const userIdForScan = userId || (await createUser());
    const scan = await prisma.scan.create({
      data: {
        userId: userIdForScan,
        url: "https://example.com/",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    await captureScan(scan.id, logger);

    const stored = await prisma.scan.findUniqueOrThrow({
      where: { id: scan.id },
      include: { requests: { include: { response: true, timing: true } } },
    });

    expect(stored.status).toBe("COMPLETED");
    expect(stored.completedAt).toBeInstanceOf(Date);
    expect(stored.errorMessage).toBeNull();
    expect(stored.requests.length).toBeGreaterThan(0);

    const document = stored.requests.find((request) => request.resourceType?.toLowerCase() === "document");
    expect(document?.method).toBe("GET");
    expect(document?.requestClass).toBe("DOCUMENT");
    expect(document?.url).toContain("example.com");
    expect(document?.requestId.startsWith("pw-")).toBe(false);
    expect(document?.requestId.length).toBeGreaterThan(0);
    expect(new Set(stored.requests.map((request) => request.requestId)).size).toBe(stored.requests.length);
    expect(document?.response?.statusCode).toBe(200);
    expect(document?.response?.responsePayloadReference).toBeNull();
    expect(document?.response?.bodySize).toBeGreaterThan(0);
    expect(document?.timing?.totalDuration).toBeGreaterThan(0);
    expectPhases(document?.timing ?? null);

    for (const request of stored.requests) {
      const requestHeaders = headerMap(request.requestHeaders);
      const responseHeaders = headerMap(request.response?.responseHeaders);
      if (requestHeaders.cookie) {
        expect(requestHeaders.cookie).toBe("[redacted]");
      }
      if (responseHeaders["set-cookie"]) {
        expect(responseHeaders["set-cookie"]).toBe("[redacted]");
      }
      expectPhases(request.timing);
    }
  }, 90_000);

  it("stores a redirect hop on the same protocol request id", async () => {
    const userIdForScan = userId || (await createUser());
    const scan = await prisma.scan.create({
      data: {
        userId: userIdForScan,
        url: "https://httpbin.org/redirect/1",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    await captureScan(scan.id, logger);

    const stored = await prisma.scan.findUniqueOrThrow({
      where: { id: scan.id },
      include: { requests: { include: { response: true, timing: true } } },
    });
    const document = stored.requests.find((request) => request.resourceType?.toLowerCase() === "document");
    const chain = Array.isArray(document?.redirectChain) ? document.redirectChain : [];
    const redirect = chain.find((hop) => isRedirectHop(hop) && hop.url.includes("/redirect/1"));
    const statusCode = redirect && isRedirectHop(redirect) ? redirect.statusCode : null;

    expect(stored.status).toBe("COMPLETED");
    expect(document?.url).toContain("httpbin.org/get");
    expect(statusCode).toBe(302);
    expect(document?.response?.statusCode).toBe(200);
    expect(document?.response?.bodySize).toBeGreaterThan(0);
    expect(document?.timing?.totalDuration).toBeGreaterThan(0);
    expectPhases(document?.timing ?? null);
  }, 90_000);

  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email, passwordHash: "not-used" },
    });
    userId = user.id;
    return user.id;
  }
});

function expectPhases(
  timing: {
    dnsTime: number | null;
    connectTime: number | null;
    tlsTime: number | null;
    ttfb: number | null;
    downloadTime: number | null;
    totalDuration: number | null;
  } | null,
): void {
  if (!timing) {
    return;
  }
  for (const value of [
    timing.dnsTime,
    timing.connectTime,
    timing.tlsTime,
    timing.ttfb,
    timing.downloadTime,
    timing.totalDuration,
  ]) {
    if (value !== null) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  }
}

function isRedirectHop(value: unknown): value is { url: string; statusCode: number | null } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "url" in value &&
      typeof value.url === "string" &&
      "statusCode" in value &&
      (typeof value.statusCode === "number" || value.statusCode === null),
  );
}

function headerMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(value)) {
    if (typeof header === "string") {
      headers[key] = header;
    }
  }
  return headers;
}

import "@netskope/shared/load-env";
import { prisma } from "@netskope/database";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

const PASSWORD = "correct-horse-battery";

describe("scan results", () => {
  let app: FastifyInstance;
  const email = `day6-${randomUUID()}@example.com`;
  let token = "";
  let userId = "";
  let scanId = "";
  let otherScanId = "";
  let documentId = "";

  beforeAll(async () => {
    app = await buildApp();
    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email, password: PASSWORD },
    });
    expect(registered.statusCode).toBe(201);
    const session = registered.json() as { accessToken: string; user: { id: string } };
    token = session.accessToken;
    userId = session.user.id;

    const scan = await prisma.scan.create({
      data: { userId, url: "https://example.com/", status: "COMPLETED", startedAt: new Date(), completedAt: new Date() },
    });
    scanId = scan.id;
    const other = await prisma.scan.create({
      data: { userId, url: "https://example.com/other", status: "COMPLETED", startedAt: new Date(), completedAt: new Date() },
    });
    otherScanId = other.id;

    const document = await prisma.networkRequest.create({
      data: {
        scanId,
        requestId: "doc-1",
        url: "https://example.com/",
        method: "GET",
        resourceType: "Document",
        requestClass: "DOCUMENT",
        timestamp: new Date("2026-11-22T00:00:00.000Z"),
        requestHeaders: { accept: "text/html" },
        response: { create: { statusCode: 200, mimeType: "text/html", bodySize: 20, responseHeaders: { "content-type": "text/html" } } },
        timing: { create: { dnsTime: 2, connectTime: 4, tlsTime: 8, ttfb: 10, downloadTime: 6, totalDuration: 40 } },
      },
    });
    documentId = document.id;
    await prisma.networkRequest.create({
      data: {
        scanId,
        requestId: "api-1",
        url: "https://example.com/api/items",
        method: "GET",
        resourceType: "Fetch",
        requestClass: "API",
        timestamp: new Date("2026-11-22T00:00:01.000Z"),
        response: { create: { statusCode: 500, mimeType: "application/json", bodySize: 4 } },
        timing: { create: { totalDuration: 800, ttfb: 700, downloadTime: 20 } },
      },
    });
    await prisma.networkRequest.create({
      data: {
        scanId,
        requestId: "api-2",
        url: "https://example.com/api/items",
        method: "GET",
        resourceType: "Fetch",
        requestClass: "API",
        timestamp: new Date("2026-11-22T00:00:02.000Z"),
        failureReason: "net::ERR_FAILED",
      },
    });
    await prisma.networkRequest.create({
      data: {
        scanId: otherScanId,
        requestId: "other-1",
        url: "https://example.com/only-right",
        method: "GET",
        resourceType: "Document",
        requestClass: "DOCUMENT",
        timestamp: new Date(),
        timing: { create: { totalDuration: 15 } },
      },
    });
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await app.close();
  });

  it("filters classified requests and hides another user's scan", async () => {
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/scans/${scanId}/requests?requestClass=DOCUMENT`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json() as { requests: { id: string; requestClass: string }[] };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]?.id).toBe(documentId);

    const stranger = await app.inject({
      method: "GET",
      url: `/api/v1/scans/${scanId}/requests`,
    });
    expect(stranger.statusCode).toBe(401);
  });

  it("returns detail, analytics, comparison, csv, and a completed event", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/scans/${scanId}/requests/${documentId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().request.timing.totalDuration).toBe(40);
    expect(detail.json().request.requestHeaders.accept).toBe("text/html");

    const analytics = await app.inject({
      method: "GET",
      url: `/api/v1/scans/${scanId}/analytics`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(analytics.statusCode).toBe(200);
    const report = analytics.json() as {
      requestCount: number;
      failedCount: number;
      averageLatencyMs: number;
      duplicateGroups: number;
      slow: { url: string }[];
    };
    expect(report.requestCount).toBe(3);
    expect(report.failedCount).toBe(2);
    expect(report.duplicateGroups).toBe(1);
    expect(report.slow[0]?.url).toBe("https://example.com/api/items");
    expect(report.averageLatencyMs).toBeGreaterThan(0);

    const compared = await app.inject({
      method: "GET",
      url: `/api/v1/scans/compare?left=${scanId}&right=${otherScanId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(compared.statusCode).toBe(200);
    expect(compared.json().onlyRight).toContain("GET https://example.com/only-right");

    const csv = await app.inject({
      method: "GET",
      url: `/api/v1/scans/${scanId}/export?format=csv`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("https://example.com/api/items");

    const events = await app.inject({
      method: "GET",
      url: `/api/v1/scans/${scanId}/events`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(events.statusCode).toBe(200);
    expect(events.body).toContain('"status":"COMPLETED"');
  });
});

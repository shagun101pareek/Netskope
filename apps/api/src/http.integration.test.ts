import "@netskope/shared/load-env";
import { prisma } from "@netskope/database";
import { WORKER_HEARTBEAT_KEY } from "@netskope/shared";
import { acknowledgeScan } from "@netskope/worker/acknowledge-scan";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const PASSWORD = "correct-horse-battery";

function cookieValue(setCookie: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    const pair = header.split(";")[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (pair.slice(0, separator) === name) {
      return pair.slice(separator + 1);
    }
  }
  throw new Error(`cookie ${name} was not set`);
}

describe("auth and scans", () => {
  let app: FastifyInstance;
  const email = `day2-${randomUUID()}@example.com`;
  const otherEmail = `day2-other-${randomUUID()}@example.com`;
  let userId = "";
  let scanId = "";

  beforeAll(async () => {
    app = await buildApp();
    await app.redis.del("netskope:rate:register:127.0.0.1", "netskope:rate:login:127.0.0.1");
    await app.redis.set(
      WORKER_HEARTBEAT_KEY,
      JSON.stringify({
        service: "worker",
        status: "ok",
        pid: process.pid,
        updatedAt: new Date().toISOString(),
      }),
      "EX",
      60,
    );
  });

  afterAll(async () => {
    if (scanId) {
      const job = await app.scanQueue.getJob(scanId);
      await job?.remove().catch(() => undefined);
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    }
    await app.close();
  });

  it("registers, rejects a bad login, and creates an authorized scan", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      remoteAddress: "127.0.0.1",
      payload: { email, password: PASSWORD },
    });
    expect(registered.statusCode).toBe(201);
    const created = registered.json<{ user: { id: string }; accessToken: string }>();
    userId = created.user.id;
    const refreshCookie = cookieValue(registered.headers["set-cookie"], "netskope_refresh");

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: "127.0.0.1",
      payload: { email, password: "not-the-password" },
    });
    expect(wrongPassword.statusCode).toBe(401);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      remoteAddress: "127.0.0.1",
      payload: { email, password: PASSWORD },
    });
    expect(duplicate.statusCode).toBe(409);

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      payload: { url: "https://1.1.1.1/status" },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const blocked = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { authorization: `Bearer ${created.accessToken}` },
      payload: { url: "http://127.0.0.1/admin" },
    });
    expect(blocked.statusCode).toBe(400);

    const createdScan = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { authorization: `Bearer ${created.accessToken}` },
      payload: { url: "https://1.1.1.1/status" },
    });
    expect(createdScan.statusCode).toBe(201);
    const scan = createdScan.json<{ scan: { id: string; status: string; url: string } }>().scan;
    scanId = scan.id;
    expect(scan.status).toBe("PENDING");
    expect(scan.url).toBe("https://1.1.1.1/status");

    const job = await app.scanQueue.getJob(scan.id);
    expect(job?.data.scanId).toBe(scan.id);

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { authorization: `Bearer ${created.accessToken}` },
      payload: { url: "https://1.1.1.1/status" },
    });
    expect(conflict.statusCode).toBe(409);

    await acknowledgeScan(scan.id);
    const fetched = await app.inject({
      method: "GET",
      url: `/api/v1/scans/${scan.id}`,
      headers: { authorization: `Bearer ${created.accessToken}` },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<{ scan: { status: string; startedAt: string | null } }>().scan).toMatchObject({
      status: "RUNNING",
    });
    expect(fetched.json<{ scan: { startedAt: string | null } }>().scan.startedAt).toEqual(expect.any(String));

    const other = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      remoteAddress: "127.0.0.1",
      payload: { email: otherEmail, password: PASSWORD },
    });
    expect(other.statusCode).toBe(201);
    const otherToken = other.json<{ accessToken: string }>().accessToken;
    const hidden = await app.inject({
      method: "GET",
      url: `/api/v1/scans/${scan.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(hidden.statusCode).toBe(404);

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/scans",
      headers: { authorization: `Bearer ${created.accessToken}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ scans: Array<{ id: string }> }>().scans.map((item) => item.id)).toContain(scan.id);

    const refreshed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: `netskope_refresh=${refreshCookie}` },
    });
    expect(refreshed.statusCode).toBe(200);
    const rotated = cookieValue(refreshed.headers["set-cookie"], "netskope_refresh");
    expect(rotated).not.toBe(refreshCookie);

    const loggedOut = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: `netskope_refresh=${rotated}` },
    });
    expect(loggedOut.statusCode).toBe(204);

    const reused = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: `netskope_refresh=${refreshCookie}` },
    });
    expect(reused.statusCode).toBe(401);

    await app.redis.del(WORKER_HEARTBEAT_KEY);
    const loggedIn = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: "127.0.0.1",
      payload: { email, password: PASSWORD },
    });
    expect(loggedIn.statusCode).toBe(200);
    const unavailable = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      headers: { authorization: `Bearer ${loggedIn.json<{ accessToken: string }>().accessToken}` },
      payload: { url: "https://1.0.0.1/" },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json<{ error: { code: string } }>().error.code).toBe("WORKER_UNAVAILABLE");
  });
});

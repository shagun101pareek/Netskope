import { isHealthReport, isWorkerHeartbeat } from "@netskope/shared";
import { describe, expect, it } from "vitest";
import { summarizeHealth } from "./health.js";

describe("summarizeHealth", () => {
  it("reports ok when postgres and redis are up, even if the worker is down", () => {
    expect(
      summarizeHealth({ postgres: "up", redis: "up", worker: "down" }),
    ).toEqual({
      status: "ok",
      checks: { postgres: "up", redis: "up", worker: "down" },
    });
  });

  it("reports degraded when postgres is down", () => {
    expect(
      summarizeHealth({ postgres: "down", redis: "up", worker: "up" }).status,
    ).toBe("degraded");
  });

  it("reports degraded when redis is down", () => {
    expect(
      summarizeHealth({ postgres: "up", redis: "down", worker: "down" }).status,
    ).toBe("degraded");
  });
});

describe("health payload guards", () => {
  it("accepts a worker heartbeat", () => {
    expect(
      isWorkerHeartbeat({
        service: "worker",
        status: "ok",
        pid: 42,
        updatedAt: "2026-11-19T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects a heartbeat that did not come from the worker", () => {
    expect(isWorkerHeartbeat({ status: "ok", pid: 42, updatedAt: "now" })).toBe(false);
  });

  it("accepts a complete health report", () => {
    expect(
      isHealthReport({
        status: "ok",
        service: "api",
        checks: { postgres: "up", redis: "up", worker: "down" },
        timestamp: "2026-11-19T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});

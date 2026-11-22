import { describe, expect, it } from "vitest";
import { calculatePhaseTiming } from "./timing.js";

describe("calculatePhaseTiming", () => {
  it("splits a full timing block into non-overlapping phases", () => {
    const timing = calculatePhaseTiming({
      timing: {
        requestTime: 100,
        dnsStart: 1,
        dnsEnd: 6,
        connectStart: 6,
        sslStart: 10,
        sslEnd: 25,
        connectEnd: 25,
        sendStart: 26,
        sendEnd: 28,
        receiveHeadersEnd: 48,
      },
      startedAt: 100,
      finishedAt: 100.08,
    });

    expect(timing).toMatchObject({
      dnsTime: 5,
      connectTime: 4,
      tlsTime: 15,
      ttfb: 20,
      downloadTime: 32,
      totalDuration: 80,
    });
  });

  it("leaves phases null when Chrome reports them as unavailable", () => {
    const timing = calculatePhaseTiming({
      timing: {
        requestTime: 50,
        dnsStart: -1,
        dnsEnd: -1,
        connectStart: -1,
        connectEnd: -1,
        sslStart: -1,
        sslEnd: -1,
        sendEnd: 2,
        receiveHeadersEnd: 12,
      },
      startedAt: 50,
      finishedAt: 50.02,
    });

    expect(timing).toMatchObject({
      dnsTime: null,
      connectTime: null,
      tlsTime: null,
      ttfb: 10,
      downloadTime: 8,
      totalDuration: 20,
    });
    expect(timing?.timingMetadata).not.toHaveProperty("dnsStart");
  });

  it("keeps a measured zero and rejects a negative interval", () => {
    const timing = calculatePhaseTiming({
      timing: {
        requestTime: 10,
        dnsStart: 4,
        dnsEnd: 4,
        connectStart: 8,
        connectEnd: 3,
        sendEnd: 5,
        receiveHeadersEnd: 4,
      },
      startedAt: 10,
      finishedAt: 9,
    });

    expect(timing).toMatchObject({
      dnsTime: 0,
      connectTime: null,
      tlsTime: null,
      ttfb: null,
      downloadTime: null,
      totalDuration: null,
    });
  });

  it("uses the event timestamps when the timing block is missing", () => {
    const timing = calculatePhaseTiming({
      timing: null,
      startedAt: 10,
      finishedAt: 10.05,
    });

    expect(timing).toEqual({
      dnsTime: null,
      connectTime: null,
      tlsTime: null,
      ttfb: null,
      downloadTime: null,
      totalDuration: 50,
    });
  });

  it("counts the whole connection when the response is not TLS", () => {
    const timing = calculatePhaseTiming({
      timing: {
        requestTime: 1,
        connectStart: 2,
        connectEnd: 9,
        sslStart: -1,
        sslEnd: -1,
      },
      startedAt: 1,
      finishedAt: null,
    });

    expect(timing?.connectTime).toBe(7);
    expect(timing?.tlsTime).toBeNull();
  });

  it("returns nothing when no phase can be measured", () => {
    expect(calculatePhaseTiming({ timing: { dnsStart: -1, dnsEnd: -1 }, startedAt: null, finishedAt: null })).toBeNull();
  });
});

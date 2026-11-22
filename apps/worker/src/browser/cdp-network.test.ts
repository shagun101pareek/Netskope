import { describe, expect, it } from "vitest";
import { createNetworkCollector } from "./cdp-network.js";

const now = (): Date => new Date("2026-11-22T00:00:00.000Z");

describe("CDP network correlation", () => {
  it("keeps concurrent requests matched to their own responses", () => {
    const collector = createNetworkCollector({ now });
    collector.requestWillBeSent(request("10.1", "https://example.com/", 1_700_000_000));
    collector.requestWillBeSent(request("10.2", "https://example.com/app.js", 1_700_000_001, "Script"));
    collector.responseReceived(response("10.2", 200, "text/javascript"));
    collector.loadingFinished({ requestId: "10.2", encodedDataLength: 40 });
    collector.responseReceived(response("10.1", 200, "text/html"));
    collector.loadingFinished({ requestId: "10.1", encodedDataLength: 1256 });

    const records = collector.records();
    expect(records.map((record) => record.requestId)).toEqual(["10.1", "10.2"]);
    expect(records[0]?.response).toMatchObject({ statusCode: 200, mimeType: "text/html", bodySize: 1256 });
    expect(records[1]?.response).toMatchObject({ statusCode: 200, mimeType: "text/javascript", bodySize: 40 });
    expect(records[0]?.timestamp.toISOString()).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("folds redirect hops that reuse one request id", () => {
    const collector = createNetworkCollector({ now });
    collector.requestWillBeSent(request("5.1", "http://example.com/", 1_700_000_000));
    collector.responseReceived(response("5.1", 302, "text/html"));
    collector.requestWillBeSent({
      ...request("5.1", "https://example.com/", 1_700_000_001),
      redirectResponse: { url: "http://example.com/", status: 302 },
    });
    collector.responseReceived(response("5.1", 301, "text/html"));
    collector.requestWillBeSent({
      ...request("5.1", "https://example.com/home", 1_700_000_002),
      redirectResponse: { url: "https://example.com/", status: 301 },
    });
    collector.responseReceived(response("5.1", 200, "text/html"));
    collector.loadingFinished({ requestId: "5.1", encodedDataLength: 90 });

    const [record] = collector.records();
    expect(record?.url).toBe("https://example.com/home");
    expect(record?.redirectChain).toEqual([
      { url: "http://example.com/", statusCode: 302 },
      { url: "https://example.com/", statusCode: 301 },
    ]);
    expect(record?.response?.statusCode).toBe(200);
    expect(record?.response?.bodySize).toBe(90);
  });

  it("keeps a response that Chrome served from its disk cache", () => {
    const collector = createNetworkCollector({ now });
    collector.requestWillBeSent(request("7.1", "https://example.com/app.js", 1_700_000_000, "Script"));
    collector.responseReceived({
      ...response("7.1", 200, "text/javascript"),
      response: {
        url: "https://example.com/app.js",
        status: 200,
        mimeType: "text/javascript",
        fromDiskCache: true,
        headers: { "Content-Type": "text/javascript" },
      },
    });
    collector.loadingFinished({ requestId: "7.1", encodedDataLength: 0 });

    const [record] = collector.records();
    expect(record?.response).toMatchObject({ statusCode: 200, mimeType: "text/javascript", bodySize: 0 });
  });

  it("records a failed request without inventing a response", () => {
    const collector = createNetworkCollector({ now });
    collector.requestWillBeSent(request("8.1", "https://example.com/missing", 1_700_000_000));
    collector.loadingFailed({
      requestId: "8.1",
      errorText: "net::ERR_NAME_NOT_RESOLVED",
      type: "Document",
    });

    const [record] = collector.records();
    expect(record?.response).toBeUndefined();
    expect(record?.failureReason).toBe("net::ERR_NAME_NOT_RESOLVED");
    expect(record?.resourceType).toBe("Document");
  });

  it("describes a policy abort as a blocked request", () => {
    const collector = createNetworkCollector({ now });
    collector.requestWillBeSent(request("8.2", "http://127.0.0.1/", 1_700_000_000));
    collector.loadingFailed({ requestId: "8.2", errorText: "net::ERR_BLOCKED_BY_CLIENT", canceled: true });

    expect(collector.records()[0]?.failureReason).toBe("Blocked by scan policy");
  });

  it("redacts headers that arrive before the request event", () => {
    const collector = createNetworkCollector({ now });
    collector.requestWillBeSentExtraInfo({
      requestId: "3.1",
      headers: { Cookie: "session=secret", "User-Agent": "NetskopeTest" },
    });
    collector.requestWillBeSent(request("3.1", "https://example.com/", 1_700_000_000));
    collector.responseReceived(response("3.1", 200, "text/html"));
    collector.responseReceivedExtraInfo({
      requestId: "3.1",
      headers: { "Set-Cookie": "id=secret" },
    });
    collector.loadingFinished({ requestId: "3.1", encodedDataLength: 10 });

    const [record] = collector.records();
    expect(record?.requestHeaders.cookie).toBe("[redacted]");
    expect(record?.requestHeaders["user-agent"]).toBe("NetskopeTest");
    expect(record?.response?.responseHeaders["set-cookie"]).toBe("[redacted]");
  });

  it("keeps a 304 response and ignores non-network URLs", () => {
    const collector = createNetworkCollector({ now });
    collector.requestWillBeSent(request("1.1", "data:text/plain,hello", 1_700_000_000));
    collector.requestWillBeSent(request("1.2", "https://example.com/app.js", 1_700_000_000, "Script"));
    collector.responseReceived(response("1.2", 304, "text/javascript"));
    collector.loadingFinished({ requestId: "1.2", encodedDataLength: 0 });

    const records = collector.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.response?.statusCode).toBe(304);
    expect(records[0]?.response?.bodySize).toBe(0);
    expect(records[0]?.redirectChain).toBeUndefined();
  });

  it("does not store a body size that the browser did not report", () => {
    const collector = createNetworkCollector({ now });
    collector.requestWillBeSent(request("4.1", "https://example.com/", 1_700_000_000));
    collector.responseReceived(response("4.1", 204, ""));
    collector.loadingFinished({ requestId: "4.1", encodedDataLength: -1 });

    expect(collector.records()[0]?.response?.bodySize).toBeNull();
  });

  it("marks a request that is still open when capture stops", () => {
    const collector = createNetworkCollector({ now });
    collector.requestWillBeSent({
      ...request("7.1", "https://example.com/slow", 1_700_000_000),
      request: {
        url: "https://example.com/slow",
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        postData: "ok",
      },
      initiator: { type: "script", url: "https://example.com/app.js" },
    });

    const [record] = collector.records();
    expect(record?.failureReason).toBe("The request did not finish before the scan ended.");
    expect(record?.requestPayload).toBe("ok");
    expect(record?.requestHeaders.authorization).toBe("[redacted]");
    expect(record?.initiator).toEqual({ type: "script", url: "https://example.com/app.js" });
    expect(record?.response).toBeUndefined();
  });

  it("drops requests past the scan cap without losing earlier ones", () => {
    const collector = createNetworkCollector({ maxRequests: 1, now });
    collector.requestWillBeSent(request("1.1", "https://example.com/a", 1_700_000_000));
    collector.requestWillBeSent(request("1.2", "https://example.com/b", 1_700_000_001));
    collector.responseReceived(response("1.1", 200, "text/html"));
    collector.loadingFinished({ requestId: "1.1", encodedDataLength: 5 });

    expect(collector.truncated()).toBe(true);
    expect(collector.records().map((record) => record.requestId)).toEqual(["1.1"]);
  });

  it("times the final response after a redirect, not the hop that was replaced", () => {
    const collector = createNetworkCollector({ now });
    collector.requestWillBeSent({ ...request("9.1", "https://httpbin.org/redirect/1", 1_700_000_000), timestamp: 100 });
    collector.responseReceived({
      ...response("9.1", 302, "text/html"),
      response: {
        url: "https://httpbin.org/redirect/1",
        status: 302,
        mimeType: "text/html",
        headers: {},
        timing: { requestTime: 100, dnsStart: 0, dnsEnd: 30, sendEnd: 31, receiveHeadersEnd: 40 },
      },
    });
    collector.requestWillBeSent({
      ...request("9.1", "https://httpbin.org/get", 1_700_000_001),
      timestamp: 100.04,
      redirectResponse: { url: "https://httpbin.org/redirect/1", status: 302 },
    });
    collector.responseReceived({
      ...response("9.1", 200, "application/json"),
      response: {
        url: "https://httpbin.org/get",
        status: 200,
        mimeType: "application/json",
        headers: {},
        timing: {
          requestTime: 100.04,
          dnsStart: -1,
          dnsEnd: -1,
          connectStart: -1,
          connectEnd: -1,
          sslStart: -1,
          sslEnd: -1,
          sendEnd: 1,
          receiveHeadersEnd: 5,
        },
      },
    });
    collector.loadingFinished({ requestId: "9.1", timestamp: 100.06, encodedDataLength: 20 });

    const [record] = collector.records();
    expect(record?.url).toBe("https://httpbin.org/get");
    expect(record?.timing).toMatchObject({
      dnsTime: null,
      ttfb: 4,
      downloadTime: 15,
      totalDuration: 20,
    });
  });
});

function request(requestId: string, url: string, wallTime: number, type = "Document"): Record<string, unknown> {
  return {
    requestId,
    wallTime,
    type,
    request: { url, method: "GET", headers: { Accept: "text/html" } },
  };
}

function response(requestId: string, status: number, mimeType: string): Record<string, unknown> {
  return {
    requestId,
    type: "Document",
    response: {
      url: "https://example.com/",
      status,
      mimeType,
      headers: { "Content-Type": mimeType },
    },
  };
}

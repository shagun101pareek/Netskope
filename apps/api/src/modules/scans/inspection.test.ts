import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  compareEndpoints,
  generateObservedTests,
  identifyEndpoint,
  inferSchema,
  prepareReplayRequest,
  redactJsonValue,
  redactPayload,
  responseBodyDecision,
} from "@netskope/shared/inspection";
import type { ObservedCall } from "@netskope/shared/inspection";

const call = (overrides: Partial<ObservedCall> = {}): ObservedCall => ({
  method: "GET",
  url: "https://example.com/api/users/123",
  requestClass: "API",
  resourceType: "Fetch",
  statusCode: 200,
  mimeType: "application/json",
  failureReason: null,
  totalDuration: 120,
  bodySize: 40,
  responseBody: JSON.stringify({ id: "123", name: "Ada" }),
  bodyOmittedReason: null,
  captureBodies: true,
  ...overrides,
});

describe("inspection", () => {
  it("redacts nested secrets and leaves ordinary fields", () => {
    const redacted = redactJsonValue({
      user: { name: "Ada", password: "hunter2", session: { refreshToken: "abc" }, profile: { accessToken: "abc", city: "Pune" } },
      tags: [{ apiKey: "secret" }],
    }) as {
      user: { name: string; password: string; session: string; profile: { accessToken: string; city: string } };
      tags: { apiKey: string }[];
    };

    expect(redacted.user.name).toBe("Ada");
    expect(redacted.user.password).toBe("[redacted]");
    expect(redacted.user.session).toBe("[redacted]");
    expect(redacted.user.profile.accessToken).toBe("[redacted]");
    expect(redacted.user.profile.city).toBe("Pune");
    expect(redacted.tags[0]?.apiKey).toBe("[redacted]");
  });

  it("stores multipart field names without the file contents", () => {
    const payload = '------\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\nbinary\r\n------\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello';
    const result = redactPayload(payload, "multipart/form-data; boundary=----", 8000);
    expect(result.text).toContain("file");
    expect(result.text).toContain("note");
    expect(result.text).not.toContain("binary");
  });

  it("refuses response bodies until capture is enabled, and never stores login paths", () => {
    expect(responseBodyDecision({ captureEnabled: false, url: "https://example.com/api/items", mimeType: "application/json" }).store).toBe(false);
    expect(responseBodyDecision({ captureEnabled: true, url: "https://example.com/login", mimeType: "application/json" }).store).toBe(false);
    expect(responseBodyDecision({ captureEnabled: true, url: "https://example.com/api/items", mimeType: "application/json" }).store).toBe(true);
    expect(responseBodyDecision({ captureEnabled: true, url: "https://example.com/photo.png", mimeType: "image/png" }).store).toBe(false);
  });

  it("groups numeric and uuid path segments without collapsing versions", () => {
    expect(identifyEndpoint("GET", "https://example.com/api/users/123").path).toBe("/api/users/{id}");
    expect(identifyEndpoint("GET", "https://example.com/api/users/456").key).toBe(
      identifyEndpoint("GET", "https://example.com/api/users/123").key,
    );
    expect(identifyEndpoint("GET", "https://example.com/api/v1/users").path).toBe("/api/v1/users");
    expect(identifyEndpoint("GET", "https://example.com/error/404").path).toBe("/error/404");
  });

  it("does not mark a field required from one sample", () => {
    const schema = inferSchema([{ id: 1, name: "Ada" }]);
    expect(schema.jsonSchema?.required).toBeUndefined();
    expect(schema.note).toContain("single observation");
  });

  it("fails a reliability test when a captured call returned 500", () => {
    const tests = generateObservedTests([
      call({ statusCode: 200, responseBody: JSON.stringify({ id: "1" }) }),
      call({ url: "https://example.com/api/users/456", statusCode: 500, responseBody: JSON.stringify({ id: "2" }) }),
    ]);
    const reliability = tests.find((test) => test.assertion.kind === "noServerError");
    expect(reliability?.status).toBe("failed");
    const status = tests.find((test) => test.assertion.kind === "statusEquals");
    expect(status?.status).toBe("failed");
  });

  it("reports a schema change between scans without including raw values", () => {
    const changes = compareEndpoints(
      [call({ responseBody: JSON.stringify({ id: "1", name: "Ada" }) })],
      [call({ responseBody: JSON.stringify({ id: "2", name: "Grace", lastLogin: "yesterday" }) })],
    );
    const changed = changes.find((change) => change.change === "changed");
    expect(changed?.notes.join(" ")).toContain("lastLogin");
    expect(JSON.stringify(changed)).not.toContain("yesterday");
  });

  it("links a request to its script initiator and leaves unrelated requests independent", () => {
    const graph = buildDependencyGraph([
      { id: "script", requestId: "1", method: "GET", url: "https://example.com/app.js", resourceType: "Script", statusCode: 200, totalDuration: 10, initiator: { type: "parser" } },
      { id: "api", requestId: "2", method: "GET", url: "https://example.com/api/users", resourceType: "Fetch", statusCode: 200, totalDuration: 20, initiator: { type: "script", stack: [{ url: "https://example.com/app.js", functionName: "fetchUsers", lineNumber: 4, columnNumber: 2 }] } },
      { id: "other", requestId: "3", method: "GET", url: "https://cdn.example/pixel", resourceType: "Image", statusCode: 200, totalDuration: 5, initiator: { type: "parser" } },
    ]);
    expect(graph.edges).toEqual([{ from: "script", to: "api", kind: "script" }]);
    expect(graph.nodes.find((node) => node.id === "other")?.independent).toBe(true);
  });

  it("drops captured credentials and requires confirmation for a replay", () => {
    const blocked = prepareReplayRequest({
      method: "POST",
      url: "https://example.com/api/items",
      headers: { authorization: "Bearer secret", accept: "application/json" },
      body: "{}",
      confirmed: true,
      confirmMutation: false,
      sendCredentials: false,
    });
    expect(blocked.ok).toBe(false);

    const prepared = prepareReplayRequest({
      method: "POST",
      url: "https://example.com/api/items",
      headers: { authorization: "Bearer secret", accept: "application/json", cookie: "session=1" },
      body: "{}",
      confirmed: true,
      confirmMutation: true,
      sendCredentials: false,
    });
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.headers.authorization).toBeUndefined();
      expect(prepared.headers.cookie).toBeUndefined();
      expect(prepared.headers.accept).toBe("application/json");
    }
  });
});

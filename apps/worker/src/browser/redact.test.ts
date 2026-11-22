import { describe, expect, it } from "vitest";
import { redactHeaders } from "./redact.js";

describe("redactHeaders", () => {
  it("replaces credential headers and keeps ordinary ones", () => {
    const redacted = redactHeaders({
      Cookie: "session=secret",
      Authorization: "Bearer secret",
      "Set-Cookie": "id=secret",
      "X-API-Key": "secret",
      "X-Auth-Token": "secret",
      "Content-Type": "application/json",
      Accept: "text/html",
    });

    expect(redacted.cookie).toBe("[redacted]");
    expect(redacted.authorization).toBe("[redacted]");
    expect(redacted["set-cookie"]).toBe("[redacted]");
    expect(redacted["x-api-key"]).toBe("[redacted]");
    expect(redacted["x-auth-token"]).toBe("[redacted]");
    expect(redacted["content-type"]).toBe("application/json");
    expect(redacted.accept).toBe("text/html");
  });

  it("caps a very long header value", () => {
    const redacted = redactHeaders({ "X-Trace": "a".repeat(600) });
    expect(redacted["x-trace"]?.length).toBe(512);
  });
});

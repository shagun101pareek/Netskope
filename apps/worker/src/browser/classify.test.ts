import { describe, expect, it } from "vitest";
import { classifyExchange } from "./classify.js";

describe("classifyExchange", () => {
  it("keeps the main document even when the body is JSON", () => {
    expect(
      classifyExchange({
        resourceType: "Document",
        mimeType: "application/json",
        url: "https://httpbin.org/get",
      }),
    ).toBe("DOCUMENT");
  });

  it("treats scripts and images as static", () => {
    expect(classifyExchange({ resourceType: "Script", mimeType: "text/javascript", url: "https://example.com/s.js" })).toBe(
      "STATIC",
    );
    expect(classifyExchange({ resourceType: "Image", mimeType: "image/png", url: "https://example.com/a.png" })).toBe(
      "STATIC",
    );
  });

  it("treats fetch, JSON, and API paths as API calls", () => {
    expect(classifyExchange({ resourceType: "Fetch", mimeType: "text/plain", url: "https://example.com/notes" })).toBe(
      "API",
    );
    expect(classifyExchange({ resourceType: "Other", mimeType: "application/json", url: "https://example.com/feed" })).toBe(
      "API",
    );
    expect(classifyExchange({ resourceType: null, mimeType: null, url: "https://example.com/api/users" })).toBe("API");
    expect(classifyExchange({ resourceType: null, mimeType: null, url: "https://example.com/v1/users" })).toBe("API");
  });

  it("leaves unrecognized requests as other", () => {
    expect(classifyExchange({ resourceType: "Other", mimeType: "text/plain", url: "https://example.com/robots.txt" })).toBe(
      "OTHER",
    );
  });
});

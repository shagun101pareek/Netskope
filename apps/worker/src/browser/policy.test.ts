import { describe, expect, it } from "vitest";
import { classifyRequest, createRequestClassifier } from "./policy.js";

describe("classifyRequest", () => {
  it("allows a public literal address without DNS", async () => {
    await expect(classifyRequest("https://1.1.1.1/status")).resolves.toBe("allow");
  });

  it("blocks private and metadata addresses", async () => {
    await expect(classifyRequest("http://127.0.0.1/")).resolves.toBe("block");
    await expect(classifyRequest("http://169.254.169.254/latest")).resolves.toBe("block");
    await expect(classifyRequest("http://10.1.2.3/")).resolves.toBe("block");
  });

  it("skips inline URLs and blocks other schemes", async () => {
    await expect(classifyRequest("data:text/plain,hello")).resolves.toBe("skip");
    await expect(classifyRequest("blob:https://example.com/uuid")).resolves.toBe("skip");
    await expect(classifyRequest("file:///etc/passwd")).resolves.toBe("block");
    await expect(classifyRequest("not a url")).resolves.toBe("block");
  });

  it("reuses a host decision inside one scan", async () => {
    const classify = createRequestClassifier();
    await expect(classify("https://1.1.1.1/a")).resolves.toBe("allow");
    await expect(classify("https://1.1.1.1/b")).resolves.toBe("allow");
    await expect(classify("http://127.0.0.1/a")).resolves.toBe("block");
    await expect(classify("http://127.0.0.1/b")).resolves.toBe("block");
  });
});

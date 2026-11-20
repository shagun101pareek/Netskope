import { describe, expect, it } from "vitest";
import { assertSafeScanUrl, isBlockedAddress } from "./url-policy.js";

const publicResolver = async () => ["93.184.216.34"];

describe("assertSafeScanUrl", () => {
  it("normalizes a public https URL and drops the fragment", async () => {
    await expect(
      assertSafeScanUrl("HTTPS://Example.COM/path#token", publicResolver),
    ).resolves.toBe("https://example.com/path");
  });

  it("allows a literal public address without resolving it", async () => {
    const resolveHosts = () => {
      throw new Error("should not resolve a literal address");
    };

    await expect(assertSafeScanUrl("https://1.1.1.1/health", resolveHosts)).resolves.toBe(
      "https://1.1.1.1/health",
    );
  });

  it("rejects non-http schemes, credentials, and local names", async () => {
    await expect(assertSafeScanUrl("ftp://example.com", publicResolver)).rejects.toThrow(
      /http and https/,
    );
    await expect(assertSafeScanUrl("https://user:secret@example.com", publicResolver)).rejects.toThrow(
      /credentials/,
    );
    await expect(assertSafeScanUrl("http://localhost/admin", publicResolver)).rejects.toThrow(
      /not eligible/,
    );
    await expect(assertSafeScanUrl("http://metadata.google.internal/", publicResolver)).rejects.toThrow(
      /not eligible/,
    );
  });

  it("rejects loopback, private, link-local, and obfuscated addresses", async () => {
    await expect(assertSafeScanUrl("http://127.0.0.1/", publicResolver)).rejects.toThrow(/not eligible/);
    await expect(assertSafeScanUrl("http://10.1.2.3/", publicResolver)).rejects.toThrow(/not eligible/);
    await expect(assertSafeScanUrl("http://169.254.169.254/latest", publicResolver)).rejects.toThrow(
      /not eligible/,
    );
    await expect(assertSafeScanUrl("http://[::1]/", publicResolver)).rejects.toThrow(/not eligible/);
    await expect(assertSafeScanUrl("http://2130706433/", publicResolver)).rejects.toThrow(/not eligible/);
    await expect(assertSafeScanUrl("http://127.1/", publicResolver)).rejects.toThrow(/not eligible/);
  });

  it("rejects a name when any resolved address is blocked", async () => {
    await expect(
      assertSafeScanUrl("https://example.com", async () => ["93.184.216.34", "10.0.0.5"]),
    ).rejects.toThrow(/not eligible/);
  });

  it("rejects a name that does not resolve", async () => {
    await expect(assertSafeScanUrl("https://example.com", async () => [])).rejects.toThrow(/not eligible/);
  });
});

describe("isBlockedAddress", () => {
  it("treats an IPv4-mapped loopback address as blocked", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
  });
});

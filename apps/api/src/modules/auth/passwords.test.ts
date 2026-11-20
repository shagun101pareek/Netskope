import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.js";

describe("passwords", () => {
  it("verifies the password that was hashed and rejects a different one", async () => {
    const passwordHash = await hashPassword("correct-horse-battery");

    await expect(verifyPassword("correct-horse-battery", passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-horse-battery", passwordHash)).resolves.toBe(false);
  });

  it("rejects a login for a missing user without throwing", async () => {
    await expect(verifyPassword("correct-horse-battery", undefined)).resolves.toBe(false);
  });
});

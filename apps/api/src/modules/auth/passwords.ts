import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

let dummyHash: Promise<string> | undefined;

function placeholderHash(): Promise<string> {
  dummyHash ??= hash(randomBytes(32).toString("hex"), ARGON_OPTIONS);
  return dummyHash;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(password: string, passwordHash: string | undefined): Promise<boolean> {
  const candidate = passwordHash ?? (await placeholderHash());

  try {
    const matches = await verify(candidate, password);
    return passwordHash !== undefined && matches;
  } catch {
    return false;
  }
}

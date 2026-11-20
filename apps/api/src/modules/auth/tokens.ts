import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../../lib/env.js";
import { unauthorized } from "../../lib/errors.js";

export const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_BYTES = 32;

const accessSecret = new TextEncoder().encode(env.accessTokenSecret);

export interface AccessTokenClaims {
  userId: string;
  email: string;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer("netskope")
    .setAudience("netskope-api")
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      issuer: "netskope",
      audience: "netskope-api",
    });

    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      throw unauthorized();
    }

    return { userId: payload.sub, email: payload.email };
  } catch (error) {
    if (error instanceof Error && error.name === "AppError") {
      throw error;
    }
    throw unauthorized();
  }
}

export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

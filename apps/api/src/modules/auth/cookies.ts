import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../lib/env.js";

export const REFRESH_COOKIE = "netskope_refresh";
const REFRESH_COOKIE_PATH = "/api/v1/auth";
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function readRefreshCookie(request: FastifyRequest): string | undefined {
  const value = request.cookies[REFRESH_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function setRefreshCookie(reply: FastifyReply, refreshToken: string): void {
  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

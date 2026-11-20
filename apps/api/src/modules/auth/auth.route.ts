import type { FastifyInstance } from "fastify";
import { unauthorized } from "../../lib/errors.js";
import { enforceRateLimit } from "../../lib/rate-limit.js";
import { loginUser, logoutSession, refreshSession, registerUser } from "./auth.service.js";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "./cookies.js";

const credentialsSchema = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: false,
  properties: {
    email: { type: "string", minLength: 3, maxLength: 254 },
    password: { type: "string", minLength: 12, maxLength: 128 },
  },
} as const;

const sessionResponseSchema = {
  type: "object",
  required: ["user", "accessToken", "expiresIn"],
  additionalProperties: false,
  properties: {
    user: {
      type: "object",
      required: ["id", "email", "createdAt"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        email: { type: "string" },
        createdAt: { type: "string" },
      },
    },
    accessToken: { type: "string" },
    expiresIn: { type: "integer" },
  },
} as const;

const REGISTER_LIMIT = 10;
const LOGIN_LIMIT = 20;
const WINDOW_SECONDS = 10 * 60;
const ACCESS_TOKEN_EXPIRES_IN = 15 * 60;

function clientAddress(request: { ip: string }): string {
  return request.ip || "unknown";
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/register",
    { schema: { body: credentialsSchema, response: { 201: sessionResponseSchema } } },
    async (request, reply) => {
      await enforceRateLimit(
        app.redis,
        `netskope:rate:register:${clientAddress(request)}`,
        REGISTER_LIMIT,
        WINDOW_SECONDS,
      );
      const body = request.body as { email: string; password: string };
      const session = await registerUser(body.email, body.password);
      setRefreshCookie(reply, session.refreshToken);
      return reply.code(201).send({
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      });
    },
  );

  app.post(
    "/login",
    { schema: { body: credentialsSchema, response: { 200: sessionResponseSchema } } },
    async (request, reply) => {
      await enforceRateLimit(
        app.redis,
        `netskope:rate:login:${clientAddress(request)}`,
        LOGIN_LIMIT,
        WINDOW_SECONDS,
      );
      const body = request.body as { email: string; password: string };
      const session = await loginUser(body.email, body.password);
      setRefreshCookie(reply, session.refreshToken);
      return reply.code(200).send({
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      });
    },
  );

  app.post("/refresh", async (request, reply) => {
    const refreshToken = readRefreshCookie(request);
    if (!refreshToken) {
      throw unauthorized();
    }

    const session = await refreshSession(refreshToken);
    setRefreshCookie(reply, session.refreshToken);
    return reply.code(200).send({
      user: session.user,
      accessToken: session.accessToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });
  });

  app.post("/logout", async (request, reply) => {
    const refreshToken = readRefreshCookie(request);
    if (!refreshToken) {
      throw unauthorized();
    }

    await logoutSession(refreshToken);
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });
}

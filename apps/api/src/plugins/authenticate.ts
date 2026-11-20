import type { FastifyRequest } from "fastify";
import { unauthorized } from "../lib/errors.js";
import { authenticateAccessToken } from "../modules/auth/auth.service.js";

export async function requireAuth(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    throw unauthorized();
  }

  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) {
    throw unauthorized();
  }

  request.authUser = await authenticateAccessToken(token);
}

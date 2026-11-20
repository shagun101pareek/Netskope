import { prisma } from "@netskope/database";
import { AppError, isUniqueViolation, unauthorized } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { generateRefreshToken, hashRefreshToken, signAccessToken, verifyAccessToken } from "./tokens.js";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthSession {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new AppError(400, "VALIDATION_ERROR", "Enter a valid email address.");
  }

  return normalized;
}

function assertPassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new AppError(400, "VALIDATION_ERROR", "Password must be between 12 and 128 characters.");
  }
}

function toPublicUser(user: { id: string; email: string; createdAt: Date }): PublicUser {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}

async function issueSession(user: { id: string; email: string; createdAt: Date }): Promise<AuthSession> {
  const refreshToken = generateRefreshToken();
  const accessToken = await signAccessToken({ userId: user.id, email: user.email });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken,
  };
}

export async function registerUser(email: string, password: string): Promise<AuthSession> {
  const normalizedEmail = normalizeEmail(email);
  assertPassword(password);
  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: { email: normalizedEmail, passwordHash },
      select: { id: true, email: true, createdAt: true },
    });
    return await issueSession(user);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, "CONFLICT", "An account with that email already exists.");
    }
    throw error;
  }
}

export async function loginUser(email: string, password: string): Promise<AuthSession> {
  const normalizedEmail = normalizeEmail(email);
  assertPassword(password);
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const matches = await verifyPassword(password, user?.passwordHash);

  if (!user || !matches) {
    throw unauthorized("The email or password is incorrect.");
  }

  return issueSession({ id: user.id, email: user.email, createdAt: user.createdAt });
}

export async function refreshSession(refreshToken: string): Promise<AuthSession> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(refreshToken) },
    include: { user: { select: { id: true, email: true, createdAt: true } } },
  });

  if (!existing || existing.expiresAt.getTime() <= Date.now()) {
    throw unauthorized();
  }

  if (existing.revokedAt) {
    if (existing.replacedByTokenId) {
      await prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    throw unauthorized();
  }

  const nextToken = generateRefreshToken();
  const accessToken = await signAccessToken({ userId: existing.user.id, email: existing.user.email });

  await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hashRefreshToken(nextToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    const revoked = await tx.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedByTokenId: created.id },
    });

    if (revoked.count !== 1) {
      throw unauthorized();
    }
  });

  return {
    user: toPublicUser(existing.user),
    accessToken,
    refreshToken: nextToken,
  };
}

export async function logoutSession(refreshToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function authenticateAccessToken(token: string): Promise<{ id: string; email: string }> {
  const claims = await verifyAccessToken(token);
  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, email: true },
  });

  if (!user) {
    throw unauthorized();
  }

  return user;
}

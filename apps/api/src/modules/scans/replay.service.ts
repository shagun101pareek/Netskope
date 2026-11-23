import { ReplayStatus, prisma } from "@netskope/database";
import { prepareReplayRequest } from "@netskope/shared/inspection";
import { UrlPolicyError, assertSafeScanUrl } from "@netskope/shared/url-policy";
import { AppError } from "../../lib/errors.js";
import { getScan } from "./scans.service.js";

export interface ReplayResponse {
  id: string;
  scanId: string;
  networkRequestId: string;
  method: string;
  url: string;
  headers: unknown;
  body: string | null;
  confirmMutation: boolean;
  status: ReplayStatus;
  originalStatus: number | null;
  replayStatus: number | null;
  originalDuration: number | null;
  replayDuration: number | null;
  responseExcerpt: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export async function createReplay(
  userId: string,
  scanId: string,
  requestRowId: string,
  body: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string | null;
    confirmed?: boolean;
    confirmMutation?: boolean;
    sendCredentials?: boolean;
  },
): Promise<ReplayResponse> {
  await getScan(userId, scanId);
  if (body.sendCredentials) {
    throw new AppError(400, "VALIDATION_ERROR", "Replays do not send authentication credentials.");
  }
  if (!body.headers || typeof body.headers !== "object" || Array.isArray(body.headers)) {
    throw new AppError(400, "VALIDATION_ERROR", "headers must be an object.");
  }
  for (const value of Object.values(body.headers)) {
    if (typeof value !== "string") {
      throw new AppError(400, "VALIDATION_ERROR", "header values must be strings.");
    }
  }

  const request = await prisma.networkRequest.findFirst({
    where: { id: requestRowId, scanId },
    select: { id: true },
  });
  if (!request) {
    throw new AppError(404, "NOT_FOUND", "Request not found.");
  }

  const prepared = prepareReplayRequest({
    method: body.method ?? "",
    url: body.url ?? "",
    headers: body.headers,
    body: body.body ?? null,
    confirmed: body.confirmed === true,
    confirmMutation: body.confirmMutation === true,
    sendCredentials: false,
  });
  if (!prepared.ok) {
    throw new AppError(400, "VALIDATION_ERROR", prepared.message);
  }

  let url: string;
  try {
    url = await assertSafeScanUrl(body.url ?? "");
  } catch (error) {
    if (error instanceof UrlPolicyError) {
      throw new AppError(400, "VALIDATION_ERROR", error.message);
    }
    throw error;
  }

  const created = await prisma.requestReplay.create({
    data: {
      userId,
      scanId,
      networkRequestId: request.id,
      method: prepared.method,
      url,
      headers: prepared.headers,
      body: prepared.body,
      confirmMutation: prepared.mutating,
      sendCredentials: false,
      status: ReplayStatus.PENDING,
    },
  });
  return presentReplay(created);
}

export async function getReplay(userId: string, scanId: string, replayId: string): Promise<ReplayResponse> {
  await getScan(userId, scanId);
  const replay = await prisma.requestReplay.findFirst({
    where: { id: replayId, scanId, userId },
  });
  if (!replay) {
    throw new AppError(404, "NOT_FOUND", "Replay not found.");
  }
  return presentReplay(replay);
}

function presentReplay(replay: {
  id: string;
  scanId: string;
  networkRequestId: string;
  method: string;
  url: string;
  headers: unknown;
  body: string | null;
  confirmMutation: boolean;
  status: ReplayStatus;
  originalStatus: number | null;
  replayStatus: number | null;
  originalDuration: number | null;
  replayDuration: number | null;
  responseExcerpt: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): ReplayResponse {
  return {
    id: replay.id,
    scanId: replay.scanId,
    networkRequestId: replay.networkRequestId,
    method: replay.method,
    url: replay.url,
    headers: replay.headers,
    body: replay.body,
    confirmMutation: replay.confirmMutation,
    status: replay.status,
    originalStatus: replay.originalStatus,
    replayStatus: replay.replayStatus,
    originalDuration: replay.originalDuration,
    replayDuration: replay.replayDuration,
    responseExcerpt: replay.responseExcerpt,
    errorMessage: replay.errorMessage,
    createdAt: replay.createdAt.toISOString(),
    completedAt: replay.completedAt?.toISOString() ?? null,
  };
}

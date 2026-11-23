import type { Prisma } from "@netskope/database";
import type { ObservedCall } from "@netskope/shared/inspection";

export interface InsightRow {
  id: string;
  requestId: string;
  url: string;
  method: string;
  resourceType: string | null;
  requestClass: string | null;
  timestamp: Date;
  failureReason: string | null;
  requestHeaders: Prisma.JsonValue;
  requestPayload: string | null;
  requestPayloadTruncated?: boolean;
  requestBodyOmittedReason?: string | null;
  requestSize?: number | null;
  queryParams?: Prisma.JsonValue;
  initiator: Prisma.JsonValue;
  redirectChain: Prisma.JsonValue;
  response: {
    statusCode: number | null;
    statusText?: string | null;
    remoteAddress?: string | null;
    mimeType: string | null;
    bodySize: number | null;
    responseHeaders: Prisma.JsonValue;
    responseBody?: string | null;
    bodyOmittedReason?: string | null;
    bodyTruncated?: boolean;
  } | null;
  timing: {
    dnsTime: number | null;
    connectTime: number | null;
    tlsTime: number | null;
    ttfb: number | null;
    downloadTime: number | null;
    totalDuration: number | null;
    timingMetadata?: Prisma.JsonValue;
  } | null;
}

export function toObservedCall(row: InsightRow, captureBodies: boolean): ObservedCall {
  return {
    method: row.method,
    url: row.url,
    requestClass: row.requestClass,
    resourceType: row.resourceType,
    statusCode: row.response?.statusCode ?? null,
    mimeType: row.response?.mimeType ?? null,
    failureReason: row.failureReason,
    totalDuration: row.timing?.totalDuration ?? null,
    bodySize: row.response?.bodySize ?? null,
    responseBody: row.response?.responseBody ?? null,
    bodyOmittedReason: row.response?.bodyOmittedReason ?? null,
    captureBodies,
  };
}

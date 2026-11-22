import { redactHeaders } from "./redact.js";
import { calculatePhaseTiming, type PhaseTiming } from "./timing.js";

const DEFAULT_MAX_REQUESTS = 500;
const MAX_PAYLOAD_BYTES = 8_192;
const MAX_URL_LENGTH = 8_000;
const UNFINISHED_REASON = "The request did not finish before the scan ended.";

export interface RedirectHop {
  url: string;
  statusCode: number | null;
}

export interface CapturedResponse {
  statusCode: number;
  responseHeaders: Record<string, string>;
  mimeType: string | null;
  bodySize: number | null;
}

export interface CapturedExchange {
  requestId: string;
  url: string;
  method: string;
  resourceType: string | null;
  requestHeaders: Record<string, string>;
  requestPayload: string | null;
  timestamp: Date;
  initiator?: { type: string; url?: string };
  failureReason: string | null;
  redirectChain?: RedirectHop[];
  response?: CapturedResponse;
  timing?: PhaseTiming;
}

interface ResponseDraft {
  statusCode: number;
  responseHeaders: Record<string, string>;
  mimeType: string | null;
}

interface Exchange {
  requestId: string;
  url: string;
  method: string;
  resourceType: string | null;
  requestHeaders: Record<string, string>;
  requestPayload: string | null;
  timestamp: Date;
  initiator: { type: string; url?: string } | null;
  redirectChain: RedirectHop[];
  failureReason: string | null;
  response: ResponseDraft | null;
  provisional: ResponseDraft | null;
  finished: boolean;
  encodedLength: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  timing: Record<string, unknown> | null;
}

/**
 * Correlates Chrome DevTools Protocol Network events by request id.
 * Redirect hops that reuse one id stay on that exchange. Phase durations come
 * from the final response's ResourceTiming block.
 */
export function createNetworkCollector(options?: { maxRequests?: number; now?: () => Date }): {
  requestWillBeSent: (params: unknown) => void;
  requestWillBeSentExtraInfo: (params: unknown) => void;
  responseReceived: (params: unknown) => void;
  responseReceivedExtraInfo: (params: unknown) => void;
  loadingFinished: (params: unknown) => void;
  loadingFailed: (params: unknown) => void;
  records: () => CapturedExchange[];
  truncated: () => boolean;
} {
  const maxRequests = options?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const now = options?.now ?? ((): Date => new Date());
  const exchanges = new Map<string, Exchange>();
  const pendingRequestHeaders = new Map<string, Record<string, string>>();
  const pendingResponseHeaders = new Map<string, Record<string, string>>();
  let dropped = 0;

  return {
    requestWillBeSent(params: unknown) {
      const event = asRecord(params);
      const request = asRecord(event?.request);
      const requestId = asString(event?.requestId);
      const url = asString(request?.url);
      if (!event || !request || !requestId || !url) {
        return;
      }

      const existing = exchanges.get(requestId);
      const redirectResponse = asRecord(event.redirectResponse);
      if (existing && redirectResponse) {
        existing.redirectChain.push({
          url: existing.url,
          statusCode:
            asStatus(redirectResponse.status) ??
            existing.provisional?.statusCode ??
            existing.response?.statusCode ??
            null,
        });
        existing.url = clip(url);
        existing.method = methodOf(request.method);
        existing.requestHeaders = mergeHeaders(
          readHeaders(request.headers),
          takePending(pendingRequestHeaders, requestId),
        );
        existing.requestPayload = payloadOf(request.postData);
        existing.response = null;
        existing.provisional = null;
        existing.encodedLength = null;
        existing.timing = null;
        existing.finishedAt = null;
        existing.startedAt = asMonotonic(event.timestamp);
        const type = asString(event.type);
        if (type) {
          existing.resourceType = type;
        }
        return;
      }

      if (existing || !isHttpUrl(url)) {
        return;
      }
      if (exchanges.size >= maxRequests) {
        dropped += 1;
        return;
      }

      exchanges.set(requestId, {
        requestId,
        url: clip(url),
        method: methodOf(request.method),
        resourceType: asString(event.type),
        requestHeaders: mergeHeaders(readHeaders(request.headers), takePending(pendingRequestHeaders, requestId)),
        requestPayload: payloadOf(request.postData),
        timestamp: wallTimeToDate(event.wallTime, now()),
        initiator: initiatorOf(event.initiator),
        redirectChain:
          redirectResponse && asString(redirectResponse.url)
            ? [
                {
                  url: clip(asString(redirectResponse.url) ?? url),
                  statusCode: asStatus(redirectResponse.status),
                },
              ]
            : [],
        failureReason: null,
        response: null,
        provisional: null,
        finished: false,
        encodedLength: null,
        startedAt: asMonotonic(event.timestamp),
        finishedAt: null,
        timing: null,
      });
    },

    requestWillBeSentExtraInfo(params: unknown) {
      const event = asRecord(params);
      const requestId = asString(event?.requestId);
      const headers = readHeaders(event?.headers);
      if (!requestId || !headers) {
        return;
      }
      const exchange = exchanges.get(requestId);
      if (!exchange) {
        remember(pendingRequestHeaders, requestId, headers, maxRequests);
        return;
      }
      exchange.requestHeaders = mergeHeaders(exchange.requestHeaders, headers);
    },

    responseReceived(params: unknown) {
      const event = asRecord(params);
      const requestId = asString(event?.requestId);
      const response = asRecord(event?.response);
      const exchange = requestId ? exchanges.get(requestId) : undefined;
      const statusCode = asStatus(response?.status);
      if (!event || !requestId || !response || !exchange || statusCode === null) {
        return;
      }

      const draft: ResponseDraft = {
        statusCode,
        responseHeaders: mergeHeaders(readHeaders(response.headers), takePending(pendingResponseHeaders, requestId)),
        mimeType: mediaType(asString(response.mimeType)),
      };
      const type = asString(event.type);
      if (type) {
        exchange.resourceType = type;
      }
      exchange.timing = asRecord(response.timing);
      if (isRedirectStatus(statusCode)) {
        exchange.provisional = draft;
        return;
      }
      exchange.provisional = null;
      exchange.response = draft;
    },

    responseReceivedExtraInfo(params: unknown) {
      const event = asRecord(params);
      const requestId = asString(event?.requestId);
      const headers = readHeaders(event?.headers);
      if (!requestId || !headers) {
        return;
      }
      const exchange = exchanges.get(requestId);
      if (!exchange) {
        remember(pendingResponseHeaders, requestId, headers, maxRequests);
        return;
      }
      if (exchange.response) {
        exchange.response.responseHeaders = mergeHeaders(exchange.response.responseHeaders, headers);
        return;
      }
      if (exchange.provisional) {
        exchange.provisional.responseHeaders = mergeHeaders(exchange.provisional.responseHeaders, headers);
        return;
      }
      remember(pendingResponseHeaders, requestId, headers, maxRequests);
    },

    loadingFinished(params: unknown) {
      const event = asRecord(params);
      const requestId = asString(event?.requestId);
      const exchange = requestId ? exchanges.get(requestId) : undefined;
      if (!event || !exchange) {
        return;
      }
      exchange.finished = true;
      const finishedAt = asMonotonic(event.timestamp);
      if (finishedAt !== null) {
        exchange.finishedAt = finishedAt;
      }
      const encodedLength = asByteSize(event.encodedDataLength);
      if (encodedLength !== null) {
        exchange.encodedLength = encodedLength;
      }
    },

    loadingFailed(params: unknown) {
      const event = asRecord(params);
      const requestId = asString(event?.requestId);
      const exchange = requestId ? exchanges.get(requestId) : undefined;
      if (!event || !exchange) {
        return;
      }
      exchange.finished = true;
      const finishedAt = asMonotonic(event.timestamp);
      if (finishedAt !== null) {
        exchange.finishedAt = finishedAt;
      }
      exchange.failureReason = failureText(
        asString(event.errorText) ?? "",
        event.canceled === true,
        asString(event.blockedReason),
      );
      const type = asString(event.type);
      if (type) {
        exchange.resourceType = type;
      }
    },

    records() {
      return [...exchanges.values()]
        .map(finalize)
        .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime() || left.requestId.localeCompare(right.requestId));
    },

    truncated() {
      return dropped > 0;
    },
  };
}

function finalize(exchange: Exchange): CapturedExchange {
  const response = exchange.response ?? exchange.provisional;
  let failureReason = exchange.failureReason;
  if (!response && !failureReason && !exchange.finished) {
    failureReason = UNFINISHED_REASON;
  }
  const timing = calculatePhaseTiming({
    timing: exchange.timing,
    startedAt: exchange.startedAt,
    finishedAt: exchange.finishedAt,
  });

  return {
    requestId: exchange.requestId,
    url: exchange.url,
    method: exchange.method,
    resourceType: exchange.resourceType,
    requestHeaders: redactHeaders(exchange.requestHeaders),
    requestPayload: exchange.requestPayload,
    timestamp: exchange.timestamp,
    ...(exchange.initiator ? { initiator: exchange.initiator } : {}),
    failureReason,
    ...(exchange.redirectChain.length > 0 ? { redirectChain: exchange.redirectChain } : {}),
    ...(response
      ? {
          response: {
            statusCode: response.statusCode,
            responseHeaders: redactHeaders(response.responseHeaders),
            mimeType: response.mimeType,
            bodySize: exchange.encodedLength,
          },
        }
      : {}),
    ...(timing ? { timing } : {}),
  };
}

function failureText(errorText: string, canceled: boolean, blockedReason: string | null): string {
  if (errorText.includes("ERR_BLOCKED_BY_CLIENT")) {
    return "Blocked by scan policy";
  }
  const base = errorText.trim();
  if (!base && canceled) {
    return "The request was canceled.";
  }
  if (!base && blockedReason) {
    return `Blocked (${blockedReason})`.slice(0, 300);
  }
  if (blockedReason && base) {
    return `${base} (${blockedReason})`.slice(0, 300);
  }
  return base.slice(0, 300) || "The request failed.";
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304;
}

function initiatorOf(value: unknown): { type: string; url?: string } | null {
  const record = asRecord(value);
  const type = asString(record?.type);
  if (!type) {
    return null;
  }
  const url = asString(record?.url);
  return url ? { type, url: clip(url) } : { type };
}

function methodOf(value: unknown): string {
  const method = asString(value) ?? "GET";
  return method.slice(0, 32);
}

function payloadOf(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PAYLOAD_BYTES) {
    return null;
  }
  if (value.includes("\u0000")) {
    return null;
  }
  return value;
}

function mediaType(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const value = header.split(";")[0]?.trim().toLowerCase() ?? "";
  if (value.length === 0 || value.length > 127) {
    return null;
  }
  return value;
}

function wallTimeToDate(value: unknown, fallback: Date): Date {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  const millis = value > 1e12 ? value : value * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function readHeaders(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(record)) {
    if (typeof header === "string") {
      headers[key] = header;
    }
  }
  return headers;
}

function mergeHeaders(
  base: Record<string, string> | null | undefined,
  extra: Record<string, string> | null | undefined,
): Record<string, string> {
  return { ...(base ?? {}), ...(extra ?? {}) };
}

function remember(
  pending: Map<string, Record<string, string>>,
  requestId: string,
  headers: Record<string, string>,
  maxRequests: number,
): void {
  if (!pending.has(requestId) && pending.size >= maxRequests) {
    return;
  }
  pending.set(requestId, mergeHeaders(pending.get(requestId), headers));
}

function takePending(
  pending: Map<string, Record<string, string>>,
  requestId: string,
): Record<string, string> | null {
  const headers = pending.get(requestId) ?? null;
  pending.delete(requestId);
  return headers;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStatus(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 599) {
    return null;
  }
  return value;
}

function asMonotonic(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function asByteSize(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function clip(value: string): string {
  return value.slice(0, MAX_URL_LENGTH);
}

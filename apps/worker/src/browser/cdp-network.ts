import { isSensitiveKey, MAX_REQUEST_BODY_BYTES, MAX_RESPONSE_BODY_BYTES, redactHeaders, redactPayload } from "@netskope/shared/inspection";
import { calculatePhaseTiming, type PhaseTiming } from "./timing.js";

const DEFAULT_MAX_REQUESTS = 500;
const MAX_URL_LENGTH = 8_000;
const UNFINISHED_REASON = "The request did not finish before the scan ended.";

export interface RedirectHop {
  url: string;
  statusCode: number | null;
}

export interface QueryParam {
  name: string;
  value: string;
}

export interface StackFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface InitiatorInfo {
  type: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  requestId?: string;
  stack?: StackFrame[];
}

export interface CapturedResponse {
  statusCode: number;
  statusText: string | null;
  remoteAddress: string | null;
  responseHeaders: Record<string, string>;
  mimeType: string | null;
  bodySize: number | null;
  responseBody: string | null;
  bodyOmittedReason: string | null;
  bodyTruncated: boolean;
}

export interface CapturedExchange {
  requestId: string;
  url: string;
  method: string;
  resourceType: string | null;
  requestHeaders: Record<string, string>;
  requestPayload: string | null;
  requestPayloadTruncated: boolean;
  requestBodyOmittedReason: string | null;
  requestSize: number | null;
  queryParams?: QueryParam[];
  timestamp: Date;
  initiator?: InitiatorInfo;
  failureReason: string | null;
  redirectChain?: RedirectHop[];
  response?: CapturedResponse;
  timing?: PhaseTiming;
}

export interface BodyTarget {
  requestId: string;
  url: string;
  mimeType: string | null;
}

interface ResponseDraft {
  statusCode: number;
  statusText: string | null;
  remoteAddress: string | null;
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
  requestPayloadTruncated: boolean;
  requestBodyOmittedReason: string | null;
  requestSize: number | null;
  timestamp: Date;
  initiator: InitiatorInfo | null;
  responseBody: string | null;
  bodyOmittedReason: string | null;
  bodyTruncated: boolean;
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
  bodyTargets: () => BodyTarget[];
  missingPayloads: () => { requestId: string }[];
  setResponseBody: (requestId: string, body: { text: string | null; truncated: boolean; omittedReason: string | null }) => void;
  setRequestPayload: (requestId: string, postData: string) => void;
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
        const payload = payloadOf(request.postData, existing.requestHeaders);
        existing.requestPayload = payload.text;
        existing.requestPayloadTruncated = payload.truncated;
        existing.requestBodyOmittedReason = payload.omittedReason;
        existing.requestSize = requestSizeOf(existing.requestHeaders, payload.text);
        existing.response = null;
        existing.provisional = null;
        existing.responseBody = null;
        existing.bodyOmittedReason = null;
        existing.bodyTruncated = false;
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

      const requestHeaders = mergeHeaders(readHeaders(request.headers), takePending(pendingRequestHeaders, requestId));
      const payload = payloadOf(request.postData, requestHeaders);
      exchanges.set(requestId, {
        requestId,
        url: clip(url),
        method: methodOf(request.method),
        resourceType: asString(event.type),
        requestHeaders,
        requestPayload: payload.text,
        requestPayloadTruncated: payload.truncated,
        requestBodyOmittedReason: payload.omittedReason,
        requestSize: requestSizeOf(requestHeaders, payload.text),
        timestamp: wallTimeToDate(event.wallTime, now()),
        initiator: initiatorOf(event.initiator),
        responseBody: null,
        bodyOmittedReason: null,
        bodyTruncated: false,
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
        statusText: clipText(asString(response.statusText), 64),
        remoteAddress: remoteAddressOf(response),
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

    bodyTargets() {
      return [...exchanges.values()]
        .filter((exchange) => exchange.response || exchange.provisional)
        .map((exchange) => ({
          requestId: exchange.requestId,
          url: exchange.url,
          mimeType: (exchange.response ?? exchange.provisional)?.mimeType ?? null,
        }));
    },

    missingPayloads() {
      return [...exchanges.values()]
        .filter((exchange) => exchange.requestPayload === null && exchange.method !== "GET" && exchange.method !== "HEAD")
        .map((exchange) => ({ requestId: exchange.requestId }));
    },

    setResponseBody(requestId, body) {
      const exchange = exchanges.get(requestId);
      if (!exchange) {
        return;
      }
      if (!body.text) {
        exchange.responseBody = null;
        exchange.bodyTruncated = body.truncated;
        exchange.bodyOmittedReason = body.omittedReason;
        return;
      }
      const mime = (exchange.response ?? exchange.provisional)?.mimeType ?? null;
      const redacted = redactPayload(body.text, mime, MAX_RESPONSE_BODY_BYTES);
      exchange.responseBody = redacted.text;
      exchange.bodyTruncated = body.truncated || redacted.truncated;
      exchange.bodyOmittedReason = redacted.omittedReason ?? body.omittedReason;
    },

    setRequestPayload(requestId, postData) {
      const exchange = exchanges.get(requestId);
      if (!exchange) {
        return;
      }
      const payload = payloadOf(postData, exchange.requestHeaders);
      exchange.requestPayload = payload.text;
      exchange.requestPayloadTruncated = payload.truncated;
      exchange.requestBodyOmittedReason = payload.omittedReason;
      exchange.requestSize = requestSizeOf(exchange.requestHeaders, payload.text);
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
    requestPayloadTruncated: exchange.requestPayloadTruncated,
    requestBodyOmittedReason: exchange.requestBodyOmittedReason,
    requestSize: exchange.requestSize,
    ...queryParamsOf(exchange.url),
    timestamp: exchange.timestamp,
    ...(exchange.initiator ? { initiator: exchange.initiator } : {}),
    failureReason,
    ...(exchange.redirectChain.length > 0 ? { redirectChain: exchange.redirectChain } : {}),
    ...(response
      ? {
          response: {
            statusCode: response.statusCode,
            statusText: response.statusText,
            remoteAddress: response.remoteAddress,
            responseHeaders: redactHeaders(response.responseHeaders),
            mimeType: response.mimeType,
            bodySize: exchange.encodedLength,
            responseBody: exchange.responseBody,
            bodyOmittedReason: exchange.bodyOmittedReason,
            bodyTruncated: exchange.bodyTruncated,
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

function initiatorOf(value: unknown): InitiatorInfo | null {
  const record = asRecord(value);
  const type = asString(record?.type);
  if (!type) {
    return null;
  }
  const initiator: InitiatorInfo = { type };
  const url = asString(record?.url);
  if (url) {
    initiator.url = clip(url);
  }
  const lineNumber = asIndex(record?.lineNumber);
  const columnNumber = asIndex(record?.columnNumber);
  if (lineNumber !== null) {
    initiator.lineNumber = lineNumber;
  }
  if (columnNumber !== null) {
    initiator.columnNumber = columnNumber;
  }
  const requestId = asString(record?.requestId);
  if (requestId) {
    initiator.requestId = requestId;
  }
  const stack = framesOf(record?.stack, 12);
  if (stack.length > 0) {
    initiator.stack = stack;
  }
  return initiator;
}

function framesOf(value: unknown, limit: number): StackFrame[] {
  const record = asRecord(value);
  if (!record || limit <= 0) {
    return [];
  }
  const frames: StackFrame[] = [];
  const callFrames = Array.isArray(record.callFrames) ? record.callFrames : [];
  for (const frame of callFrames) {
    if (frames.length >= limit) {
      break;
    }
    const parsed = frameOf(frame);
    if (parsed) {
      frames.push(parsed);
    }
  }
  if (frames.length < limit && record.parent) {
    frames.push(...framesOf(record.parent, limit - frames.length));
  }
  return frames;
}

function frameOf(value: unknown): StackFrame | null {
  const record = asRecord(value);
  const url = asString(record?.url);
  if (!record || !url) {
    return null;
  }
  return {
    functionName: (asString(record.functionName) ?? "(anonymous)").slice(0, 120),
    url: clip(url),
    lineNumber: asIndex(record.lineNumber) ?? 0,
    columnNumber: asIndex(record.columnNumber) ?? 0,
  };
}

function methodOf(value: unknown): string {
  const method = asString(value) ?? "GET";
  return method.slice(0, 32);
}

function payloadOf(
  value: unknown,
  headers: Record<string, string>,
): { text: string | null; truncated: boolean; omittedReason: string | null } {
  if (typeof value !== "string" || value.length === 0) {
    return { text: null, truncated: false, omittedReason: null };
  }
  return redactPayload(value, headerValue(headers, "content-type"), MAX_REQUEST_BODY_BYTES);
}

function requestSizeOf(headers: Record<string, string>, payload: string | null): number | null {
  const declared = headerValue(headers, "content-length");
  if (declared && /^\d+$/.test(declared)) {
    const size = Number(declared);
    if (size <= Number.MAX_SAFE_INTEGER) {
      return size;
    }
  }
  if (payload === null) {
    return null;
  }
  return new TextEncoder().encode(payload).byteLength;
}

function queryParamsOf(url: string): { queryParams: QueryParam[] } | Record<string, never> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {};
  }
  const params = [...parsed.searchParams.entries()].slice(0, 50);
  if (params.length === 0) {
    return {};
  }
  return {
    queryParams: params.map(([name, value]) => ({
      name: name.slice(0, 128),
      value: isSensitiveKey(name) ? "[redacted]" : value.slice(0, 256),
    })),
  };
}

function remoteAddressOf(response: Record<string, unknown>): string | null {
  const address = asString(response.remoteIPAddress);
  if (!address) {
    return null;
  }
  const port = response.remotePort;
  if (typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535) {
    return `${address}:${port}`.slice(0, 128);
  }
  return address.slice(0, 128);
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      return value;
    }
  }
  return null;
}

function clipText(value: string | null, max: number): string | null {
  if (!value) {
    return null;
  }
  return value.slice(0, max);
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

function asIndex(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
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

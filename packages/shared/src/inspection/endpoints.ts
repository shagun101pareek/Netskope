const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONGO = /^[0-9a-f]{24}$/i;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
const NUMERIC = /^\d{2,}$/;
const STATIC_PREVIOUS = new Set(["status", "error", "errors", "code", "codes", "http"]);

export interface EndpointIdentity {
  method: string;
  host: string;
  path: string;
  key: string;
}

/** Groups dynamic ids without collapsing static segments such as /v1 or /error/404. */
export function identifyEndpoint(method: string, url: string): EndpointIdentity {
  const normalizedMethod = method.toUpperCase();
  try {
    const parsed = new URL(url);
    const path = normalizePath(parsed.pathname);
    const host = parsed.host;
    return { method: normalizedMethod, host, path, key: `${normalizedMethod} ${host}${path}` };
  } catch {
    return { method: normalizedMethod, host: "", path: url.slice(0, 300), key: `${normalizedMethod} ${url.slice(0, 300)}` };
  }
}

export function normalizePath(pathname: string): string {
  const segments = pathname.split("/");
  return segments
    .map((segment, index) => {
      if (!segment) {
        return segment;
      }
      const decoded = safeDecode(segment);
      if (UUID.test(decoded) || MONGO.test(decoded) || LONG_HEX.test(decoded)) {
        return "{id}";
      }
      if (NUMERIC.test(decoded)) {
        const previous = safeDecode(segments[index - 1] ?? "").toLowerCase();
        if (STATIC_PREVIOUS.has(previous)) {
          return decoded;
        }
        return "{id}";
      }
      return decoded;
    })
    .join("/");
}

export function isApiObservation(input: {
  requestClass: string | null;
  resourceType: string | null;
  mimeType: string | null;
  url: string;
}): boolean {
  if (input.requestClass === "DOCUMENT" || input.requestClass === "STATIC") {
    return false;
  }
  if (input.requestClass === "API") {
    return true;
  }
  const resource = input.resourceType?.toLowerCase() ?? "";
  if (resource === "xhr" || resource === "fetch" || resource === "eventsource" || resource === "websocket") {
    return true;
  }
  const mime = input.mimeType?.toLowerCase() ?? "";
  return mime.includes("json") || mime.includes("xml") || mime.includes("graphql");
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return round(sorted[index] ?? sorted[sorted.length - 1] ?? 0);
}

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
  }
  return round(sorted[mid] ?? 0);
}

export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

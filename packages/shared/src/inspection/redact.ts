const MAX_HEADER_VALUE_LENGTH = 512;
const MAX_HEADERS = 40;

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-xsrf-token",
]);

const SENSITIVE_KEY =
  /(password|passwd|secret|token|authorization|cookie|api[-_]?key|session|credential|private[-_]?key|credit[-_]?card|card[-_]?number|cvv|cvc|ssn)/i;

/** Header names that must never be stored or forwarded from a capture. */
export function isSensitiveHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return SENSITIVE_HEADERS.has(normalized) || normalized.includes("token") || normalized.includes("secret");
}

/** Object keys whose values are credentials, including nested JSON. */
export function isSensitiveKey(name: string): boolean {
  return SENSITIVE_KEY.test(name);
}

/** Returns a copy safe to store. Sensitive values are replaced, never logged through. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  const entries = Object.entries(headers).slice(0, MAX_HEADERS);

  for (const [key, value] of entries) {
    const name = key.toLowerCase();
    if (isSensitiveHeader(name)) {
      redacted[name] = "[redacted]";
      continue;
    }
    redacted[name] = value.length > MAX_HEADER_VALUE_LENGTH ? value.slice(0, MAX_HEADER_VALUE_LENGTH) : value;
  }

  return redacted;
}

/** Recursively replaces sensitive values in JSON-like data. */
export function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = isSensitiveKey(key) ? "[redacted]" : redactJsonValue(nested);
  }
  return redacted;
}

const BEARER = /\b(bearer\s+)[a-z0-9\-._~+/]+=*/gi;

/**
 * Prepares a request or response body for storage.
 * Multipart file contents are dropped. JSON and form fields are redacted.
 */
export function redactPayload(
  payload: string,
  contentType: string | null,
  maxBytes: number,
): { text: string | null; truncated: boolean; omittedReason: string | null } {
  if (payload.includes("\u0000")) {
    return { text: null, truncated: false, omittedReason: "Binary content is not stored." };
  }

  const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.startsWith("multipart/")) {
    const names = multipartNames(payload);
    return {
      text: `[multipart omitted; fields: ${names.length > 0 ? names.join(", ") : "unknown"}]`,
      truncated: false,
      omittedReason: null,
    };
  }

  const truncated = byteLength(payload) > maxBytes;
  const clipped = truncated ? clipBytes(payload, maxBytes) : payload;

  if (type.includes("json") || looksLikeJson(clipped)) {
    try {
      return { text: JSON.stringify(redactJsonValue(JSON.parse(clipped)), null, 2), truncated, omittedReason: null };
    } catch {
      // A truncated JSON document cannot be parsed. Store the clipped text after a bearer scrub.
    }
  }

  if (type === "application/x-www-form-urlencoded" || (!type && clipped.includes("=") && !clipped.includes(" "))) {
    return { text: redactForm(clipped), truncated, omittedReason: null };
  }

  return { text: clipped.replace(BEARER, "$1[redacted]"), truncated, omittedReason: null };
}

export function redactForm(value: string): string {
  const params = new URLSearchParams(value);
  const redacted = new URLSearchParams();
  for (const [key, field] of params.entries()) {
    redacted.append(key, isSensitiveKey(key) ? "[redacted]" : field);
  }
  return redacted.toString();
}

function multipartNames(payload: string): string[] {
  const names: string[] = [];
  const pattern = /content-disposition:[^\n]*\bname="([^"]+)"/gi;
  let match = pattern.exec(payload);
  while (match) {
    const name = match[1];
    if (name && !names.includes(name)) {
      names.push(name.slice(0, 80));
    }
    if (names.length >= 30) {
      break;
    }
    match = pattern.exec(payload);
  }
  return names;
}

function looksLikeJson(value: string): boolean {
  const start = value.trimStart()[0];
  return start === "{" || start === "[";
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function clipBytes(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  return new TextDecoder().decode(bytes.slice(0, maxBytes));
}

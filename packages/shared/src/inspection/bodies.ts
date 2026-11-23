export const MAX_RESPONSE_BODY_BYTES = 65_536;
export const MAX_REQUEST_BODY_BYTES = 8_192;
export const MAX_BODY_FETCHES = 80;

const TEXT_TYPES = new Set([
  "application/json",
  "application/problem+json",
  "application/graphql+json",
  "application/graphql-response+json",
  "application/xml",
  "text/xml",
  "text/plain",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/x-www-form-urlencoded",
  "application/xhtml+xml",
]);

const SENSITIVE_PATH =
  /\/(auth|login|logout|signin|sign-in|signup|sign-up|oauth|token|session|sessions|password|reset|payment|payments|checkout|billing|card|cards|wallet)(\/|$)/i;

/**
 * Decides whether a response body may be stored.
 * Capture is opt-in. Authentication and payment paths are never stored.
 */
export function responseBodyDecision(input: {
  captureEnabled: boolean;
  url: string;
  mimeType: string | null;
}): { store: boolean; reason: string | null } {
  if (!input.captureEnabled) {
    return { store: false, reason: "Body capture was not enabled for this scan." };
  }
  if (isSensitivePath(input.url)) {
    return { store: false, reason: "Response bodies are not stored for authentication or payment paths." };
  }
  const mime = input.mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mime) {
    return { store: true, reason: null };
  }
  if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/") || mime.startsWith("font/")) {
    return { store: false, reason: "Binary content is not stored." };
  }
  if (
    mime === "application/octet-stream" ||
    mime === "application/pdf" ||
    mime === "application/zip" ||
    mime === "application/wasm" ||
    mime === "application/gzip"
  ) {
    return { store: false, reason: "Binary content is not stored." };
  }
  if (TEXT_TYPES.has(mime) || mime.startsWith("text/") || mime.endsWith("+json") || mime.endsWith("+xml")) {
    return { store: true, reason: null };
  }
  return { store: false, reason: `Content type ${mime} is not stored.` };
}

export function isSensitivePath(url: string): boolean {
  try {
    return SENSITIVE_PATH.test(new URL(url).pathname);
  } catch {
    return SENSITIVE_PATH.test(url);
  }
}

export function prepareResponseText(
  body: string,
  base64Encoded: boolean,
): { text: string | null; truncated: boolean; omittedReason: string | null } {
  if (base64Encoded) {
    return { text: null, truncated: false, omittedReason: "Binary content is not stored." };
  }
  if (body.includes("\u0000")) {
    return { text: null, truncated: false, omittedReason: "Binary content is not stored." };
  }
  const bytes = new TextEncoder().encode(body);
  if (bytes.byteLength <= MAX_RESPONSE_BODY_BYTES) {
    return { text: body, truncated: false, omittedReason: null };
  }
  return {
    text: new TextDecoder().decode(bytes.slice(0, MAX_RESPONSE_BODY_BYTES)),
    truncated: true,
    omittedReason: null,
  };
}

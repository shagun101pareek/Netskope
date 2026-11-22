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

/** Returns a copy safe to store. Sensitive values are replaced, never logged through. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  const entries = Object.entries(headers).slice(0, MAX_HEADERS);

  for (const [key, value] of entries) {
    const name = key.toLowerCase();
    if (isSensitive(name)) {
      redacted[name] = "[redacted]";
      continue;
    }
    redacted[name] =
      value.length > MAX_HEADER_VALUE_LENGTH ? value.slice(0, MAX_HEADER_VALUE_LENGTH) : value;
  }

  return redacted;
}

function isSensitive(name: string): boolean {
  return SENSITIVE_HEADERS.has(name) || name.includes("token") || name.includes("secret");
}

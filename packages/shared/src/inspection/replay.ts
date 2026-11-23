import { isSensitiveHeader } from "./redact";

const METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_HEADERS = 40;
const MAX_BODY = 8_192;

export interface ReplayDraft {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  confirmed: boolean;
  confirmMutation: boolean;
  sendCredentials: boolean;
}

export type PreparedReplay =
  | { ok: true; method: string; headers: Record<string, string>; body: string | null; mutating: boolean }
  | { ok: false; message: string };

/**
 * Checks a user-authored replay before it is queued.
 * Captured cookie and authorization values are not copied in by this function.
 * Placeholder "[redacted]" values are dropped so they are never sent.
 */
export function prepareReplayRequest(draft: ReplayDraft): PreparedReplay {
  if (!draft.confirmed) {
    return { ok: false, message: "Confirm the replay before it is sent." };
  }
  const method = draft.method.toUpperCase();
  if (!METHODS.has(method)) {
    return { ok: false, message: "Method must be GET, HEAD, OPTIONS, POST, PUT, PATCH, or DELETE." };
  }
  if (draft.url.length === 0 || draft.url.length > 2048) {
    return { ok: false, message: "Enter an absolute http or https URL." };
  }
  const mutating = MUTATING.has(method);
  if (mutating && !draft.confirmMutation) {
    return { ok: false, message: "Confirm that this state-changing request should be sent." };
  }
  if (draft.body && draft.body.length > MAX_BODY) {
    return { ok: false, message: "Replay body must be 8192 characters or fewer." };
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(draft.headers).slice(0, MAX_HEADERS)) {
    const key = name.toLowerCase().trim();
    if (!key || key === "host" || key === "content-length" || key === "cookie" || key === "set-cookie") {
      continue;
    }
    if (!value || value === "[redacted]") {
      continue;
    }
    if (isSensitiveHeader(key) && !draft.sendCredentials) {
      continue;
    }
    if (isSensitiveHeader(key) && draft.sendCredentials && (key === "cookie" || key === "set-cookie")) {
      continue;
    }
    headers[key] = value.slice(0, 512);
  }

  return {
    ok: true,
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? null : draft.body,
    mutating,
  };
}

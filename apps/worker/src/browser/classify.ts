export type RequestClassName = "DOCUMENT" | "STATIC" | "API" | "OTHER";

const STATIC_TYPES = new Set([
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "texttrack",
  "manifest",
]);

const API_TYPES = new Set(["xhr", "fetch", "eventsource", "websocket", "preflight", "ping"]);

const API_MIME_TYPES = new Set([
  "application/json",
  "application/problem+json",
  "application/graphql+json",
  "application/graphql-response+json",
  "application/xml",
  "text/xml",
]);

/**
 * Classifies one observed request. The document resource type wins, then known
 * static types, then API transport types, then response content type and path.
 */
export function classifyExchange(input: {
  resourceType: string | null;
  mimeType: string | null;
  url: string;
}): RequestClassName {
  const resourceType = input.resourceType?.toLowerCase() ?? "";
  if (resourceType === "document") {
    return "DOCUMENT";
  }
  if (STATIC_TYPES.has(resourceType)) {
    return "STATIC";
  }
  if (API_TYPES.has(resourceType) || isApiMime(input.mimeType) || isApiPath(input.url)) {
    return "API";
  }
  return "OTHER";
}

function isApiMime(mimeType: string | null): boolean {
  if (!mimeType) {
    return false;
  }
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return API_MIME_TYPES.has(base) || base.endsWith("+json") || base.endsWith("+xml");
}

function isApiPath(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.includes("/api/") || path.includes("/graphql") || /^\/v\d+\//.test(path);
  } catch {
    return false;
  }
}

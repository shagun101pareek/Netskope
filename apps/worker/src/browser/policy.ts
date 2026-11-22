import { UrlPolicyError, assertSafeScanUrl } from "@netskope/shared/url-policy";

export type RequestDecision = "allow" | "skip" | "block";

const SKIPPED_PROTOCOLS = new Set(["data:", "blob:", "about:"]);

/**
 * Allows a request to continue, ignores non-network URLs, or blocks it.
 * Blocked requests are aborted before Chromium connects.
 */
export async function classifyRequest(rawUrl: string): Promise<RequestDecision> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "block";
  }

  if (SKIPPED_PROTOCOLS.has(url.protocol)) {
    return "skip";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "block";
  }

  try {
    await assertSafeScanUrl(rawUrl);
    return "allow";
  } catch (error) {
    if (error instanceof UrlPolicyError) {
      return "block";
    }
    throw error;
  }
}

/**
 * Remembers host decisions for one scan so a page does not repeat DNS lookups.
 * A different host, including a redirect target, is resolved again.
 */
export function createRequestClassifier(): (rawUrl: string) => Promise<RequestDecision> {
  const decisions = new Map<string, RequestDecision>();

  return async (rawUrl: string) => {
    const key = cacheKey(rawUrl);
    if (key) {
      const cached = decisions.get(key);
      if (cached) {
        return cached;
      }
    }

    const decision = await classifyRequest(rawUrl);
    if (key && decision !== "skip") {
      decisions.set(key, decision);
    }
    return decision;
  };
}

function cacheKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.username !== "" || url.password !== "") {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

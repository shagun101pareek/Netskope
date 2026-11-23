import { ReplayStatus, prisma, type Prisma } from "@netskope/database";
import { MAX_RESPONSE_BODY_BYTES, prepareReplayRequest, redactPayload, responseBodyDecision } from "@netskope/shared/inspection";
import { UrlPolicyError, assertSafeScanUrl } from "@netskope/shared/url-policy";

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 65_536;

/**
 * Sends one confirmed replay outside the API process.
 * Each hop is checked against the same URL policy as a scan, including DNS.
 */
export async function executeReplay(replayId: string): Promise<void> {
  const replay = await prisma.requestReplay.findUnique({
    where: { id: replayId },
    include: { request: { include: { response: true, timing: true } } },
  });
  if (!replay || replay.status === ReplayStatus.COMPLETED || replay.status === ReplayStatus.FAILED) {
    return;
  }

  const prepared = prepareReplayRequest({
    method: replay.method,
    url: replay.url,
    headers: headerRecord(replay.headers),
    body: replay.body,
    confirmed: true,
    confirmMutation: replay.confirmMutation,
    sendCredentials: replay.sendCredentials,
  });
  if (!prepared.ok) {
    await markFailed(replayId, prepared.message, null);
    return;
  }

  await prisma.requestReplay.update({
    where: { id: replayId },
    data: { status: ReplayStatus.RUNNING },
  });

  const started = Date.now();
  try {
    const result = await sendWithRedirects(prepared.method, replay.url, prepared.headers, prepared.body);
    const decision = responseBodyDecision({
      captureEnabled: true,
      url: result.finalUrl,
      mimeType: result.contentType,
    });
    let excerpt: string | null = null;
    if (decision.store && result.body !== null) {
      excerpt = redactPayload(result.body, result.contentType, MAX_RESPONSE_BODY_BYTES).text;
    }
    await prisma.requestReplay.update({
      where: { id: replayId },
      data: {
        status: ReplayStatus.COMPLETED,
        replayStatus: result.status,
        replayDuration: Date.now() - started,
        originalStatus: replay.request.response?.statusCode ?? null,
        originalDuration: replay.request.timing?.totalDuration ?? null,
        responseExcerpt: excerpt,
        errorMessage: result.truncated ? "The replay response was truncated to 64 KB." : decision.store ? null : decision.reason,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    const message = error instanceof UrlPolicyError || error instanceof Error ? safeMessage(error.message) : "The replay failed.";
    await markFailed(replayId, message, Date.now() - started);
  }
}

async function sendWithRedirects(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | null,
): Promise<{ status: number; body: string | null; contentType: string | null; truncated: boolean; finalUrl: string }> {
  let current = await assertSafeScanUrl(url);
  let nextMethod = method;
  let nextBody = body;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      method: nextMethod,
      headers,
      body: nextMethod === "GET" || nextMethod === "HEAD" ? undefined : (nextBody ?? undefined),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) {
        return { status: response.status, body: null, contentType: null, truncated: false, finalUrl: current };
      }
      if (hop === MAX_REDIRECTS) {
        throw new UrlPolicyError("The replay followed too many redirects.");
      }
      const nextUrl = await assertSafeScanUrl(new URL(location, current).toString());
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && nextMethod !== "GET" && nextMethod !== "HEAD")) {
        nextMethod = "GET";
        nextBody = null;
      }
      current = nextUrl;
      continue;
    }
    const read = await readLimited(response);
    return {
      status: response.status,
      body: read.text,
      contentType: response.headers.get("content-type"),
      truncated: read.truncated,
      finalUrl: current,
    };
  }
  throw new UrlPolicyError("The replay followed too many redirects.");
}

async function readLimited(response: Response): Promise<{ text: string | null; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: null, truncated: false };
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  while (received < MAX_BYTES) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    if (!chunk.value) {
      continue;
    }
    const room = MAX_BYTES - received;
    if (chunk.value.byteLength > room) {
      chunks.push(chunk.value.slice(0, room));
      received += room;
      truncated = true;
      break;
    }
    chunks.push(chunk.value);
    received += chunk.value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = concat(chunks);
  if (bytes.includes(0)) {
    return { text: null, truncated };
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

async function markFailed(replayId: string, message: string, duration: number | null): Promise<void> {
  await prisma.requestReplay.update({
    where: { id: replayId },
    data: {
      status: ReplayStatus.FAILED,
      errorMessage: message,
      replayDuration: duration,
      completedAt: new Date(),
    },
  });
}

function headerRecord(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(value)) {
    if (typeof header === "string") {
      headers[key] = header;
    }
  }
  return headers;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function safeMessage(message: string): string {
  const line = message.split("\n")[0]?.trim() ?? "";
  if (line.length === 0 || line.length > 300) {
    return "The replay failed.";
  }
  return line;
}

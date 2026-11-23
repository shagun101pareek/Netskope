import { RequestClass, ScanStatus, prisma, type Prisma } from "@netskope/database";
import {
  MAX_BODY_FETCHES,
  MAX_RESPONSE_BODY_BYTES,
  prepareResponseText,
  redactPayload,
  responseBodyDecision,
} from "@netskope/shared/inspection";
import { UrlPolicyError, assertSafeScanUrl } from "@netskope/shared/url-policy";
import type { Logger } from "pino";
import type { CDPSession } from "playwright";
import { classifyExchange } from "./classify.js";
import { createNetworkCollector, type CapturedExchange } from "./cdp-network.js";
import { PermanentScanError } from "./errors.js";
import { createRequestClassifier } from "./policy.js";
import { launchBrowser } from "./session.js";

const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_MS = 1_500;
const SCAN_TIMEOUT_MS = 45_000;
const MAX_PAYLOAD_BYTES = 8_192;

/**
 * Loads the scan URL in a fresh browser context and stores the network
 * activity reported by the Chrome DevTools Protocol. Request ids are the
 * protocol ids. Timing phases come from that protocol's timing block.
 */
export async function captureScan(scanId: string, logger: Logger): Promise<number> {
  const scan = await prisma.scan.findUnique({ where: { id: scanId } });
  if (!scan) {
    throw new Error(`Scan ${scanId} does not exist`);
  }
  if (scan.status === ScanStatus.COMPLETED || scan.status === ScanStatus.FAILED) {
    return 0;
  }
  if (scan.status !== ScanStatus.RUNNING) {
    throw new Error(`Scan ${scanId} is not running`);
  }

  let safeUrl: string;
  try {
    safeUrl = await assertSafeScanUrl(scan.url);
  } catch (error) {
    if (error instanceof UrlPolicyError) {
      throw new PermanentScanError(error.message);
    }
    throw error;
  }

  await prisma.networkRequest.deleteMany({ where: { scanId } });

  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    acceptDownloads: false,
  });
  const timeout = setTimeout(() => {
    void context.close().catch(() => undefined);
  }, SCAN_TIMEOUT_MS);

  let detachSession: (() => Promise<void>) | undefined;

  try {
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    detachSession = () => session.detach();
    const collector = createNetworkCollector();
    session.on("Network.requestWillBeSent", (params) => {
      collector.requestWillBeSent(params);
    });
    session.on("Network.requestWillBeSentExtraInfo", (params) => {
      collector.requestWillBeSentExtraInfo(params);
    });
    session.on("Network.responseReceived", (params) => {
      collector.responseReceived(params);
    });
    session.on("Network.responseReceivedExtraInfo", (params) => {
      collector.responseReceivedExtraInfo(params);
    });
    session.on("Network.loadingFinished", (params) => {
      collector.loadingFinished(params);
    });
    session.on("Network.loadingFailed", (params) => {
      collector.loadingFailed(params);
    });
    await session.send("Network.enable", { maxPostDataSize: MAX_PAYLOAD_BYTES });
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });

    const classify = createRequestClassifier();
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const decision = await classify(request.url());
        if (decision === "block") {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      } catch (error) {
        logger.warn({ err: error, scanId }, "request blocked after a policy check failed");
        await route.abort("blockedbyclient").catch(() => undefined);
      }
    });

    try {
      await page.goto(safeUrl, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      if (isBlockedNavigation(error)) {
        throw new PermanentScanError(
          "The browser was redirected to a destination that is not eligible for scanning.",
        );
      }
      throw error;
    }

    await delay(SETTLE_MS);
    await attachCapturedBodies(session, collector, scan.captureBodies);

    const records = collector.records();
    if (records.length === 0) {
      throw new Error("The page loaded but no network requests were captured.");
    }
    if (collector.truncated()) {
      logger.warn({ scanId, kept: records.length }, "scan request list was truncated");
    }

    await persistCapture(scanId, records);
    logger.info({ scanId, requests: records.length }, "scan captured network activity");
    return records.length;
  } finally {
    clearTimeout(timeout);
    await detachSession?.().catch((error: unknown) => {
      logger.warn({ err: error, scanId }, "browser protocol session close failed");
    });
    await context.close().catch((error: unknown) => {
      logger.warn({ err: error, scanId }, "browser context close failed");
    });
  }
}

function isBlockedNavigation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ERR_BLOCKED_BY_CLIENT");
}

async function persistCapture(scanId: string, records: CapturedExchange[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const record of records) {
      await tx.networkRequest.create({
        data: {
          scanId,
          requestId: record.requestId,
          url: record.url,
          method: record.method,
          resourceType: record.resourceType,
          requestClass: RequestClass[classifyExchange({
            resourceType: record.resourceType,
            mimeType: record.response?.mimeType ?? null,
            url: record.url,
          })],
          requestHeaders: record.requestHeaders,
          requestPayload: record.requestPayload,
          requestPayloadTruncated: record.requestPayloadTruncated,
          requestBodyOmittedReason: record.requestBodyOmittedReason,
          requestSize: record.requestSize,
          queryParams: record.queryParams as Prisma.InputJsonValue | undefined,
          initiator: record.initiator as Prisma.InputJsonValue | undefined,
          timestamp: record.timestamp,
          failureReason: record.failureReason,
          redirectChain: record.redirectChain as Prisma.InputJsonValue | undefined,
          response: record.response
            ? {
                create: {
                  statusCode: record.response.statusCode,
                  statusText: record.response.statusText,
                  remoteAddress: record.response.remoteAddress,
                  responseHeaders: record.response.responseHeaders,
                  mimeType: record.response.mimeType,
                  bodySize: record.response.bodySize,
                  responseBody: record.response.responseBody,
                  bodyOmittedReason: record.response.bodyOmittedReason,
                  bodyTruncated: record.response.bodyTruncated,
                },
              }
            : undefined,
          timing: record.timing
            ? {
                create: {
                  dnsTime: record.timing.dnsTime,
                  connectTime: record.timing.connectTime,
                  tlsTime: record.timing.tlsTime,
                  ttfb: record.timing.ttfb,
                  downloadTime: record.timing.downloadTime,
                  totalDuration: record.timing.totalDuration,
                  timingMetadata: record.timing.timingMetadata as Prisma.InputJsonValue | undefined,
                },
              }
            : undefined,
        },
      });
    }

    const completed = await tx.scan.updateMany({
      where: { id: scanId, status: ScanStatus.RUNNING },
      data: {
        status: ScanStatus.COMPLETED,
        completedAt: new Date(),
        errorMessage: null,
      },
    });

    if (completed.count !== 1) {
      throw new Error(`Scan ${scanId} was not running when capture finished`);
    }
  });
}

async function attachCapturedBodies(
  session: CDPSession,
  collector: ReturnType<typeof createNetworkCollector>,
  captureEnabled: boolean,
): Promise<void> {
  const targets = collector.bodyTargets();
  for (const target of targets.slice(MAX_BODY_FETCHES)) {
    collector.setResponseBody(target.requestId, {
      text: null,
      truncated: false,
      omittedReason: "Body capture limit reached for this scan.",
    });
  }

  for (const target of targets.slice(0, MAX_BODY_FETCHES)) {
    const decision = responseBodyDecision({
      captureEnabled,
      url: target.url,
      mimeType: target.mimeType,
    });
    if (!decision.store) {
      collector.setResponseBody(target.requestId, { text: null, truncated: false, omittedReason: decision.reason });
      continue;
    }
    try {
      const result = await session.send("Network.getResponseBody", { requestId: target.requestId });
      const prepared = prepareResponseText(result.body, result.base64Encoded);
      if (!prepared.text) {
        collector.setResponseBody(target.requestId, {
          text: null,
          truncated: false,
          omittedReason: prepared.omittedReason,
        });
        continue;
      }
      const redacted = redactPayload(prepared.text, target.mimeType, MAX_RESPONSE_BODY_BYTES);
      collector.setResponseBody(target.requestId, {
        text: redacted.text,
        truncated: prepared.truncated || redacted.truncated,
        omittedReason: redacted.omittedReason,
      });
    } catch {
      collector.setResponseBody(target.requestId, {
        text: null,
        truncated: false,
        omittedReason: "The browser did not provide a response body.",
      });
    }
  }

  for (const missing of collector.missingPayloads().slice(0, 40)) {
    try {
      const result = await session.send("Network.getRequestPostData", { requestId: missing.requestId });
      collector.setRequestPayload(missing.requestId, result.postData);
    } catch {
      // Chrome does not keep a body for every request.
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

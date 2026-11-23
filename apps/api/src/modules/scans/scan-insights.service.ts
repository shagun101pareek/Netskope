import { Prisma, RequestClass, prisma } from "@netskope/database";
import { compareEndpoints, isApiObservation, median, percentile, regressionTests, round as roundMs } from "@netskope/shared/inspection";
import { AppError } from "../../lib/errors.js";
import { toObservedCall, type InsightRow } from "./observe.js";
import { getScan } from "./scans.service.js";

const REQUEST_CLASSES = new Set(["DOCUMENT", "STATIC", "API", "OTHER"]);
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export interface RequestSummary {
  id: string;
  requestId: string;
  url: string;
  method: string;
  resourceType: string | null;
  requestClass: string | null;
  timestamp: string;
  failureReason: string | null;
  statusCode: number | null;
  mimeType: string | null;
  bodySize: number | null;
  totalDuration: number | null;
}

export interface RequestDetail extends RequestSummary {
  requestHeaders: unknown;
  requestPayload: string | null;
  requestPayloadTruncated: boolean;
  requestBodyOmittedReason: string | null;
  requestSize: number | null;
  queryParams: unknown;
  responseHeaders: unknown;
  statusText: string | null;
  remoteAddress: string | null;
  responseBody: string | null;
  bodyOmittedReason: string | null;
  bodyTruncated: boolean;
  initiator: unknown;
  redirectChain: unknown;
  timing: {
    dnsTime: number | null;
    connectTime: number | null;
    tlsTime: number | null;
    ttfb: number | null;
    downloadTime: number | null;
    totalDuration: number | null;
    timingMetadata: unknown;
  } | null;
}

export interface AnalyticsReport {
  requestCount: number;
  failedCount: number;
  averageLatencyMs: number | null;
  duplicateGroups: number;
  duplicates: { method: string; url: string; count: number }[];
  slow: { method: string; url: string; totalDuration: number; statusCode: number | null }[];
  distribution: { label: string; count: number }[];
  apiRequestCount: number;
  successfulApiCount: number;
  failedApiCount: number;
  successRate: number | null;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  slowestEndpoints: { key: string; totalDuration: number; statusCode: number | null }[];
  frequentEndpoints: { key: string; count: number }[];
  largestResponses: { method: string; url: string; bodySize: number }[];
  thirdPartyCount: number;
  thirdPartyDomains: { host: string; count: number }[];
  statusDistribution: { label: string; count: number }[];
  resourceDistribution: { label: string; count: number }[];
  requestsOverTime: { label: string; count: number }[];
}

type StoredRequest = InsightRow;

const include = { response: true, timing: true } as const;

export async function listScanRequests(
  userId: string,
  scanId: string,
  query: {
    q?: string;
    method?: string;
    status?: string;
    requestClass?: string;
    sort?: string;
    limit?: string;
    initiator?: string;
  },
): Promise<{ requests: RequestSummary[] }> {
  await getScan(userId, scanId);
  const where: Prisma.NetworkRequestWhereInput = { scanId };
  if (query.q) {
    where.url = { contains: query.q, mode: "insensitive" };
  }
  if (query.method) {
    where.method = query.method.toUpperCase();
  }
  if (query.requestClass) {
    if (!REQUEST_CLASSES.has(query.requestClass)) {
      throw new AppError(400, "VALIDATION_ERROR", "requestClass is not valid.");
    }
    where.requestClass = query.requestClass as RequestClass;
  }
  applyStatusFilter(where, query.status);

  const rows = await prisma.networkRequest.findMany({
    where,
    include,
    orderBy: { timestamp: "asc" },
  });
  const initiated = query.initiator
    ? rows.filter((row) => JSON.stringify(row.initiator ?? "").toLowerCase().includes(query.initiator?.toLowerCase() ?? ""))
    : rows;
  const sorted = sortRows(initiated, query.sort).slice(0, parseRequestLimit(query.limit));

  return { requests: sorted.map(summarize) };
}

export async function getScanRequest(userId: string, scanId: string, requestRowId: string): Promise<RequestDetail> {
  await getScan(userId, scanId);
  const row = await prisma.networkRequest.findFirst({
    where: { id: requestRowId, scanId },
    include,
  });
  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Request not found.");
  }
  return detail(row);
}

export async function scanAnalytics(userId: string, scanId: string): Promise<AnalyticsReport> {
  const scan = await getScan(userId, scanId);
  const rows = await loadRows(scanId);
  const durations = rows.map((row) => row.timing?.totalDuration).filter((value): value is number => value !== null && value !== undefined);
  const groups = new Map<string, { method: string; url: string; count: number }>();
  for (const row of rows) {
    const key = `${row.method} ${row.url}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { method: row.method, url: row.url, count: 1 });
    }
  }
  const duplicates = [...groups.values()].filter((group) => group.count > 1).sort((a, b) => b.count - a.count).slice(0, 20);
  const slow = rows
    .filter((row) => row.timing?.totalDuration !== null && row.timing?.totalDuration !== undefined)
    .sort((a, b) => (b.timing?.totalDuration ?? 0) - (a.timing?.totalDuration ?? 0))
    .slice(0, 5)
    .map((row) => ({
      method: row.method,
      url: row.url,
      totalDuration: row.timing?.totalDuration ?? 0,
      statusCode: row.response?.statusCode ?? null,
    }));

  return {
    requestCount: rows.length,
    failedCount: rows.filter(isFailed).length,
    averageLatencyMs: durations.length === 0 ? null : round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    duplicateGroups: duplicates.length,
    duplicates,
    slow,
    distribution: distribution(rows),
    ...apiAnalytics(rows, scan.url),
  };
}

export async function compareScans(userId: string, leftId: string, rightId: string) {
  if (leftId === rightId) {
    throw new AppError(400, "VALIDATION_ERROR", "Choose two different scans.");
  }
  const left = await getScan(userId, leftId);
  const right = await getScan(userId, rightId);
  const [leftRows, rightRows] = await Promise.all([loadRows(leftId), loadRows(rightId)]);
  const leftCalls = leftRows.map((row) => toObservedCall(row, left.captureBodies));
  const rightCalls = rightRows.map((row) => toObservedCall(row, right.captureBodies));
  const leftMap = durationMap(leftRows);
  const rightMap = durationMap(rightRows);
  const onlyLeft = [...leftMap.keys()].filter((key) => !rightMap.has(key)).slice(0, 50);
  const onlyRight = [...rightMap.keys()].filter((key) => !leftMap.has(key)).slice(0, 50);
  const deltas = [...leftMap.keys()]
    .filter((key) => rightMap.has(key))
    .map((key) => ({
      key,
      leftMs: leftMap.get(key) ?? null,
      rightMs: rightMap.get(key) ?? null,
    }))
    .filter((item) => item.leftMs !== null && item.rightMs !== null)
    .map((item) => ({ key: item.key, leftMs: item.leftMs as number, rightMs: item.rightMs as number, delta: (item.rightMs as number) - (item.leftMs as number) }));

  return {
    left: summaryOf(left.id, left.url, leftRows),
    right: summaryOf(right.id, right.url, rightRows),
    onlyLeft,
    onlyRight,
    slowerOnRight: deltas.filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10),
    fasterOnRight: deltas.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10),
    endpointChanges: compareEndpoints(leftCalls, rightCalls),
    regressions: regressionTests(leftCalls, rightCalls),
  };
}

export async function exportScan(userId: string, scanId: string, format: string | undefined): Promise<{ body: string; contentType: string; filename: string }> {
  const scan = await getScan(userId, scanId);
  const rows = await loadRows(scanId);
  if (format === "csv") {
    return {
      body: toCsv(rows),
      contentType: "text/csv; charset=utf-8",
      filename: `scan-${scan.id}.csv`,
    };
  }
  if (format !== undefined && format !== "json") {
    throw new AppError(400, "VALIDATION_ERROR", "format must be json or csv.");
  }
  return {
    body: JSON.stringify({ scan, requests: rows.map(detail) }, null, 2),
    contentType: "application/json; charset=utf-8",
    filename: `scan-${scan.id}.json`,
  };
}

async function loadRows(scanId: string): Promise<StoredRequest[]> {
  return prisma.networkRequest.findMany({
    where: { scanId },
    include,
    orderBy: { timestamp: "asc" },
  });
}

function summarize(row: StoredRequest): RequestSummary {
  return {
    id: row.id,
    requestId: row.requestId,
    url: row.url,
    method: row.method,
    resourceType: row.resourceType,
    requestClass: row.requestClass,
    timestamp: row.timestamp.toISOString(),
    failureReason: row.failureReason,
    statusCode: row.response?.statusCode ?? null,
    mimeType: row.response?.mimeType ?? null,
    bodySize: row.response?.bodySize ?? null,
    totalDuration: row.timing?.totalDuration ?? null,
  };
}

function detail(row: StoredRequest): RequestDetail {
  return {
    ...summarize(row),
    requestHeaders: row.requestHeaders,
    requestPayload: row.requestPayload,
    requestPayloadTruncated: row.requestPayloadTruncated ?? false,
    requestBodyOmittedReason: row.requestBodyOmittedReason ?? null,
    requestSize: row.requestSize ?? null,
    queryParams: row.queryParams ?? null,
    responseHeaders: row.response?.responseHeaders ?? null,
    statusText: row.response?.statusText ?? null,
    remoteAddress: row.response?.remoteAddress ?? null,
    responseBody: row.response?.responseBody ?? null,
    bodyOmittedReason: row.response?.bodyOmittedReason ?? null,
    bodyTruncated: row.response?.bodyTruncated ?? false,
    initiator: row.initiator,
    redirectChain: row.redirectChain,
    timing: row.timing
      ? {
          dnsTime: row.timing.dnsTime,
          connectTime: row.timing.connectTime,
          tlsTime: row.timing.tlsTime,
          ttfb: row.timing.ttfb,
          downloadTime: row.timing.downloadTime,
          totalDuration: row.timing.totalDuration,
          timingMetadata: row.timing.timingMetadata ?? null,
        }
      : null,
  };
}

function applyStatusFilter(where: Prisma.NetworkRequestWhereInput, status: string | undefined): void {
  if (!status) {
    return;
  }
  if (status === "failed") {
    where.OR = [{ failureReason: { not: null } }, { response: { statusCode: { gte: 400 } } }];
    return;
  }
  const range = statusRange(status);
  if (range) {
    where.response = { statusCode: range };
    return;
  }
  throw new AppError(400, "VALIDATION_ERROR", "status must be failed, 2xx, 3xx, 4xx, 5xx, or a status code.");
}

function statusRange(status: string): { gte: number; lt?: number; lte?: number } | { equals: number } | null {
  if (/^[1-5]xx$/.test(status)) {
    const start = Number(status[0]) * 100;
    return { gte: start, lt: start + 100 };
  }
  if (/^\d{3}$/.test(status)) {
    return { equals: Number(status) };
  }
  return null;
}

function sortRows(rows: StoredRequest[], sort: string | undefined): StoredRequest[] {
  const copy = [...rows];
  if (sort === "duration") {
    return copy.sort((a, b) => (b.timing?.totalDuration ?? -1) - (a.timing?.totalDuration ?? -1));
  }
  if (sort === "url") {
    return copy.sort((a, b) => a.url.localeCompare(b.url));
  }
  if (sort === "status") {
    return copy.sort((a, b) => (a.response?.statusCode ?? 999) - (b.response?.statusCode ?? 999));
  }
  return copy;
}

function parseRequestLimit(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new AppError(400, "VALIDATION_ERROR", "limit must be an integer from 1 to 500.");
  }
  return parsed;
}

function isFailed(row: StoredRequest): boolean {
  return row.failureReason !== null || (row.response?.statusCode ?? 0) >= 400;
}

function distribution(rows: StoredRequest[]): { label: string; count: number }[] {
  const buckets = [
    { label: "<50ms", count: 0 },
    { label: "50-100ms", count: 0 },
    { label: "100-300ms", count: 0 },
    { label: "300-1000ms", count: 0 },
    { label: ">1000ms", count: 0 },
    { label: "unknown", count: 0 },
  ];
  for (const row of rows) {
    const duration = row.timing?.totalDuration;
    if (duration === null || duration === undefined) {
      buckets[5]!.count += 1;
    } else if (duration < 50) {
      buckets[0]!.count += 1;
    } else if (duration < 100) {
      buckets[1]!.count += 1;
    } else if (duration < 300) {
      buckets[2]!.count += 1;
    } else if (duration < 1000) {
      buckets[3]!.count += 1;
    } else {
      buckets[4]!.count += 1;
    }
  }
  return buckets;
}

function durationMap(rows: StoredRequest[]): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const row of rows) {
    const key = `${row.method} ${row.url}`;
    const duration = row.timing?.totalDuration ?? null;
    const existing = map.get(key);
    if (existing === undefined || (duration !== null && (existing === null || duration > existing))) {
      map.set(key, duration);
    }
  }
  return map;
}

function summaryOf(id: string, url: string, rows: StoredRequest[]) {
  const durations = rows.map((row) => row.timing?.totalDuration).filter((value): value is number => value !== null && value !== undefined);
  return {
    id,
    url,
    requestCount: rows.length,
    failedCount: rows.filter(isFailed).length,
    averageLatencyMs: durations.length === 0 ? null : round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
  };
}

function toCsv(rows: StoredRequest[]): string {
  const header = ["method", "url", "requestClass", "statusCode", "failureReason", "totalDuration"];
  const lines = rows.map((row) =>
    [row.method, row.url, row.requestClass ?? "", row.response?.statusCode ?? "", row.failureReason ?? "", row.timing?.totalDuration ?? ""]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function round(value: number): number {
  return roundMs(value);
}

function apiAnalytics(rows: StoredRequest[], pageUrl: string): Omit<
  AnalyticsReport,
  "requestCount" | "failedCount" | "averageLatencyMs" | "duplicateGroups" | "duplicates" | "slow" | "distribution"
> {
  let pageHost = "";
  try {
    pageHost = new URL(pageUrl).host;
  } catch {
    pageHost = "";
  }
  const apiRows = rows.filter((row) => isApiObservation(toObservedCall(row, false)));
  const apiDurations = apiRows.map((row) => row.timing?.totalDuration).filter((value): value is number => value !== null && value !== undefined);
  const successful = apiRows.filter((row) => !isFailed(row)).length;
  const endpointLatency = new Map<string, { key: string; totalDuration: number; statusCode: number | null }>();
  const endpointCounts = new Map<string, number>();
  for (const row of apiRows) {
    const key = `${row.method} ${safePath(row.url)}`;
    endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
    const duration = row.timing?.totalDuration;
    if (duration === null || duration === undefined) {
      continue;
    }
    const existing = endpointLatency.get(key);
    if (!existing || duration > existing.totalDuration) {
      endpointLatency.set(key, { key, totalDuration: duration, statusCode: row.response?.statusCode ?? null });
    }
  }
  const domains = new Map<string, number>();
  let thirdPartyCount = 0;
  for (const row of rows) {
    const host = safeHost(row.url);
    if (!host || host === pageHost || (pageHost && host.endsWith(`.${pageHost}`))) {
      continue;
    }
    thirdPartyCount += 1;
    domains.set(host, (domains.get(host) ?? 0) + 1);
  }
  return {
    apiRequestCount: apiRows.length,
    successfulApiCount: successful,
    failedApiCount: apiRows.length - successful,
    successRate: apiRows.length === 0 ? null : round((successful / apiRows.length) * 100),
    medianLatencyMs: median(apiDurations),
    p95LatencyMs: percentile(apiDurations, 0.95),
    p99LatencyMs: apiDurations.length >= 20 ? percentile(apiDurations, 0.99) : null,
    slowestEndpoints: [...endpointLatency.values()].sort((a, b) => b.totalDuration - a.totalDuration).slice(0, 5),
    frequentEndpoints: [...endpointCounts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    largestResponses: rows
      .filter((row) => row.response?.bodySize !== null && row.response?.bodySize !== undefined)
      .sort((a, b) => (b.response?.bodySize ?? 0) - (a.response?.bodySize ?? 0))
      .slice(0, 5)
      .map((row) => ({ method: row.method, url: row.url, bodySize: row.response?.bodySize ?? 0 })),
    thirdPartyCount,
    thirdPartyDomains: [...domains.entries()].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    statusDistribution: statusDistribution(rows),
    resourceDistribution: resourceDistribution(rows),
    requestsOverTime: overTime(rows),
  };
}

function statusDistribution(rows: StoredRequest[]): { label: string; count: number }[] {
  const buckets = [
    { label: "2xx", count: 0 },
    { label: "3xx", count: 0 },
    { label: "4xx", count: 0 },
    { label: "5xx", count: 0 },
    { label: "failed", count: 0 },
  ];
  for (const row of rows) {
    if (row.failureReason && row.response?.statusCode == null) {
      buckets[4]!.count += 1;
      continue;
    }
    const status = row.response?.statusCode ?? 0;
    if (status >= 500) buckets[3]!.count += 1;
    else if (status >= 400) buckets[2]!.count += 1;
    else if (status >= 300) buckets[1]!.count += 1;
    else if (status >= 200) buckets[0]!.count += 1;
    else buckets[4]!.count += 1;
  }
  return buckets;
}

function resourceDistribution(rows: StoredRequest[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = row.requestClass ?? row.resourceType ?? "unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

function overTime(rows: StoredRequest[]): { label: string; count: number }[] {
  if (rows.length === 0) {
    return [];
  }
  const start = rows[0]!.timestamp.getTime();
  const end = rows[rows.length - 1]!.timestamp.getTime();
  const span = Math.max(end - start, 1);
  const bucketCount = Math.min(12, rows.length);
  const width = span / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({ label: `${Math.round((index * width) / 1000)}s`, count: 0 }));
  for (const row of rows) {
    const index = Math.min(bucketCount - 1, Math.floor((row.timestamp.getTime() - start) / width));
    buckets[index]!.count += 1;
  }
  return buckets;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function safePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

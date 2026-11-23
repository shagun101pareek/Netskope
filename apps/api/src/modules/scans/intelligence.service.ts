import { Prisma, prisma } from "@netskope/database";
import {
  buildDependencyGraph,
  generateObservedTests,
  identifyEndpoint,
  inferSchema,
  isApiObservation,
  median,
  parseJsonBody,
  percentile,
  round,
  type GeneratedTest,
  type TestOverride,
} from "@netskope/shared/inspection";
import { AppError } from "../../lib/errors.js";
import { toObservedCall, type InsightRow } from "./observe.js";
import { getScan } from "./scans.service.js";

const include = { response: true, timing: true } as const;

export async function listEndpoints(
  userId: string,
  scanId: string,
  query: {
    method?: string;
    status?: string;
    domain?: string;
    resourceType?: string;
    endpoint?: string;
    failed?: string;
    slow?: string;
  },
) {
  const scan = await getScan(userId, scanId);
  const rows = await loadRows(scanId);
  const filtered = rows.filter((row) => isApiObservation(toObservedCall(row, scan.captureBodies)) && matches(row, query));
  const groups = new Map<string, InsightRow[]>();
  for (const row of filtered) {
    const identity = identifyEndpoint(row.method, row.url);
    const group = groups.get(identity.key) ?? [];
    group.push(row);
    groups.set(identity.key, group);
  }

  const endpoints = [...groups.entries()].map(([key, group]) => {
    const identity = identifyEndpoint(group[0]?.method ?? "GET", group[0]?.url ?? "");
    const durations = group.map((row) => row.timing?.totalDuration).filter((value): value is number => value !== null && value !== undefined);
    const sizes = group.map((row) => row.response?.bodySize).filter((value): value is number => value !== null && value !== undefined);
    const successes = group.filter((row) => !failed(row)).length;
    const latest = [...group].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    return {
      key,
      method: identity.method,
      host: identity.host,
      path: identity.path,
      calls: group.length,
      successCount: successes,
      failureCount: group.length - successes,
      averageLatencyMs: durations.length === 0 ? null : round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
      p95LatencyMs: percentile(durations, 0.95),
      averageResponseBytes: sizes.length === 0 ? null : round(sizes.reduce((sum, value) => sum + value, 0) / sizes.length),
      latestStatus: latest?.response?.statusCode ?? null,
      firstSeen: group.reduce((min, row) => (row.timestamp < min ? row.timestamp : min), group[0]!.timestamp).toISOString(),
      lastSeen: group.reduce((max, row) => (row.timestamp > max ? row.timestamp : max), group[0]!.timestamp).toISOString(),
    };
  });

  endpoints.sort((a, b) => b.calls - a.calls || a.key.localeCompare(b.key));
  return { endpoints };
}

export async function listInvocations(userId: string, scanId: string, key: string) {
  const scan = await getScan(userId, scanId);
  if (!key || key.length > 500) {
    throw new AppError(400, "VALIDATION_ERROR", "endpoint key is required.");
  }
  const rows = await loadRows(scanId);
  const matchesKey = rows.filter((row) => identifyEndpoint(row.method, row.url).key === key);
  return {
    key,
    invocations: matchesKey.map((row) => ({
      id: row.id,
      url: row.url,
      method: row.method,
      timestamp: row.timestamp.toISOString(),
      statusCode: row.response?.statusCode ?? null,
      totalDuration: row.timing?.totalDuration ?? null,
      bodySize: row.response?.bodySize ?? null,
      queryParams: row.queryParams ?? null,
      requestPreview: preview(row.requestPayload),
      responsePreview: preview(row.response?.responseBody ?? null),
      failureReason: row.failureReason,
      captureBodies: scan.captureBodies,
    })),
  };
}

export async function listSchemas(userId: string, scanId: string) {
  const scan = await getScan(userId, scanId);
  const rows = await loadRows(scanId);
  const groups = new Map<string, InsightRow[]>();
  for (const row of rows) {
    if (!isApiObservation(toObservedCall(row, scan.captureBodies))) {
      continue;
    }
    const key = identifyEndpoint(row.method, row.url).key;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return {
    schemas: [...groups.entries()].map(([key, group]) => ({
      key,
      method: group[0]?.method ?? "GET",
      request: inferSchema(group.map((row) => parseJsonBody(row.requestPayload)).filter((value) => value !== undefined)),
      response: inferSchema(group.map((row) => parseJsonBody(row.response?.responseBody ?? null)).filter((value) => value !== undefined)),
    })),
  };
}

export async function listTests(userId: string, scanId: string): Promise<{ tests: GeneratedTest[]; observedBehavior: true }> {
  const scan = await getScan(userId, scanId);
  const [rows, overrides] = await Promise.all([loadRows(scanId), loadOverrides(scanId)]);
  const tests = generateObservedTests(
    rows.map((row) => toObservedCall(row, scan.captureBodies)),
    overrides,
  );
  return { tests, observedBehavior: true };
}

export async function updateTest(userId: string, scanId: string, testKey: string, body: { enabled?: boolean; expected?: number }) {
  const current = await listTests(userId, scanId);
  const test = current.tests.find((item) => item.key === testKey);
  if (!test) {
    throw new AppError(404, "NOT_FOUND", "Test not found.");
  }
  if (body.expected !== undefined && (test.assertion.kind !== "statusEquals" && test.assertion.kind !== "maxDuration")) {
    throw new AppError(400, "VALIDATION_ERROR", "Only status and latency budgets can be edited.");
  }
  if (body.expected !== undefined && (!Number.isFinite(body.expected) || body.expected < 0 || body.expected > 600_000)) {
    throw new AppError(400, "VALIDATION_ERROR", "expected must be a number from 0 to 600000.");
  }
  const user = await prisma.scan.findFirst({ where: { id: scanId, userId }, select: { userId: true } });
  if (!user) {
    throw new AppError(404, "NOT_FOUND", "Scan not found.");
  }
  await prisma.testOverride.upsert({
    where: { scanId_testKey: { scanId, testKey } },
    create: {
      userId,
      scanId,
      testKey,
      enabled: body.enabled ?? true,
      assertion: body.expected === undefined ? undefined : { expected: body.expected },
    },
    update: {
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(body.expected === undefined ? {} : { assertion: { expected: body.expected } }),
    },
  });
  const refreshed = await listTests(userId, scanId);
  const updated = refreshed.tests.find((item) => item.key === testKey);
  if (!updated) {
    throw new AppError(404, "NOT_FOUND", "Test not found.");
  }
  return { test: updated };
}

export async function dependencyGraph(userId: string, scanId: string) {
  await getScan(userId, scanId);
  const rows = await loadRows(scanId);
  return buildDependencyGraph(
    rows.map((row) => ({
      id: row.id,
      requestId: row.requestId,
      method: row.method,
      url: row.url,
      resourceType: row.resourceType,
      statusCode: row.response?.statusCode ?? null,
      totalDuration: row.timing?.totalDuration ?? null,
      initiator: row.initiator,
    })),
  );
}

async function loadRows(scanId: string): Promise<InsightRow[]> {
  return prisma.networkRequest.findMany({
    where: { scanId },
    include,
    orderBy: { timestamp: "asc" },
  });
}

async function loadOverrides(scanId: string): Promise<Map<string, TestOverride>> {
  const rows = await prisma.testOverride.findMany({ where: { scanId } });
  const overrides = new Map<string, TestOverride>();
  for (const row of rows) {
    const expected = expectedOf(row.assertion);
    overrides.set(row.testKey, {
      enabled: row.enabled,
      ...(expected === undefined ? {} : { expected }),
    });
  }
  return overrides;
}

function expectedOf(value: Prisma.JsonValue): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("expected" in value)) {
    return undefined;
  }
  const expected = value.expected;
  return typeof expected === "number" ? expected : undefined;
}

function matches(row: InsightRow, query: { method?: string; status?: string; domain?: string; resourceType?: string; endpoint?: string; failed?: string; slow?: string }): boolean {
  if (query.method && row.method !== query.method.toUpperCase()) {
    return false;
  }
  if (query.resourceType && (row.resourceType ?? "").toLowerCase() !== query.resourceType.toLowerCase()) {
    return false;
  }
  if (query.domain) {
    try {
      if (new URL(row.url).host !== query.domain) {
        return false;
      }
    } catch {
      return false;
    }
  }
  if (query.endpoint && !identifyEndpoint(row.method, row.url).path.toLowerCase().includes(query.endpoint.toLowerCase())) {
    return false;
  }
  if (query.failed === "1" && !failed(row)) {
    return false;
  }
  if (query.slow === "1" && (row.timing?.totalDuration ?? 0) < 300) {
    return false;
  }
  if (query.status) {
    const status = row.response?.statusCode ?? null;
    if (query.status === "failed") {
      return failed(row);
    }
    if (/^[1-5]xx$/.test(query.status)) {
      const start = Number(query.status[0]) * 100;
      return status !== null && status >= start && status < start + 100;
    }
    if (/^\d{3}$/.test(query.status)) {
      return status === Number(query.status);
    }
    return false;
  }
  return true;
}

function failed(row: InsightRow): boolean {
  return row.failureReason !== null || (row.response?.statusCode ?? 0) >= 400;
}

function preview(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.slice(0, 500);
}

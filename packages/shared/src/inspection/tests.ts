import { createHash } from "node:crypto";
import { identifyEndpoint, isApiObservation, percentile, round } from "./endpoints";
import { diffFieldTypes, fieldTypes, parseJsonBody } from "./schema";

export type TestStatus = "passed" | "failed" | "skipped" | "error";
export type TestCategory = "contract" | "performance" | "reliability" | "regression";

export interface ObservedCall {
  method: string;
  url: string;
  requestClass: string | null;
  resourceType: string | null;
  statusCode: number | null;
  mimeType: string | null;
  failureReason: string | null;
  totalDuration: number | null;
  bodySize: number | null;
  responseBody: string | null;
  bodyOmittedReason: string | null;
  captureBodies: boolean;
}

export interface TestAssertion {
  kind: "statusEquals" | "contentTypeIncludes" | "fieldPresent" | "maxDuration" | "noServerError" | "noTransportFailure" | "schemaChange";
  expected: string | number;
  path?: string;
}

export interface GeneratedTest {
  key: string;
  name: string;
  description: string;
  endpoint: string;
  method: string;
  category: TestCategory;
  assertion: TestAssertion;
  expected: string;
  actual: string;
  status: TestStatus;
  failureReason: string | null;
  /** These tests describe what was captured, not an intended business contract. */
  observedBehavior: true;
}

export interface TestOverride {
  enabled?: boolean;
  expected?: string | number;
}

const DEFAULT_LATENCY_BUDGET_MS = 1000;

/**
 * Builds deterministic tests from captured calls.
 * Nothing here sends a request. Disabled overrides are reported as skipped.
 */
export function generateObservedTests(calls: ObservedCall[], overrides: Map<string, TestOverride> = new Map()): GeneratedTest[] {
  const groups = new Map<string, ObservedCall[]>();
  for (const call of calls) {
    if (!isApiObservation(call)) {
      continue;
    }
    const identity = identifyEndpoint(call.method, call.url);
    const group = groups.get(identity.key) ?? [];
    group.push(call);
    groups.set(identity.key, group);
  }

  const tests: GeneratedTest[] = [];
  for (const [endpoint, group] of groups) {
    const method = group[0]?.method ?? "GET";
    tests.push(...contractTests(endpoint, method, group));
    tests.push(...performanceTests(endpoint, method, group));
    tests.push(...reliabilityTests(endpoint, method, group));
  }
  return tests.map((test) => applyOverride(test, overrides.get(test.key)));
}

export function regressionTests(left: ObservedCall[], right: ObservedCall[]): GeneratedTest[] {
  const leftSchemas = schemaMap(left);
  const rightSchemas = schemaMap(right);
  const tests: GeneratedTest[] = [];
  const keys = new Set([...leftSchemas.keys(), ...rightSchemas.keys()]);
  for (const key of keys) {
    const before = leftSchemas.get(key);
    const after = rightSchemas.get(key);
    if (!before || !after) {
      continue;
    }
    const diff = diffFieldTypes(before.fields, after.fields);
    if (diff.added.length === 0 && diff.removed.length === 0 && diff.typeChanges.length === 0) {
      continue;
    }
    const description = [
      diff.added.length ? `added ${diff.added.join(", ")}` : "",
      diff.removed.length ? `removed ${diff.removed.join(", ")}` : "",
      diff.typeChanges.length ? `types ${diff.typeChanges.map((change) => `${change.path} ${change.from}->${change.to}`).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    tests.push(
      finish({
        name: `Response shape changed for ${key}`,
        description: "Observed fields differ between the two scans. This is not a judgment of the intended API.",
        endpoint: key,
        method: before.method,
        category: "regression",
        assertion: { kind: "schemaChange", expected: "unchanged response fields" },
        expected: "unchanged response fields",
        actual: description,
        status: "failed",
        failureReason: description,
      }),
    );
  }
  return tests;
}

function contractTests(endpoint: string, method: string, group: ObservedCall[]): GeneratedTest[] {
  const tests: GeneratedTest[] = [];
  const statuses = group.map((call) => call.statusCode).filter((status): status is number => status !== null);
  if (statuses.length === 0) {
    tests.push(
      skipped(endpoint, method, "contract", "Response status is stable", "No HTTP status was captured for this endpoint."),
    );
  } else {
    const expected = mode(statuses);
    const mismatches = statuses.filter((status) => status !== expected);
    tests.push(
      finish({
        name: `${method} ${endpoint} returns ${expected}`,
        description: "The most common observed status. A later call that differs fails this observed-behavior check.",
        endpoint,
        method,
        category: "contract",
        assertion: { kind: "statusEquals", expected },
        expected: String(expected),
        actual: mismatches.length === 0 ? String(expected) : `mismatches: ${mismatches.join(", ")}`,
        status: mismatches.length === 0 ? "passed" : "failed",
        failureReason: mismatches.length === 0 ? null : `Observed status ${mismatches.join(", ")} as well as ${expected}.`,
      }),
    );
  }

  const jsonCalls = group.filter((call) => (call.mimeType ?? "").includes("json"));
  if (jsonCalls.length > 0) {
    const other = group.filter((call) => call.mimeType && !call.mimeType.includes("json") && call.statusCode && call.statusCode < 400);
    tests.push(
      finish({
        name: `${method} ${endpoint} responds with JSON`,
        description: "Passes when successful responses that declared a type used JSON.",
        endpoint,
        method,
        category: "contract",
        assertion: { kind: "contentTypeIncludes", expected: "json" },
        expected: "json",
        actual: other.length === 0 ? "json" : other.map((call) => call.mimeType).join(", "),
        status: other.length === 0 ? "passed" : "failed",
        failureReason: other.length === 0 ? null : "A successful response used a non-JSON content type.",
      }),
    );
  }

  const bodies = group.map((call) => parseJsonBody(call.responseBody)).filter((value) => value !== undefined);
  if (bodies.length >= 2) {
    const paths = commonFields(bodies);
    for (const path of paths.slice(0, 12)) {
      const missing = bodies.filter((body) => !hasPath(body, path)).length;
      tests.push(
        finish({
          name: `${method} ${endpoint} includes ${path}`,
          description: "The field was present on every JSON sample with at least two observations. This does not prove the API always returns it.",
          endpoint,
          method,
          category: "contract",
          assertion: { kind: "fieldPresent", expected: path, path },
          expected: path,
          actual: missing === 0 ? "present" : `missing in ${missing}`,
          status: missing === 0 ? "passed" : "failed",
          failureReason: missing === 0 ? null : `${path} was missing in ${missing} response(s).`,
        }),
      );
    }
  }
  return tests;
}

function performanceTests(endpoint: string, method: string, group: ObservedCall[]): GeneratedTest[] {
  const durations = group.map((call) => call.totalDuration).filter((value): value is number => value !== null);
  if (durations.length === 0) {
    return [skipped(endpoint, method, "performance", "Latency stays within budget", "No duration was measured.")];
  }
  const observed = percentile(durations, 0.95);
  const budget = Math.max(DEFAULT_LATENCY_BUDGET_MS, Math.ceil(observed ?? DEFAULT_LATENCY_BUDGET_MS));
  const slow = durations.filter((value) => value > budget);
  return [
    finish({
      name: `${method} ${endpoint} responds within ${budget} ms`,
      description: "Budget is 1000 ms, or the observed p95 when that is slower. Edit the expected value to change the budget.",
      endpoint,
      method,
      category: "performance",
      assertion: { kind: "maxDuration", expected: budget },
      expected: `${budget} ms`,
      actual: `p95 ${observed} ms, slowest ${round(Math.max(...durations))} ms`,
      status: slow.length === 0 ? "passed" : "failed",
      failureReason: slow.length === 0 ? null : `${slow.length} call(s) exceeded ${budget} ms.`,
    }),
  ];
}

function reliabilityTests(endpoint: string, method: string, group: ObservedCall[]): GeneratedTest[] {
  const serverErrors = group.filter((call) => (call.statusCode ?? 0) >= 500);
  const transport = group.filter((call) => call.failureReason);
  const tests: GeneratedTest[] = [
    finish({
      name: `${method} ${endpoint} has no server errors`,
      description: "Fails when any captured call returned HTTP 500 or higher.",
      endpoint,
      method,
      category: "reliability",
      assertion: { kind: "noServerError", expected: "no 5xx" },
      expected: "no 5xx",
      actual: serverErrors.length === 0 ? "none" : serverErrors.map((call) => String(call.statusCode)).join(", "),
      status: serverErrors.length === 0 ? "passed" : "failed",
      failureReason: serverErrors.length === 0 ? null : `${serverErrors.length} response(s) were server errors.`,
    }),
    finish({
      name: `${method} ${endpoint} completed in the browser`,
      description: "Fails when Chromium reported a transport failure or the request was still open.",
      endpoint,
      method,
      category: "reliability",
      assertion: { kind: "noTransportFailure", expected: "completed" },
      expected: "completed",
      actual: transport.length === 0 ? "completed" : transport.map((call) => call.failureReason).join("; "),
      status: transport.length === 0 ? "passed" : "failed",
      failureReason: transport.length === 0 ? null : `${transport.length} call(s) failed before a normal response.`,
    }),
  ];
  return tests;
}

function schemaMap(calls: ObservedCall[]): Map<string, { method: string; fields: Map<string, string> }> {
  const groups = new Map<string, ObservedCall[]>();
  for (const call of calls) {
    if (!isApiObservation(call)) {
      continue;
    }
    const key = identifyEndpoint(call.method, call.url).key;
    const group = groups.get(key) ?? [];
    group.push(call);
    groups.set(key, group);
  }
  const result = new Map<string, { method: string; fields: Map<string, string> }>();
  for (const [key, group] of groups) {
    const fields = new Map<string, string>();
    for (const call of group) {
      const parsed = parseJsonBody(call.responseBody);
      if (parsed === undefined) {
        continue;
      }
      for (const [path, type] of fieldTypes(parsed)) {
        if (!fields.has(path)) {
          fields.set(path, type);
        }
      }
    }
    if (fields.size > 0) {
      result.set(key, { method: group[0]?.method ?? "GET", fields });
    }
  }
  return result;
}

function commonFields(bodies: unknown[]): string[] {
  const counts = new Map<string, number>();
  for (const body of bodies) {
    for (const path of fieldTypes(body).keys()) {
      if (!path || path.includes("[]")) {
        continue;
      }
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count === bodies.length)
    .map(([path]) => path)
    .slice(0, 12);
}

function hasPath(value: unknown, path: string): boolean {
  const parts = path.split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current !== undefined;
}

function applyOverride(test: GeneratedTest, override: TestOverride | undefined): GeneratedTest {
  if (!override) {
    return test;
  }
  if (override.enabled === false) {
    return { ...test, status: "skipped", failureReason: null, actual: "disabled" };
  }
  if (override.expected === undefined) {
    return test;
  }
  if (test.assertion.kind === "statusEquals" && typeof override.expected === "number") {
    const actualStatus = Number(test.actual);
    const passed = test.status === "passed" ? actualStatus === override.expected : false;
    return {
      ...test,
      assertion: { ...test.assertion, expected: override.expected },
      expected: String(override.expected),
      status: passed ? "passed" : "failed",
      failureReason: passed ? null : `Observed ${test.actual}, expected ${override.expected}.`,
    };
  }
  if (test.assertion.kind === "maxDuration" && typeof override.expected === "number") {
    const match = /slowest ([\d.]+) ms/.exec(test.actual);
    const slowest = match ? Number(match[1]) : null;
    const passed = slowest !== null && slowest <= override.expected;
    return {
      ...test,
      assertion: { ...test.assertion, expected: override.expected },
      expected: `${override.expected} ms`,
      name: test.name.replace(/within \d+ ms/, `within ${override.expected} ms`),
      status: passed ? "passed" : "failed",
      failureReason: passed ? null : `Slowest captured call was ${slowest ?? "unknown"} ms.`,
    };
  }
  return test;
}

function skipped(endpoint: string, method: string, category: TestCategory, name: string, reason: string): GeneratedTest {
  return finish({
    name,
    description: reason,
    endpoint,
    method,
    category,
    assertion: { kind: "statusEquals", expected: "skipped" },
    expected: "n/a",
    actual: "n/a",
    status: "skipped",
    failureReason: null,
  });
}

function finish(test: Omit<GeneratedTest, "key" | "observedBehavior">): GeneratedTest {
  return {
    ...test,
    key: testKey(test.category, test.endpoint, test.assertion.kind, test.assertion.path ?? ""),
    observedBehavior: true,
  };
}

export function testKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? values[0] ?? 0;
}

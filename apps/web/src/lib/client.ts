const TOKEN_KEY = "netskope.accessToken";

export interface ScanRecord {
  id: string;
  url: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  captureBodies: boolean;
}

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

export interface StackFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface InitiatorInfo {
  type?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  requestId?: string;
  stack?: StackFrame[];
}

export interface RequestDetail extends RequestSummary {
  requestHeaders: Record<string, string> | null;
  requestPayload: string | null;
  requestPayloadTruncated: boolean;
  requestBodyOmittedReason: string | null;
  requestSize: number | null;
  queryParams: { name: string; value: string }[] | null;
  responseHeaders: Record<string, string> | null;
  statusText: string | null;
  remoteAddress: string | null;
  responseBody: string | null;
  bodyOmittedReason: string | null;
  bodyTruncated: boolean;
  initiator: InitiatorInfo | null;
  redirectChain: { url: string; statusCode: number | null }[] | null;
  timing: {
    dnsTime: number | null;
    connectTime: number | null;
    tlsTime: number | null;
    ttfb: number | null;
    downloadTime: number | null;
    totalDuration: number | null;
    timingMetadata: Record<string, number> | null;
  } | null;
}

export interface EndpointSummary {
  key: string;
  method: string;
  host: string;
  path: string;
  calls: number;
  successCount: number;
  failureCount: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  averageResponseBytes: number | null;
  latestStatus: number | null;
  firstSeen: string;
  lastSeen: string;
}

export interface InvocationSummary {
  id: string;
  url: string;
  method: string;
  timestamp: string;
  statusCode: number | null;
  totalDuration: number | null;
  bodySize: number | null;
  queryParams: { name: string; value: string }[] | null;
  requestPreview: string | null;
  responsePreview: string | null;
  failureReason: string | null;
}

export interface InferredSchema {
  sampleCount: number;
  node: unknown;
  jsonSchema: Record<string, unknown> | null;
  note: string;
}

export interface GeneratedTest {
  key: string;
  name: string;
  description: string;
  endpoint: string;
  method: string;
  category: string;
  assertion: { kind: string; expected: string | number; path?: string };
  expected: string;
  actual: string;
  status: "passed" | "failed" | "skipped" | "error";
  failureReason: string | null;
  observedBehavior: true;
}

export interface EndpointChange {
  key: string;
  method: string;
  path: string;
  change: "added" | "removed" | "changed";
  notes: string[];
  left: { calls: number; status: number | null; latencyMs: number | null; fields: string[] } | null;
  right: { calls: number; status: number | null; latencyMs: number | null; fields: string[] } | null;
}

export interface DependencyNode {
  id: string;
  label: string;
  statusCode: number | null;
  totalDuration: number | null;
  independent: boolean;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "initiator" | "script";
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

export function readToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

export function writeToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = readToken();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(new URL(path, process.env.API_URL), {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 401 && retry && !path.includes("/auth/login") && !path.includes("/auth/register")) {
    const refreshed = await fetch(new URL("/api/v1/auth/refresh", process.env.API_URL), {
      method: "POST",
      credentials: "include",
    });
    if (refreshed.ok) {
      const body = (await refreshed.json()) as { accessToken: string };
      writeToken(body.accessToken);
      return api<T>(path, init, false);
    }
    clearToken();
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Request failed.");
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function downloadScan(scanId: string, format: "json" | "csv"): Promise<void> {
  const headers = new Headers();
  const token = readToken();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const response = await fetch(new URL(`/api/v1/scans/${scanId}/export?format=${format}`, process.env.API_URL), {
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Export failed.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `scan-${scanId}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

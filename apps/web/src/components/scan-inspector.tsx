"use client";

import { useEffect, useMemo, useState } from "react";
import { ComparePanel, DependencyPanel, ExplorerPanel, HealthPanel, TestsPanel } from "@/components/analysis-panels";
import { StatusBadge } from "@/components/dashboard";
import { RequestDrawer } from "@/components/request-drawer";
import {
  api,
  downloadScan,
  readToken,
  type AnalyticsReport,
  type RequestDetail,
  type RequestSummary,
  type ScanRecord,
} from "@/lib/client";

type Tab = "overview" | "network" | "explorer" | "tests" | "compare" | "dependencies" | "analytics";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "network", label: "Network" },
  { id: "explorer", label: "API Explorer" },
  { id: "tests", label: "Test Cases" },
  { id: "compare", label: "Comparisons" },
  { id: "dependencies", label: "Dependencies" },
  { id: "analytics", label: "Analytics" },
];

export function ScanInspector({ scanId }: { scanId: string }) {
  const [scan, setScan] = useState<ScanRecord | null>(null);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsReport | null>(null);
  const [others, setOthers] = useState<ScanRecord[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [requestClass, setRequestClass] = useState("");
  const [sort, setSort] = useState("timestamp");
  const [initiator, setInitiator] = useState("");
  const [selected, setSelected] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadRequests() {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (method) params.set("method", method);
    if (status) params.set("status", status);
    if (requestClass) params.set("requestClass", requestClass);
    if (sort) params.set("sort", sort);
    if (initiator) params.set("initiator", initiator);
    const body = await api<{ requests: RequestSummary[] }>(`/api/v1/scans/${scanId}/requests?${params.toString()}`);
    setRequests(body.requests);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [scanBody, analyticsBody, history] = await Promise.all([
        api<{ scan: ScanRecord }>(`/api/v1/scans/${scanId}`),
        api<AnalyticsReport>(`/api/v1/scans/${scanId}/analytics`),
        api<{ scans: ScanRecord[] }>("/api/v1/scans?limit=20"),
      ]);
      if (cancelled) return;
      setScan(scanBody.scan);
      setAnalytics(analyticsBody);
      setOthers(history.scans.filter((item) => item.id !== scanId && item.status === "COMPLETED"));
      await loadRequests();
    }
    void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the scan."));
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  useEffect(() => {
    const token = readToken();
    if (!token || !scan || scan.status === "COMPLETED" || scan.status === "FAILED") {
      return;
    }
    const controller = new AbortController();
    void readEvents(scanId, token, controller.signal, (statusValue) => {
      setScan((current) => (current ? { ...current, status: statusValue } : current));
      if (statusValue === "COMPLETED" || statusValue === "FAILED") {
        void api<{ scan: ScanRecord }>(`/api/v1/scans/${scanId}`).then((body) => setScan(body.scan));
        void api<AnalyticsReport>(`/api/v1/scans/${scanId}/analytics`).then(setAnalytics);
        void loadRequests();
      }
    });
    return () => controller.abort();
  }, [scan?.status, scanId]);

  async function openRequest(id: string) {
    const body = await api<{ request: RequestDetail }>(`/api/v1/scans/${scanId}/requests/${id}`);
    setSelected(body.request);
  }

  const waterfall = useMemo(() => layoutWaterfall(requests), [requests]);

  if (!scan) {
    return <p className="text-sm text-[var(--muted)]">{error ?? "Loading scan…"}</p>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold break-all">{scan.url}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{scan.errorMessage ?? "Captured network activity for this page load."}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {scan.captureBodies
              ? "Response bodies were captured when the content was text, under the size limit, and not an authentication or payment path."
              : "Response bodies were not captured. Start another scan and opt in to store redacted text bodies."}
          </p>
        </div>
        <StatusBadge status={scan.status} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`rounded-md border px-3 py-1 ${tab === item.id ? "border-[var(--foreground)] bg-[var(--card)]" : "border-[var(--line)]"}`}
            type="button"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button className="rounded-md border border-[var(--line)] px-3 py-1" type="button" onClick={() => void downloadScan(scanId, "json")}>JSON</button>
        <button className="rounded-md border border-[var(--line)] px-3 py-1" type="button" onClick={() => void downloadScan(scanId, "csv")}>CSV</button>
      </div>

      {tab === "overview" ? (
        <div className="mt-4 space-y-4">
          {analytics ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="Requests" value={String(analytics.requestCount)} />
              <Metric label="Failed" value={String(analytics.failedCount)} />
              <Metric label="Average" value={analytics.averageLatencyMs === null ? "—" : `${analytics.averageLatencyMs} ms`} />
              <Metric label="Duplicate groups" value={String(analytics.duplicateGroups)} />
            </div>
          ) : null}
          <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--card)] p-4">
            {waterfall.map((bar) => (
              <button key={bar.id} className="grid w-full grid-cols-[180px_1fr] items-center gap-3 text-left" type="button" onClick={() => void openRequest(bar.id)}>
                <span className="truncate text-xs">{bar.label}</span>
                <span className="relative h-3 rounded bg-[var(--background)]">
                  <span className={`absolute top-0 h-3 rounded ${bar.slow ? "bg-amber-700" : "bg-[var(--foreground)]"}`} style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
                </span>
              </button>
            ))}
            {waterfall.length === 0 ? <p className="text-sm text-[var(--muted)]">No requests to place on the waterfall.</p> : null}
          </div>
        </div>
      ) : null}

      {tab === "network" ? (
        <div className="mt-4">
          <form
            className="grid gap-2 md:grid-cols-6"
            onSubmit={(event) => {
              event.preventDefault();
              void loadRequests().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Filter failed."));
            }}
          >
            <input className="rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm" placeholder="Search URL" value={query} onChange={(event) => setQuery(event.target.value)} />
            <input className="rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm" placeholder="Initiator script" value={initiator} onChange={(event) => setInitiator(event.target.value)} />
            <select className="rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="">Any method</option>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => <option key={item}>{item}</option>)}
            </select>
            <select className="rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Any status</option>
              <option value="2xx">2xx</option>
              <option value="3xx">3xx</option>
              <option value="4xx">4xx</option>
              <option value="5xx">5xx</option>
              <option value="failed">Failed</option>
            </select>
            <select className="rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm" value={requestClass} onChange={(event) => setRequestClass(event.target.value)}>
              <option value="">Any class</option>
              {["DOCUMENT", "STATIC", "API", "OTHER"].map((item) => <option key={item}>{item}</option>)}
            </select>
            <select className="rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="timestamp">Time</option>
              <option value="duration">Duration</option>
              <option value="status">Status</option>
              <option value="url">URL</option>
            </select>
            <button className="rounded-md bg-[var(--foreground)] px-3 py-2 text-sm text-[var(--background)] md:col-span-6 md:w-fit" type="submit">Apply</button>
          </form>
          <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--card)]">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Class</th>
                  <th className="px-3 py-2">URL</th>
                  <th className="px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id} className="cursor-pointer border-t border-[var(--line)]" onClick={() => void openRequest(request.id)}>
                    <td className="px-3 py-2">{request.method}</td>
                    <td className="px-3 py-2">{request.statusCode ?? request.failureReason ?? "—"}</td>
                    <td className="px-3 py-2">{request.requestClass ?? "—"}</td>
                    <td className="max-w-md truncate px-3 py-2">{request.url}</td>
                    <td className={`px-3 py-2 ${request.totalDuration !== null && request.totalDuration >= 300 ? "text-amber-800" : ""}`}>
                      {request.totalDuration === null ? "—" : `${request.totalDuration} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "explorer" ? <ExplorerPanel scanId={scanId} onOpen={(id) => void openRequest(id)} /> : null}
      {tab === "tests" ? <TestsPanel scanId={scanId} /> : null}
      {tab === "compare" ? <ComparePanel others={others} scanId={scanId} /> : null}
      {tab === "dependencies" ? <DependencyPanel scanId={scanId} onOpen={(id) => void openRequest(id)} /> : null}
      {tab === "analytics" && analytics ? <HealthPanel analytics={analytics} /> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {selected ? <RequestDrawer request={selected} scanId={scanId} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-4 py-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function layoutWaterfall(requests: RequestSummary[]): { id: string; label: string; left: number; width: number; slow: boolean }[] {
  if (requests.length === 0) return [];
  const start = Math.min(...requests.map((request) => Date.parse(request.timestamp)));
  const end = Math.max(...requests.map((request) => Date.parse(request.timestamp) + (request.totalDuration ?? 0)));
  const span = Math.max(end - start, 1);
  return requests.map((request) => {
    const offset = Date.parse(request.timestamp) - start;
    const duration = request.totalDuration ?? 0;
    return {
      id: request.id,
      label: `${request.method} ${shortUrl(request.url)}`,
      left: (offset / span) * 100,
      width: Math.max((duration / span) * 100, duration === 0 ? 1 : 0.5),
      slow: request.totalDuration !== null && request.totalDuration >= 300,
    };
  });
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function readEvents(
  scanId: string,
  token: string,
  signal: AbortSignal,
  onStatus: (status: ScanRecord["status"]) => void,
): Promise<void> {
  const response = await fetch(new URL(`/api/v1/scans/${scanId}/events`, process.env.API_URL), {
    headers: { authorization: `Bearer ${token}` },
    credentials: "include",
    signal,
  });
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as { status?: ScanRecord["status"] };
      if (event.status) onStatus(event.status);
    }
  }
}

"use client";

import { useEffect, useState } from "react";
import { AnalyticsChart } from "@/components/analytics-chart";
import { JsonTree } from "@/components/json-tree";
import {
  api,
  type AnalyticsReport,
  type DependencyEdge,
  type DependencyNode,
  type EndpointChange,
  type EndpointSummary,
  type GeneratedTest,
  type InferredSchema,
  type InvocationSummary,
} from "@/lib/client";

export function ExplorerPanel({ scanId, onOpen }: { scanId: string; onOpen: (id: string) => void }) {
  const [endpoints, setEndpoints] = useState<EndpointSummary[] | null>(null);
  const [schemas, setSchemas] = useState<{ key: string; request: InferredSchema; response: InferredSchema }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [invocations, setInvocations] = useState<InvocationSummary[]>([]);
  const [method, setMethod] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [slowOnly, setSlowOnly] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const params = new URLSearchParams();
    if (method) params.set("method", method);
    if (failedOnly) params.set("failed", "1");
    if (slowOnly) params.set("slow", "1");
    if (endpoint) params.set("endpoint", endpoint);
    const [body, schemaBody] = await Promise.all([
      api<{ endpoints: EndpointSummary[] }>(`/api/v1/scans/${scanId}/endpoints?${params.toString()}`),
      api<{ schemas: { key: string; request: InferredSchema; response: InferredSchema }[] }>(`/api/v1/scans/${scanId}/schemas`),
    ]);
    setEndpoints(body.endpoints);
    setSchemas(schemaBody.schemas);
  }

  useEffect(() => {
    void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load endpoints."));
  }, [scanId]);

  async function openEndpoint(key: string) {
    setSelected(key);
    const body = await api<{ invocations: InvocationSummary[] }>(`/api/v1/scans/${scanId}/invocations?key=${encodeURIComponent(key)}`);
    setInvocations(body.invocations);
  }

  const schema = schemas.find((item) => item.key === selected);

  if (!endpoints) {
    return <p className="mt-4 text-sm text-[var(--muted)]">{error ?? "Loading API explorer…"}</p>;
  }

  return (
    <div className="mt-4 space-y-4">
      <form className="flex flex-wrap gap-2 text-sm" onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <select className="rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-1" value={method} onChange={(event) => setMethod(event.target.value)}>
          <option value="">Any method</option>
          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => <option key={item}>{item}</option>)}
        </select>
        <input className="rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-1" placeholder="Path contains" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
        <label className="flex items-center gap-1"><input checked={failedOnly} type="checkbox" onChange={(event) => setFailedOnly(event.target.checked)} /> Failed</label>
        <label className="flex items-center gap-1"><input checked={slowOnly} type="checkbox" onChange={(event) => setSlowOnly(event.target.checked)} /> Slow</label>
        <button className="rounded-md border border-[var(--line)] px-2 py-1" type="submit">Apply</button>
      </form>
      {endpoints.length === 0 ? <p className="text-sm text-[var(--muted)]">No API calls matched these filters.</p> : null}
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--card)]">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Endpoint</th>
              <th className="px-3 py-2">Calls</th>
              <th className="px-3 py-2">OK</th>
              <th className="px-3 py-2">Failed</th>
              <th className="px-3 py-2">Avg</th>
              <th className="px-3 py-2">P95</th>
              <th className="px-3 py-2">Latest</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((item) => (
              <tr key={item.key} className="cursor-pointer border-t border-[var(--line)]" onClick={() => void openEndpoint(item.key)}>
                <td className="px-3 py-2">{item.method} {item.host}{item.path}</td>
                <td className="px-3 py-2">{item.calls}</td>
                <td className="px-3 py-2">{item.successCount}</td>
                <td className="px-3 py-2">{item.failureCount}</td>
                <td className="px-3 py-2">{item.averageLatencyMs ?? "—"}</td>
                <td className="px-3 py-2">{item.p95LatencyMs ?? "—"}</td>
                <td className="px-3 py-2">{item.latestStatus ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-4 text-sm">
          <h2 className="font-semibold">{selected}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Invocations are the captured calls. They are not assumed to be the intended contract.</p>
          <ul className="mt-3 space-y-2 text-xs">
            {invocations.map((call) => (
              <li key={call.id}>
                <button className="text-left" type="button" onClick={() => onOpen(call.id)}>
                  {call.statusCode ?? call.failureReason ?? "—"} · {call.totalDuration ?? "—"} ms · {call.url}
                </button>
                {call.responsePreview ? <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[var(--muted)]">{call.responsePreview}</pre> : null}
              </li>
            ))}
          </ul>
          {schema ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <SchemaBlock title="Request schema" schema={schema.request} />
              <SchemaBlock title="Response schema" schema={schema.response} />
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

function SchemaBlock({ title, schema }: { title: string; schema: InferredSchema }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">{schema.note} Samples: {schema.sampleCount}.</p>
      {schema.jsonSchema ? <div className="mt-2"><JsonTree text={JSON.stringify(schema.jsonSchema)} /></div> : <p className="mt-2 text-xs">No JSON schema could be inferred.</p>}
    </div>
  );
}

export function TestsPanel({ scanId }: { scanId: string }) {
  const [tests, setTests] = useState<GeneratedTest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);

  async function load() {
    const body = await api<{ tests: GeneratedTest[]; ranAt?: string }>(`/api/v1/scans/${scanId}/tests`);
    setTests(body.tests);
  }

  useEffect(() => {
    void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load tests."));
  }, [scanId]);

  async function run() {
    const body = await api<{ tests: GeneratedTest[]; ranAt: string }>(`/api/v1/scans/${scanId}/tests/run`, { method: "POST" });
    setTests(body.tests);
    setRanAt(body.ranAt);
  }

  async function toggle(test: GeneratedTest) {
    await api(`/api/v1/scans/${scanId}/tests/${test.key}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: test.status === "skipped" ? true : false }),
    });
    await load();
  }

  function download() {
    const blob = new Blob([JSON.stringify({ tests, observedBehavior: true }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tests-${scanId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!tests) {
    return <p className="mt-4 text-sm text-[var(--muted)]">{error ?? "Loading tests…"}</p>;
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-[var(--muted)]">These checks describe captured behavior. They do not call the API again and they are not a specification of intended business rules.</p>
      <div className="flex gap-2 text-sm">
        <button className="rounded-md bg-[var(--foreground)] px-3 py-1 text-[var(--background)]" type="button" onClick={() => void run()}>Run against capture</button>
        <button className="rounded-md border border-[var(--line)] px-3 py-1" type="button" onClick={download}>Export</button>
        {ranAt ? <span className="text-xs text-[var(--muted)]">Ran {new Date(ranAt).toLocaleString()}</span> : null}
      </div>
      {tests.length === 0 ? <p className="text-sm text-[var(--muted)]">No API calls were available to generate tests.</p> : null}
      <ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm">
        {tests.map((test) => (
          <li key={test.key} className="px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{test.name}</p>
                <p className="text-xs text-[var(--muted)]">{test.category} · {test.description}</p>
                <p className="mt-1 text-xs">Expected {test.expected} · actual {test.actual}</p>
                {test.failureReason ? <p className="text-xs text-red-700">{test.failureReason}</p> : null}
              </div>
              <div className="text-right">
                <p className={test.status === "failed" ? "text-red-700" : test.status === "passed" ? "text-emerald-800" : "text-[var(--muted)]"}>{test.status}</p>
                <button className="mt-1 text-xs underline" type="button" onClick={() => void toggle(test)}>{test.status === "skipped" ? "Enable" : "Disable"}</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

export function ComparePanel({
  scanId,
  others,
}: {
  scanId: string;
  others: { id: string; url: string }[];
}) {
  const [compareId, setCompareId] = useState("");
  const [changes, setChanges] = useState<EndpointChange[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!compareId) return;
    const body = await api<{
      onlyLeft: string[];
      onlyRight: string[];
      slowerOnRight: { key: string; delta: number }[];
      endpointChanges: EndpointChange[];
      regressions: { name: string; failureReason: string | null }[];
    }>(`/api/v1/scans/compare?left=${scanId}&right=${compareId}`);
    setSummary(`${body.onlyLeft.length} request URLs only in this scan, ${body.onlyRight.length} only in the other. ${body.regressions.length} schema regressions.`);
    setChanges(body.endpointChanges);
  }

  return (
    <div className="mt-4 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2" value={compareId} onChange={(event) => setCompareId(event.target.value)}>
          <option value="">Compare with…</option>
          {others.map((item) => <option key={item.id} value={item.id}>{item.url}</option>)}
        </select>
        <button className="rounded-md border border-[var(--line)] px-3 py-2" type="button" onClick={() => void run().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Compare failed."))}>Compare</button>
      </div>
      {summary ? <p>{summary}</p> : <p className="text-[var(--muted)]">Choose another completed scan. Dynamic ids are grouped before the diff.</p>}
      {changes?.map((change) => (
        <article key={`${change.change}-${change.key}`} className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-3">
          <p className="font-medium">{change.change} · {change.key}</p>
          <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
            <Snapshot title="Previous" snapshot={change.left} />
            <Snapshot title="Current" snapshot={change.right} />
          </div>
          <ul className="mt-2 text-xs">{change.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </article>
      ))}
      {error ? <p className="text-red-700">{error}</p> : null}
    </div>
  );
}

function Snapshot({ title, snapshot }: { title: string; snapshot: EndpointChange["left"] }) {
  if (!snapshot) {
    return <p className="text-xs text-[var(--muted)]">{title}: not observed</p>;
  }
  return (
    <p className="text-xs">
      {title}: status {snapshot.status ?? "—"}, {snapshot.latencyMs ?? "—"} ms, fields {snapshot.fields.join(", ") || "none"}
    </p>
  );
}

export function DependencyPanel({ scanId, onOpen }: { scanId: string; onOpen: (id: string) => void }) {
  const [nodes, setNodes] = useState<DependencyNode[] | null>(null);
  const [edges, setEdges] = useState<DependencyEdge[]>([]);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ nodes: DependencyNode[]; edges: DependencyEdge[] }>(`/api/v1/scans/${scanId}/dependencies`)
      .then((body) => {
        setNodes(body.nodes);
        setEdges(body.edges);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the graph."));
  }, [scanId]);

  if (!nodes) {
    return <p className="mt-4 text-sm text-[var(--muted)]">{error ?? "Loading relationships…"}</p>;
  }
  const children = new Map<string, DependencyEdge[]>();
  const targets = new Set(edges.map((edge) => edge.to));
  for (const edge of edges) {
    const list = children.get(edge.from) ?? [];
    list.push(edge);
    children.set(edge.from, list);
  }
  const roots = nodes.filter((node) => !targets.has(node.id)).slice(0, 40);

  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span>Zoom</span>
        <input max={1.6} min={0.7} step={0.1} type="range" value={scale} onChange={(event) => setScale(Number(event.target.value))} />
      </div>
      <div className="max-h-[32rem] overflow-auto rounded-lg border border-[var(--line)] bg-[var(--card)] p-4" style={{ fontSize: `${scale}rem` }}>
        {roots.map((node) => <GraphNode key={node.id} depth={0} edges={children} node={node} nodes={nodes} onOpen={onOpen} />)}
        {roots.length === 0 ? <p className="text-sm">No requests to place on the graph.</p> : null}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">A line is drawn only when Chrome recorded a parent request or a script URL that was itself requested. Other requests stay independent.</p>
    </div>
  );
}

function GraphNode({
  node,
  edges,
  nodes,
  depth,
  onOpen,
}: {
  node: DependencyNode;
  edges: Map<string, DependencyEdge[]>;
  nodes: DependencyNode[];
  depth: number;
  onOpen: (id: string) => void;
}) {
  if (depth > 6) {
    return null;
  }
  const tone = (node.statusCode ?? 0) >= 400 ? "text-red-700" : "text-[var(--foreground)]";
  return (
    <div className="ml-3 border-l border-[var(--line)] pl-3">
      <button className={`text-left text-xs ${tone}`} type="button" onClick={() => onOpen(node.id)}>
        {node.label} · {node.statusCode ?? "—"} · {node.totalDuration ?? "—"} ms{node.independent ? " · independent" : ""}
      </button>
      {(edges.get(node.id) ?? []).map((edge) => {
        const child = nodes.find((item) => item.id === edge.to);
        return child ? <GraphNode key={`${edge.from}-${edge.to}`} depth={depth + 1} edges={edges} node={child} nodes={nodes} onOpen={onOpen} /> : null;
      })}
    </div>
  );
}

export function HealthPanel({ analytics }: { analytics: AnalyticsReport }) {
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Requests" value={String(analytics.requestCount)} />
        <Metric label="API calls" value={String(analytics.apiRequestCount)} />
        <Metric label="API success" value={analytics.successRate === null ? "—" : `${analytics.successRate}%`} />
        <Metric label="Failed API" value={String(analytics.failedApiCount)} />
        <Metric label="Median" value={analytics.medianLatencyMs === null ? "—" : `${analytics.medianLatencyMs} ms`} />
        <Metric label="P95" value={analytics.p95LatencyMs === null ? "—" : `${analytics.p95LatencyMs} ms`} />
        <Metric label="P99" value={analytics.p99LatencyMs === null ? "not enough samples" : `${analytics.p99LatencyMs} ms`} />
        <Metric label="Third-party" value={String(analytics.thirdPartyCount)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Latency distribution" data={analytics.distribution} />
        <ChartCard title="Status codes" data={analytics.statusDistribution} />
        <ChartCard title="Requests over time" data={analytics.requestsOverTime} />
        <ChartCard title="Resource classes" data={analytics.resourceDistribution} />
      </div>
      <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-4 text-sm">
        <h2 className="font-semibold">Slowest endpoints</h2>
        <ul className="mt-2 space-y-1">{analytics.slowestEndpoints.map((item) => <li key={item.key}>{item.key} · {item.totalDuration} ms</li>)}</ul>
        <h2 className="mt-4 font-semibold">Most called</h2>
        <ul className="mt-2 space-y-1">{analytics.frequentEndpoints.map((item) => <li key={item.key}>{item.count}× {item.key}</li>)}</ul>
        <h2 className="mt-4 font-semibold">Largest responses</h2>
        <ul className="mt-2 space-y-1">{analytics.largestResponses.map((item) => <li key={item.url}>{item.method} {item.url} · {item.bodySize} bytes</li>)}</ul>
        <h2 className="mt-4 font-semibold">Third-party hosts</h2>
        {analytics.thirdPartyDomains.length === 0 ? <p className="mt-2 text-[var(--muted)]">No third-party hosts in this scan.</p> : null}
        <ul className="mt-2 space-y-1">{analytics.thirdPartyDomains.map((item) => <li key={item.host}>{item.count}× {item.host}</li>)}</ul>
      </div>
    </div>
  );
}

function ChartCard({ title, data }: { title: string; data: { label: string; count: number }[] }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {data.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">Not enough samples.</p> : <AnalyticsChart distribution={data} />}
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

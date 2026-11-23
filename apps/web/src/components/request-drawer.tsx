"use client";

import { useState } from "react";
import { JsonTree } from "@/components/json-tree";
import { api, type RequestDetail } from "@/lib/client";

type DetailTab = "general" | "query" | "request" | "responseHeaders" | "payload" | "response" | "timing" | "initiator" | "replay";

export function RequestDrawer({
  scanId,
  request,
  onClose,
}: {
  scanId: string;
  request: RequestDetail;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("general");
  return (
    <aside className="fixed inset-y-0 right-0 z-10 w-full max-w-xl overflow-y-auto border-l border-[var(--line)] bg-[var(--card)] p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-[var(--muted)]">{request.method} · {request.statusCode ?? "no status"}</p>
          <h2 className="text-sm font-semibold break-all">{request.url}</h2>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {(
          [
            ["general", "General"],
            ["query", "Query"],
            ["request", "Request headers"],
            ["responseHeaders", "Response headers"],
            ["payload", "Payload"],
            ["response", "Response"],
            ["timing", "Timing"],
            ["initiator", "Initiator"],
            ["replay", "Replay"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`rounded border px-2 py-1 ${tab === id ? "border-[var(--foreground)]" : "border-[var(--line)]"}`} type="button" onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4 text-sm">
        {tab === "general" ? <General request={request} /> : null}
        {tab === "query" ? <QueryTable params={request.queryParams} /> : null}
        {tab === "request" ? <HeaderList headers={request.requestHeaders} /> : null}
        {tab === "responseHeaders" ? <HeaderList headers={request.responseHeaders} /> : null}
        {tab === "payload" ? <BodyView text={request.requestPayload} truncated={request.requestPayloadTruncated} omitted={request.requestBodyOmittedReason} /> : null}
        {tab === "response" ? <BodyView text={request.responseBody} truncated={request.bodyTruncated} omitted={request.bodyOmittedReason} mime={request.mimeType} /> : null}
        {tab === "timing" ? <Timing request={request} /> : null}
        {tab === "initiator" ? <Initiator request={request} /> : null}
        {tab === "replay" ? <ReplayForm scanId={scanId} request={request} /> : null}
      </div>
    </aside>
  );
}

function General({ request }: { request: RequestDetail }) {
  const rows = [
    ["URL", request.url],
    ["Method", request.method],
    ["Status", request.statusCode === null ? "—" : `${request.statusCode}${request.statusText ? ` ${request.statusText}` : ""}`],
    ["Remote address", request.remoteAddress ?? "not reported"],
    ["Resource type", request.resourceType ?? "not reported"],
    ["Class", request.requestClass ?? "not reported"],
    ["Duration", request.totalDuration === null ? "not reported" : `${request.totalDuration} ms`],
    ["Request size", request.requestSize === null ? "not reported" : `${request.requestSize} bytes`],
    ["Response size", request.bodySize === null ? "not reported" : `${request.bodySize} bytes`],
  ];
  return (
    <dl className="space-y-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-[var(--muted)]">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function QueryTable({ params }: { params: RequestDetail["queryParams"] }) {
  if (!params || params.length === 0) {
    return <p>This request has no query string.</p>;
  }
  return (
    <table className="w-full text-left text-xs">
      <tbody>
        {params.map((param) => (
          <tr key={`${param.name}-${param.value}`} className="border-t border-[var(--line)]">
            <th className="py-1 pr-3 font-medium">{param.name}</th>
            <td className="break-all py-1">{param.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HeaderList({ headers }: { headers: Record<string, string> | null }) {
  if (!headers || Object.keys(headers).length === 0) {
    return <p>No headers stored.</p>;
  }
  return (
    <ul className="space-y-1 text-xs">
      {Object.entries(headers).map(([name, value]) => (
        <li key={name} className="break-all">
          <span className="font-medium">{name}</span>: {value}
        </li>
      ))}
    </ul>
  );
}

function BodyView({ text, truncated, omitted, mime }: { text: string | null; truncated: boolean; omitted: string | null; mime?: string | null }) {
  if (!text) {
    return <p>{omitted ?? "No body was stored."}</p>;
  }
  const binary = mime?.startsWith("image/") || mime?.startsWith("audio/") || mime?.startsWith("video/") || mime === "application/octet-stream";
  return (
    <div className="space-y-2">
      {truncated ? <p className="text-xs text-[var(--muted)]">Truncated to the capture limit.</p> : null}
      {binary ? <p>Binary content is described by its type and size, not rendered.</p> : <JsonTree text={text} />}
    </div>
  );
}

function Timing({ request }: { request: RequestDetail }) {
  const phases = [
    ["DNS", request.timing?.dnsTime],
    ["TCP", request.timing?.connectTime],
    ["TLS", request.timing?.tlsTime],
    ["Sent", request.timing?.timingMetadata?.sendTime],
    ["TTFB", request.timing?.ttfb],
    ["Download", request.timing?.downloadTime],
  ] as const;
  const total = request.timing?.totalDuration ?? null;
  const sum = phases.reduce((count, [, value]) => count + (value ?? 0), 0) || total || 1;
  return (
    <div className="space-y-2">
      {phases.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[72px_1fr_72px] items-center gap-2 text-xs">
          <span>{label}</span>
          <span className="h-2 rounded bg-[var(--background)]">
            <span className="block h-2 rounded bg-[var(--foreground)]" style={{ width: `${Math.max(((value ?? 0) / sum) * 100, value ? 2 : 0)}%` }} />
          </span>
          <span>{value === null || value === undefined ? "n/a" : `${value} ms`}</span>
        </div>
      ))}
      <p className="text-xs">Total: {total === null ? "not reported" : `${total} ms`}</p>
    </div>
  );
}

function Initiator({ request }: { request: RequestDetail }) {
  const initiator = request.initiator;
  if (!initiator?.type) {
    return <p>No initiator was recorded.</p>;
  }
  return (
    <div className="space-y-2 text-xs">
      <p>{initiator.type}{initiator.url ? ` · ${initiator.url}` : ""}</p>
      {initiator.lineNumber !== undefined ? <p>Line {initiator.lineNumber + 1}, column {(initiator.columnNumber ?? 0) + 1}</p> : null}
      {initiator.stack && initiator.stack.length > 0 ? (
        <ol className="space-y-1">
          {initiator.stack.map((frame, index) => (
            <li key={`${frame.url}-${index}`}>
              {frame.functionName || "(anonymous)"} — {frame.url}:{frame.lineNumber + 1}:{frame.columnNumber + 1}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[var(--muted)]">Chrome did not include a stack trace.</p>
      )}
      {request.redirectChain?.length ? (
        <ul>
          {request.redirectChain.map((hop) => (
            <li key={hop.url}>{hop.statusCode ?? "—"} {hop.url}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReplayForm({ scanId, request }: { scanId: string; request: RequestDetail }) {
  const [method, setMethod] = useState(request.method);
  const [url, setUrl] = useState(request.url);
  const [headers, setHeaders] = useState(editableHeaders(request.requestHeaders));
  const [body, setBody] = useState(request.requestPayload ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmMutation, setConfirmMutation] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());

  async function send() {
    setPending(true);
    setMessage(null);
    try {
      const created = await api<{ replay: { id: string } }>(`/api/v1/scans/${scanId}/requests/${request.id}/replays`, {
        method: "POST",
        body: JSON.stringify({
          method,
          url,
          headers: headerObject(headers),
          body: body || null,
          confirmed,
          confirmMutation,
          sendCredentials: false,
        }),
      });
      const result = await waitForReplay(scanId, created.replay.id);
      setMessage(formatReplay(request, result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Replay failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <p>Credentials from the capture are not sent. Cookie and authorization headers are removed. The worker checks the URL again, including redirects, before connecting.</p>
      <label className="block">Method
        <input className="mt-1 w-full rounded-md border border-[var(--line)] px-2 py-1" value={method} onChange={(event) => setMethod(event.target.value)} />
      </label>
      <label className="block">URL
        <input className="mt-1 w-full rounded-md border border-[var(--line)] px-2 py-1" value={url} onChange={(event) => setUrl(event.target.value)} />
      </label>
      <label className="block">Headers
        <textarea className="mt-1 h-24 w-full rounded-md border border-[var(--line)] px-2 py-1" value={headers} onChange={(event) => setHeaders(event.target.value)} />
      </label>
      <label className="block">Body
        <textarea className="mt-1 h-24 w-full rounded-md border border-[var(--line)] px-2 py-1" value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      <label className="flex items-center gap-2">
        <input checked={confirmed} type="checkbox" onChange={(event) => setConfirmed(event.target.checked)} />
        Send this request
      </label>
      {mutating ? (
        <label className="flex items-center gap-2">
          <input checked={confirmMutation} type="checkbox" onChange={(event) => setConfirmMutation(event.target.checked)} />
          This can change data. Send it anyway.
        </label>
      ) : null}
      <button className="rounded-md bg-[var(--foreground)] px-3 py-1 text-[var(--background)] disabled:opacity-60" disabled={pending} type="button" onClick={() => void send()}>
        {pending ? "Sending…" : "Replay"}
      </button>
      {message ? <p className="whitespace-pre-wrap">{message}</p> : null}
    </div>
  );
}

function editableHeaders(headers: Record<string, string> | null): string {
  if (!headers) {
    return "";
  }
  return Object.entries(headers)
    .filter(([name, value]) => value !== "[redacted]" && !["authorization", "cookie", "set-cookie", "proxy-authorization"].includes(name.toLowerCase()))
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}

function headerObject(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) {
      continue;
    }
    headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return headers;
}

async function waitForReplay(scanId: string, replayId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const body = await api<{ replay: ReplayResult }>(`/api/v1/scans/${scanId}/replays/${replayId}`);
    if (body.replay.status === "COMPLETED" || body.replay.status === "FAILED") {
      return body.replay;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { status: "PENDING", replayStatus: null, originalStatus: null, replayDuration: null, originalDuration: null, responseExcerpt: null, errorMessage: "The replay is still running." } as ReplayResult;
}

interface ReplayResult {
  status: string;
  replayStatus: number | null;
  originalStatus: number | null;
  replayDuration: number | null;
  originalDuration: number | null;
  responseExcerpt: string | null;
  errorMessage: string | null;
}

function formatReplay(request: RequestDetail, replay: ReplayResult): string {
  if (replay.status === "FAILED") {
    return replay.errorMessage ?? "Replay failed.";
  }
  return [
    `Original status ${request.statusCode ?? "—"} · replay status ${replay.replayStatus ?? "—"}`,
    `Original duration ${request.totalDuration ?? "—"} ms · replay duration ${replay.replayDuration ?? "—"} ms`,
    replay.responseExcerpt ? `Response:\n${replay.responseExcerpt.slice(0, 1500)}` : replay.errorMessage ?? "No response body stored.",
  ].join("\n");
}

"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api, type ScanRecord } from "@/lib/client";

export function Dashboard() {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [url, setUrl] = useState("https://example.com/");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load() {
    const body = await api<{ scans: ScanRecord[] }>("/api/v1/scans");
    setScans(body.scans);
  }

  useEffect(() => {
    void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load scans."));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/api/v1/scans", { method: "POST", body: JSON.stringify({ url }) });
      setUrl("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the scan.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">Scans</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">Submit a public http or https URL. The worker loads it in an isolated browser.</p>
      <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
        <input
          className="flex-1 rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com"
          required
        />
        <button
          className="rounded-md bg-[var(--foreground)] px-4 py-2 text-sm text-[var(--background)] disabled:opacity-60"
          type="submit"
          disabled={pending}
        >
          {pending ? "Starting…" : "Start scan"}
        </button>
      </form>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <ul className="mt-8 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--card)]">
        {scans.length === 0 ? <li className="px-4 py-6 text-sm text-[var(--muted)]">No scans yet.</li> : null}
        {scans.map((scan) => (
          <li key={scan.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <Link className="text-sm font-medium" href={`/app/scans/${scan.id}`}>
                {scan.url}
              </Link>
              <p className="text-xs text-[var(--muted)]">{new Date(scan.createdAt).toLocaleString()}</p>
            </div>
            <StatusBadge status={scan.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatusBadge({ status }: { status: ScanRecord["status"] }) {
  const tone = status === "COMPLETED" ? "text-emerald-800" : status === "FAILED" ? "text-red-700" : "text-amber-800";
  return <span className={`text-xs font-medium ${tone}`}>{status}</span>;
}

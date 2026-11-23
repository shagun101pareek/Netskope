"use client";

import { useMemo, useState } from "react";

export function JsonTree({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false as const, value: text };
    }
  }, [text]);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  async function copy() {
    const pretty = parsed.ok ? JSON.stringify(parsed.value, null, 2) : text;
    await navigator.clipboard.writeText(pretty);
    setCopied(true);
  }

  return (
    <div>
      <div className="mb-2 flex gap-2">
        <input
          className="flex-1 rounded-md border border-[var(--line)] bg-[var(--background)] px-2 py-1 text-xs"
          placeholder="Search payload"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="rounded-md border border-[var(--line)] px-2 py-1 text-xs" type="button" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {parsed.ok ? <Node value={parsed.value} name={null} query={query.toLowerCase()} /> : <pre className="whitespace-pre-wrap break-all text-xs">{text}</pre>}
    </div>
  );
}

function Node({ value, name, query }: { value: unknown; name: string | null; query: string }) {
  const [open, setOpen] = useState(true);
  const label = name === null ? "" : `${name}: `;
  if (Array.isArray(value) || isObject(value)) {
    const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
    const visible = query ? entries.filter(([key, nested]) => matches(key, nested, query)) : entries;
    if (query && visible.length === 0 && !matches(name ?? "", value, query)) {
      return null;
    }
    return (
      <div className="text-xs">
        <button className="text-left" type="button" onClick={() => setOpen((current) => !current)}>
          {open ? "▾" : "▸"} {label}
          {Array.isArray(value) ? `Array(${value.length})` : `Object(${entries.length})`}
        </button>
        {open ? (
          <div className="ml-3 border-l border-[var(--line)] pl-2">
            {visible.map(([key, nested]) => (
              <Node key={key} name={key} query={query} value={nested} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  const rendered = `${label}${formatPrimitive(value)}`;
  if (query && !rendered.toLowerCase().includes(query)) {
    return null;
  }
  return <div className="break-all text-xs">{rendered}</div>;
}

function matches(key: string, value: unknown, query: string): boolean {
  if (key.toLowerCase().includes(query)) {
    return true;
  }
  if (value === null || typeof value !== "object") {
    return String(value).toLowerCase().includes(query);
  }
  if (Array.isArray(value)) {
    return value.some((item, index) => matches(String(index), item, query));
  }
  return Object.entries(value).some(([nestedKey, nested]) => matches(nestedKey, nested, query));
}

function formatPrimitive(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import { identifyEndpoint, isApiObservation, round } from "./endpoints";
import { diffFieldTypes, fieldTypes, parseJsonBody } from "./schema";
import type { ObservedCall } from "./tests";

export interface EndpointChange {
  key: string;
  method: string;
  path: string;
  change: "added" | "removed" | "changed";
  notes: string[];
  left: EndpointSnapshot | null;
  right: EndpointSnapshot | null;
}

export interface EndpointSnapshot {
  calls: number;
  status: number | null;
  latencyMs: number | null;
  fields: string[];
}

export function compareEndpoints(left: ObservedCall[], right: ObservedCall[]): EndpointChange[] {
  const leftGroups = group(left);
  const rightGroups = group(right);
  const keys = new Set([...leftGroups.keys(), ...rightGroups.keys()]);
  const changes: EndpointChange[] = [];
  for (const key of keys) {
    const before = leftGroups.get(key) ?? null;
    const after = rightGroups.get(key) ?? null;
    if (!before || !after) {
      const present = before ?? after;
      changes.push({
        key,
        method: present?.method ?? "GET",
        path: present?.path ?? key,
        change: before ? "removed" : "added",
        notes: [before ? "Not seen in the current scan." : "Not seen in the previous scan."],
        left: before ? snapshot(before.calls) : null,
        right: after ? snapshot(after.calls) : null,
      });
      continue;
    }
    const notes: string[] = [];
    const leftSnap = snapshot(before.calls);
    const rightSnap = snapshot(after.calls);
    if (leftSnap.status !== rightSnap.status) {
      notes.push(`Status ${leftSnap.status ?? "none"} -> ${rightSnap.status ?? "none"}.`);
    }
    if (leftSnap.latencyMs !== null && rightSnap.latencyMs !== null) {
      const delta = round(rightSnap.latencyMs - leftSnap.latencyMs);
      if (Math.abs(delta) >= 50) {
        notes.push(delta > 0 ? `Latency increased by ${delta} ms.` : `Latency improved by ${Math.abs(delta)} ms.`);
      }
    }
    const fields = diffFieldTypes(fieldsAsMap(leftSnap.fields), fieldsAsMap(rightSnap.fields));
    if (fields.added.length > 0) {
      notes.push(`New field: ${fields.added.join(", ")}.`);
    }
    if (fields.removed.length > 0) {
      notes.push(`Removed field: ${fields.removed.join(", ")}.`);
    }
    if (fields.typeChanges.length > 0) {
      notes.push(`Type changed: ${fields.typeChanges.map((change) => change.path).join(", ")}.`);
    }
    if (notes.length === 0) {
      continue;
    }
    changes.push({
      key,
      method: before.method,
      path: before.path,
      change: "changed",
      notes,
      left: leftSnap,
      right: rightSnap,
    });
  }
  return changes.slice(0, 80);
}

function group(calls: ObservedCall[]): Map<string, { method: string; path: string; calls: ObservedCall[] }> {
  const groups = new Map<string, { method: string; path: string; calls: ObservedCall[] }>();
  for (const call of calls) {
    if (!isApiObservation(call) && call.requestClass !== "DOCUMENT") {
      continue;
    }
    const identity = identifyEndpoint(call.method, call.url);
    const existing = groups.get(identity.key);
    if (existing) {
      existing.calls.push(call);
    } else {
      groups.set(identity.key, { method: identity.method, path: `${identity.host}${identity.path}`, calls: [call] });
    }
  }
  return groups;
}

function snapshot(calls: ObservedCall[]): EndpointSnapshot {
  const statuses = calls.map((call) => call.statusCode).filter((status): status is number => status !== null);
  const durations = calls.map((call) => call.totalDuration).filter((value): value is number => value !== null);
  const fields = new Set<string>();
  for (const call of calls) {
    const parsed = parseJsonBody(call.responseBody);
    if (parsed === undefined) {
      continue;
    }
    for (const path of fieldTypes(parsed).keys()) {
      if (!path.includes("[]")) {
        fields.add(path);
      }
    }
  }
  return {
    calls: calls.length,
    status: statuses.sort((a, b) => a - b)[0] ?? null,
    latencyMs: durations.length === 0 ? null : round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    fields: [...fields].sort(),
  };
}

function fieldsAsMap(fields: string[]): Map<string, string> {
  return new Map(fields.map((field) => [field, "present"]));
}

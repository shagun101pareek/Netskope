export interface GraphNode {
  id: string;
  requestId: string;
  label: string;
  statusCode: number | null;
  totalDuration: number | null;
  independent: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "initiator" | "script";
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Connects requests only when Chrome recorded a parent request or a script URL
 * that was itself requested. Timing order alone never creates an edge.
 */
export function buildDependencyGraph(
  requests: {
    id: string;
    requestId: string;
    method: string;
    url: string;
    resourceType: string | null;
    statusCode: number | null;
    totalDuration: number | null;
    initiator: unknown;
  }[],
): DependencyGraph {
  const byProtocolId = new Map(requests.map((request) => [request.requestId, request]));
  const scriptByUrl = new Map<string, string>();
  for (const request of requests) {
    if ((request.resourceType ?? "").toLowerCase() === "script") {
      scriptByUrl.set(request.url, request.id);
    }
  }

  const edges: GraphEdge[] = [];
  const linked = new Set<string>();
  for (const request of requests) {
    const initiator = asRecord(request.initiator);
    const parentProtocolId = typeof initiator?.requestId === "string" ? initiator.requestId : null;
    const parent = parentProtocolId ? byProtocolId.get(parentProtocolId) : undefined;
    if (parent && parent.id !== request.id) {
      edges.push({ from: parent.id, to: request.id, kind: "initiator" });
      linked.add(parent.id);
      linked.add(request.id);
      continue;
    }
    const stack = Array.isArray(initiator?.stack) ? initiator.stack : [];
    for (const frame of stack) {
      const record = asRecord(frame);
      const url = typeof record?.url === "string" ? record.url : null;
      const scriptId = url ? scriptByUrl.get(url) : undefined;
      if (scriptId && scriptId !== request.id) {
        edges.push({ from: scriptId, to: request.id, kind: "script" });
        linked.add(scriptId);
        linked.add(request.id);
        break;
      }
    }
  }

  return {
    nodes: requests.map((request) => ({
      id: request.id,
      requestId: request.requestId,
      label: `${request.method} ${shortPath(request.url)}`,
      statusCode: request.statusCode,
      totalDuration: request.totalDuration,
      independent: !linked.has(request.id),
    })),
    edges,
  };
}

function shortPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.slice(0, 120);
  } catch {
    return url.slice(0, 120);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

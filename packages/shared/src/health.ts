export type DependencyStatus = "up" | "down";

export interface HealthReport {
  status: "ok" | "degraded";
  service: "api";
  checks: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
    worker: DependencyStatus;
  };
  timestamp: string;
}

export interface WorkerHeartbeat {
  service: "worker";
  status: "ok";
  pid: number;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDependencyStatus(value: unknown): value is DependencyStatus {
  return value === "up" || value === "down";
}

export function isWorkerHeartbeat(value: unknown): value is WorkerHeartbeat {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.service === "worker" &&
    value.status === "ok" &&
    typeof value.pid === "number" &&
    Number.isInteger(value.pid) &&
    typeof value.updatedAt === "string"
  );
}

export function isHealthReport(value: unknown): value is HealthReport {
  if (!isRecord(value) || !isRecord(value.checks)) {
    return false;
  }

  return (
    (value.status === "ok" || value.status === "degraded") &&
    value.service === "api" &&
    isDependencyStatus(value.checks.postgres) &&
    isDependencyStatus(value.checks.redis) &&
    isDependencyStatus(value.checks.worker) &&
    typeof value.timestamp === "string"
  );
}

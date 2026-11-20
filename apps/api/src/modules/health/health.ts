import type { HealthReport } from "@netskope/shared";

/**
 * Postgres and Redis are dependencies of the API process.
 * The worker is reported, but a stopped worker does not make the API unable to serve.
 * Scan endpoints added later will reject work when the worker is down.
 */
export function summarizeHealth(
  checks: HealthReport["checks"],
): Pick<HealthReport, "status" | "checks"> {
  const status = checks.postgres === "up" && checks.redis === "up" ? "ok" : "degraded";

  return { status, checks };
}

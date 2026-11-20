/**
 * Redis key published by the browser worker.
 * The API reads it to report worker liveness without giving the worker an HTTP port.
 * A missing or expired key means the worker is down.
 */
export const WORKER_HEARTBEAT_KEY = "netskope:worker:heartbeat";

/** Two missed intervals expire the key, so a dead worker is visible within about 15 seconds. */
export const WORKER_HEARTBEAT_TTL_SECONDS = 15;

export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;

/** BullMQ queue that carries a scan from the API to the browser worker. */
export const SCAN_QUEUE_NAME = "scans";

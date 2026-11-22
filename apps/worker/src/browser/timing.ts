export interface PhaseTiming {
  dnsTime: number | null;
  connectTime: number | null;
  tlsTime: number | null;
  ttfb: number | null;
  downloadTime: number | null;
  totalDuration: number | null;
  timingMetadata?: Record<string, number>;
}

const OFFSETS = [
  "dnsStart",
  "dnsEnd",
  "connectStart",
  "connectEnd",
  "sslStart",
  "sslEnd",
  "sendStart",
  "sendEnd",
  "receiveHeadersStart",
  "receiveHeadersEnd",
] as const;

/**
 * Converts one Chrome ResourceTiming block into millisecond phases.
 * Offsets are milliseconds from requestTime. -1 means Chrome did not record
 * that mark, so the phase stays null. A measured zero stays zero. Stored
 * durations are rounded to the nearest microsecond.
 *
 * Connect time stops where TLS starts, so it is not also counted as TLS.
 * TTFB is Chrome's "Waiting (TTFB)" interval: the end of sending the request
 * until response headers arrive. Download runs from those headers until
 * loadingFinished. Total is loadingFinished minus requestTime.
 */
export function calculatePhaseTiming(input: {
  timing: Record<string, unknown> | null;
  startedAt: number | null;
  finishedAt: number | null;
}): PhaseTiming | null {
  const timing = input.timing;
  const requestTime = timing ? mark(timing, "requestTime") : null;
  const baseline = requestTime ?? input.startedAt;
  const totalDuration =
    baseline !== null && input.finishedAt !== null && input.finishedAt >= baseline
      ? (input.finishedAt - baseline) * 1000
      : null;

  const dnsTime = roundMillis(timing ? span(timing, "dnsStart", "dnsEnd") : null);
  const tlsTime = roundMillis(timing ? span(timing, "sslStart", "sslEnd") : null);
  const connectTime = roundMillis(timing ? connectDuration(timing) : null);
  const ttfb = roundMillis(timing ? span(timing, "sendEnd", "receiveHeadersEnd") : null);
  const headersAt = timing ? mark(timing, "receiveHeadersEnd") : null;
  const roundedTotal = roundMillis(totalDuration);
  const downloadTime = roundMillis(
    roundedTotal !== null && headersAt !== null && roundedTotal >= headersAt ? roundedTotal - headersAt : null,
  );

  const phases: PhaseTiming = {
    dnsTime,
    connectTime,
    tlsTime,
    ttfb,
    downloadTime,
    totalDuration: roundedTotal,
  };
  if (
    phases.dnsTime === null &&
    phases.connectTime === null &&
    phases.tlsTime === null &&
    phases.ttfb === null &&
    phases.downloadTime === null &&
    phases.totalDuration === null
  ) {
    return null;
  }

  const metadata = timingMetadata(timing);
  return metadata ? { ...phases, timingMetadata: metadata } : phases;
}

function connectDuration(timing: Record<string, unknown>): number | null {
  const connectStart = mark(timing, "connectStart");
  const sslStart = mark(timing, "sslStart");
  if (connectStart !== null && sslStart !== null && sslStart >= connectStart) {
    return sslStart - connectStart;
  }
  return span(timing, "connectStart", "connectEnd");
}

function roundMillis(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return Math.round(value * 1000) / 1000;
}

function span(timing: Record<string, unknown>, startKey: string, endKey: string): number | null {
  const start = mark(timing, startKey);
  const end = mark(timing, endKey);
  if (start === null || end === null || end < start) {
    return null;
  }
  return end - start;
}

function mark(timing: Record<string, unknown>, key: string): number | null {
  const value = timing[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function timingMetadata(timing: Record<string, unknown> | null): Record<string, number> | undefined {
  if (!timing) {
    return undefined;
  }
  const metadata: Record<string, number> = {};
  const requestTime = mark(timing, "requestTime");
  if (requestTime !== null) {
    metadata.requestTime = requestTime;
  }
  for (const key of OFFSETS) {
    const value = mark(timing, key);
    if (value !== null) {
      metadata[key] = value;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

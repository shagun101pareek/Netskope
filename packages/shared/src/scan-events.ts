export interface ScanStatusEvent {
  type: "status";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  requestCount?: number;
  errorMessage?: string | null;
}

export function scanEventChannel(scanId: string): string {
  return `netskope:scan:${scanId}`;
}

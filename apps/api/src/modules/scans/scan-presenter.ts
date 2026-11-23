import type { Scan, ScanStatus } from "@netskope/database";

export interface ScanResponse {
  id: string;
  url: string;
  status: ScanStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  captureBodies: boolean;
}

export function presentScan(scan: Pick<
  Scan,
  "id" | "url" | "status" | "startedAt" | "completedAt" | "createdAt" | "errorMessage" | "captureBodies"
>): ScanResponse {
  return {
    id: scan.id,
    url: scan.url,
    status: scan.status,
    startedAt: scan.startedAt?.toISOString() ?? null,
    completedAt: scan.completedAt?.toISOString() ?? null,
    createdAt: scan.createdAt.toISOString(),
    errorMessage: scan.errorMessage,
    captureBodies: scan.captureBodies,
  };
}

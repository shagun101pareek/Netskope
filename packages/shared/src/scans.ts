/** Payload of a BullMQ job on the scan queue. The scan row holds the URL. */
export interface ScanJobData {
  scanId: string;
}

/** Payload of a BullMQ job on the replay queue. The replay row holds the request. */
export interface ReplayJobData {
  replayId: string;
}

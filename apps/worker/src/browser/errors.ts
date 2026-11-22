/** A scan failure that will not succeed on retry. */
export class PermanentScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentScanError";
  }
}

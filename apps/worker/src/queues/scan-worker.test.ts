import "@netskope/shared/load-env";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";
import { isFinalScanFailure, scanFailureMessage } from "./scan-worker.js";

describe("scan failure handling", () => {
  it("retries a crash and stops on the last attempt", () => {
    const error = new Error("browser crashed");
    expect(isFinalScanFailure(error, 1, 3)).toBe(false);
    expect(isFinalScanFailure(error, 3, 3)).toBe(true);
  });

  it("does not retry a policy rejection", () => {
    const error = new UnrecoverableError("That URL is not eligible for scanning.");
    expect(isFinalScanFailure(error, 1, 3)).toBe(true);
    expect(scanFailureMessage(error)).toBe("That URL is not eligible for scanning.");
  });

  it("keeps the stored failure message to the first line", () => {
    const error = new Error("page.goto: Timeout 30000ms exceeded.\nCall log:\n  - waiting");
    expect(scanFailureMessage(error)).toBe("page.goto: Timeout 30000ms exceeded.");
  });
});

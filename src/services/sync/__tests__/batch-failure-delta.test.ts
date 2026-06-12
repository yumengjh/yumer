import { describe, expect, it } from "vitest";
import {
  isDeltaBaseMismatchResult,
  summarizeSyncBatchFailures,
} from "../batch-failure";
import type { SyncBatchResult } from "../types";

describe("batch failure delta handling", () => {
  it("treats DELTA_BASE_MISMATCH as a single-op fallback, not a batch failure", () => {
    const results: SyncBatchResult[] = [
      {
        operation: "update",
        success: false,
        blockId: "b1",
        diagnosticCode: "DELTA_BASE_MISMATCH",
        error: "Delta rejected: DELTA_BASE_MISMATCH",
      },
      {
        operation: "update",
        success: true,
        blockId: "b2",
      },
    ];

    expect(isDeltaBaseMismatchResult(results[0])).toBe(true);
    expect(summarizeSyncBatchFailures(results)).toBeNull();
  });

  it("still reports other update failures", () => {
    const results: SyncBatchResult[] = [
      {
        operation: "update",
        success: false,
        blockId: "b1",
        error: "Block not found",
      },
    ];

    expect(summarizeSyncBatchFailures(results)).toBe("update: Block not found");
  });
});

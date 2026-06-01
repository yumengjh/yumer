import { describe, expect, it } from "vitest";
import {
  isIdempotentDeleteNotFoundResult,
  summarizeSyncBatchFailures,
} from "../batch-failure";

describe("sync batch failure handling", () => {
  it("ignores delete not found failures as idempotent success", () => {
    expect(
      isIdempotentDeleteNotFoundResult({
        operation: "delete",
        success: false,
        blockId: "b_missing",
        error: "Block not found",
      }),
    ).toBe(true);
    expect(
      summarizeSyncBatchFailures([
        {
          operation: "delete",
          success: false,
          blockId: "b_missing",
          error: "Block not found",
        },
      ]),
    ).toBeNull();
  });

  it("summarizes non-idempotent operation failures", () => {
    expect(
      summarizeSyncBatchFailures([
        {
          operation: "update",
          success: true,
          blockId: "b_1",
        },
        {
          operation: "move",
          success: false,
          blockId: "b_1",
          error: "Parent block not found",
        },
      ]),
    ).toBe("move: Parent block not found");
  });
});

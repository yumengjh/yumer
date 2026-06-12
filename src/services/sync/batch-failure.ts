import type { SyncBatchResult } from "./types";

export function isDeltaBaseMismatchResult(result: SyncBatchResult): boolean {
  return !result.success && result.diagnosticCode === "DELTA_BASE_MISMATCH";
}

export function isIdempotentDeleteNotFoundResult(result: SyncBatchResult): boolean {
  if (result.success || result.operation !== "delete") return false;
  const message = (result.error ?? "").toString().toLowerCase();
  return message.includes("not found") || message.includes("不存在");
}

export function summarizeSyncBatchFailures(results: SyncBatchResult[]): string | null {
  const failures = results.filter(
    (result) =>
      !result.success &&
      !isIdempotentDeleteNotFoundResult(result) &&
      !isDeltaBaseMismatchResult(result),
  );
  if (failures.length === 0) return null;
  return failures
    .map((result) => `${result.operation}: ${result.error || "unknown error"}`)
    .join("; ");
}

import { describe, expect, it } from "vitest";
import { shouldCaptureLocalSnapshotChange } from "./local-snapshot-policy";

describe("local snapshot capture policy", () => {
  it("does not capture programmatic content overwrites", () => {
    expect(shouldCaptureLocalSnapshotChange({
      autoSave: true,
      hasUnsavedChanges: true,
      suppressCapture: true,
    })).toBe(false);
  });

  it("captures the first user edit once auto-save is enabled", () => {
    expect(shouldCaptureLocalSnapshotChange({
      autoSave: true,
      hasUnsavedChanges: true,
      suppressCapture: false,
    })).toBe(true);
  });

  it("does not capture when the document has not entered an unsaved edit state", () => {
    expect(shouldCaptureLocalSnapshotChange({
      autoSave: true,
      hasUnsavedChanges: false,
      suppressCapture: false,
    })).toBe(false);
  });

  it("does not capture when auto-save is disabled", () => {
    expect(shouldCaptureLocalSnapshotChange({
      autoSave: false,
      hasUnsavedChanges: true,
      suppressCapture: false,
    })).toBe(false);
  });
});

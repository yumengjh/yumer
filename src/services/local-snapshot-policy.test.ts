import { describe, expect, it } from "vitest";
import { shouldCaptureLocalSnapshotChange } from "./local-snapshot-policy";

describe("local snapshot capture policy", () => {
  it("does not capture programmatic content overwrites", () => {
    expect(shouldCaptureLocalSnapshotChange({
      autoSave: true,
      wasEdited: true,
      suppressCapture: true,
    })).toBe(false);
  });

  it("captures normal edits after the first observed edit", () => {
    expect(shouldCaptureLocalSnapshotChange({
      autoSave: true,
      wasEdited: true,
      suppressCapture: false,
    })).toBe(true);
  });

  it("does not capture the first observed edit after loading", () => {
    expect(shouldCaptureLocalSnapshotChange({
      autoSave: true,
      wasEdited: false,
      suppressCapture: false,
    })).toBe(false);
  });
});

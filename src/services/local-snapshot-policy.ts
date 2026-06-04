export function shouldCaptureLocalSnapshotChange(input: {
  autoSave: boolean;
  hasUnsavedChanges: boolean;
  suppressCapture: boolean;
}): boolean {
  return Boolean(input.autoSave && input.hasUnsavedChanges && !input.suppressCapture);
}

export function shouldCaptureLocalSnapshotChange(input: {
  autoSave: boolean;
  wasEdited: boolean;
  suppressCapture: boolean;
}): boolean {
  return Boolean(input.autoSave && input.wasEdited && !input.suppressCapture);
}

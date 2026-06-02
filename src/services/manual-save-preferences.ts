export type ManualSaveMode = "incremental" | "reload";

export const MANUAL_SAVE_MODE_STORAGE_KEY = "yuediter:manual-save-mode";
export const DEFAULT_MANUAL_SAVE_MODE: ManualSaveMode = "incremental";

export function normalizeManualSaveMode(value: unknown): ManualSaveMode {
  return value === "reload" ? "reload" : DEFAULT_MANUAL_SAVE_MODE;
}

export function readManualSaveMode(): ManualSaveMode {
  if (typeof window === "undefined") return DEFAULT_MANUAL_SAVE_MODE;
  return normalizeManualSaveMode(window.localStorage.getItem(MANUAL_SAVE_MODE_STORAGE_KEY));
}

export function writeManualSaveMode(mode: ManualSaveMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MANUAL_SAVE_MODE_STORAGE_KEY, normalizeManualSaveMode(mode));
}

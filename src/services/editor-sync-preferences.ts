export const EDITOR_SYNC_PREFERENCES_STORAGE_KEY = "yuediter:editor-sync-preferences";

export interface EditorSyncPreferences {
  documentSyncDelayMs: number;
  autoRememberEditPosition: boolean;
}

export const DOCUMENT_SYNC_DELAY_MIN_MS = 200;
export const DOCUMENT_SYNC_DELAY_MAX_MS = 3000;
export const DEFAULT_DOCUMENT_SYNC_DELAY_MS = 600;

export const DEFAULT_EDITOR_SYNC_PREFERENCES: EditorSyncPreferences = {
  documentSyncDelayMs: DEFAULT_DOCUMENT_SYNC_DELAY_MS,
  autoRememberEditPosition: true,
};

function normalizeDocumentSyncDelay(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_DOCUMENT_SYNC_DELAY_MS;
  }

  return Math.min(
    DOCUMENT_SYNC_DELAY_MAX_MS,
    Math.max(DOCUMENT_SYNC_DELAY_MIN_MS, Math.round(value)),
  );
}

export function normalizeEditorSyncPreferences(value: unknown): EditorSyncPreferences {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    documentSyncDelayMs: normalizeDocumentSyncDelay(source.documentSyncDelayMs),
    autoRememberEditPosition:
      typeof source.autoRememberEditPosition === "boolean"
        ? source.autoRememberEditPosition
        : DEFAULT_EDITOR_SYNC_PREFERENCES.autoRememberEditPosition,
  };
}

export function readEditorSyncPreferences(): EditorSyncPreferences {
  if (typeof window === "undefined") return DEFAULT_EDITOR_SYNC_PREFERENCES;

  const saved = window.localStorage.getItem(EDITOR_SYNC_PREFERENCES_STORAGE_KEY);
  if (!saved) return DEFAULT_EDITOR_SYNC_PREFERENCES;

  try {
    return normalizeEditorSyncPreferences(JSON.parse(saved));
  } catch {
    return DEFAULT_EDITOR_SYNC_PREFERENCES;
  }
}

export function writeEditorSyncPreferences(preferences: EditorSyncPreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    EDITOR_SYNC_PREFERENCES_STORAGE_KEY,
    JSON.stringify(normalizeEditorSyncPreferences(preferences)),
  );
}

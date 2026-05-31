import {
  FLOATING_TOOLBAR_ITEMS,
  type FloatingToolbarItemId,
} from "@/components/markdown-editor/Toolbar/floatingToolbarItems";

export const EDITOR_TOOLBAR_PREFERENCES_STORAGE_KEY = "yuediter:editor-toolbar-preferences";

export interface EditorToolbarPreferences {
  floatingToolbarEnabled: boolean;
  showFixedToolbarWithFloating: boolean;
  floatingToolbarDelayMs: number;
  floatingItems: Record<FloatingToolbarItemId, boolean>;
}

const FLOATING_TOOLBAR_DELAY_MIN = 0;
const FLOATING_TOOLBAR_DELAY_MAX = 1200;
export const DEFAULT_FLOATING_TOOLBAR_DELAY_MS = 180;

const DEFAULT_FLOATING_ITEMS = FLOATING_TOOLBAR_ITEMS.reduce(
  (acc, item) => {
    acc[item.id] = item.defaultEnabled;
    return acc;
  },
  {} as Record<FloatingToolbarItemId, boolean>,
);

export const DEFAULT_EDITOR_TOOLBAR_PREFERENCES: EditorToolbarPreferences = {
  floatingToolbarEnabled: false,
  showFixedToolbarWithFloating: false,
  floatingToolbarDelayMs: DEFAULT_FLOATING_TOOLBAR_DELAY_MS,
  floatingItems: DEFAULT_FLOATING_ITEMS,
};

function normalizeFloatingToolbarDelay(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_FLOATING_TOOLBAR_DELAY_MS;
  }

  return Math.min(
    FLOATING_TOOLBAR_DELAY_MAX,
    Math.max(FLOATING_TOOLBAR_DELAY_MIN, Math.round(value)),
  );
}

function normalizeFloatingItems(value: unknown): Record<FloatingToolbarItemId, boolean> {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const normalized = { ...DEFAULT_FLOATING_ITEMS };

  for (const item of FLOATING_TOOLBAR_ITEMS) {
    const stored = source[item.id];
    if (typeof stored === "boolean") {
      normalized[item.id] = stored;
    }
  }

  return normalized;
}

export function normalizeEditorToolbarPreferences(value: unknown): EditorToolbarPreferences {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    floatingToolbarEnabled:
      typeof source.floatingToolbarEnabled === "boolean"
        ? source.floatingToolbarEnabled
        : DEFAULT_EDITOR_TOOLBAR_PREFERENCES.floatingToolbarEnabled,
    showFixedToolbarWithFloating:
      typeof source.showFixedToolbarWithFloating === "boolean"
        ? source.showFixedToolbarWithFloating
        : DEFAULT_EDITOR_TOOLBAR_PREFERENCES.showFixedToolbarWithFloating,
    floatingToolbarDelayMs: normalizeFloatingToolbarDelay(source.floatingToolbarDelayMs),
    floatingItems: normalizeFloatingItems(source.floatingItems),
  };
}

export function readEditorToolbarPreferences(): EditorToolbarPreferences {
  if (typeof window === "undefined") return DEFAULT_EDITOR_TOOLBAR_PREFERENCES;

  const saved = window.localStorage.getItem(EDITOR_TOOLBAR_PREFERENCES_STORAGE_KEY);
  if (!saved) return DEFAULT_EDITOR_TOOLBAR_PREFERENCES;

  try {
    return normalizeEditorToolbarPreferences(JSON.parse(saved));
  } catch {
    return DEFAULT_EDITOR_TOOLBAR_PREFERENCES;
  }
}

export function writeEditorToolbarPreferences(preferences: EditorToolbarPreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    EDITOR_TOOLBAR_PREFERENCES_STORAGE_KEY,
    JSON.stringify(normalizeEditorToolbarPreferences(preferences)),
  );
}

export function getEnabledFloatingToolbarItemIds(
  preferences: EditorToolbarPreferences,
): FloatingToolbarItemId[] {
  const normalized = normalizeEditorToolbarPreferences(preferences);
  return FLOATING_TOOLBAR_ITEMS
    .filter((item) => normalized.floatingItems[item.id])
    .map((item) => item.id);
}

export { FLOATING_TOOLBAR_ITEMS };
export type { FloatingToolbarItemId };

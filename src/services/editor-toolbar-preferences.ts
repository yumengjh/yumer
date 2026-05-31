export const EDITOR_TOOLBAR_PREFERENCES_STORAGE_KEY = "yuediter:editor-toolbar-preferences";

export const FLOATING_TOOLBAR_ITEMS = [
  { id: "text-mode", label: "段落/标题", defaultEnabled: true },
  { id: "font-size", label: "字号", defaultEnabled: true },
  { id: "bold", label: "加粗", defaultEnabled: true },
  { id: "italic", label: "斜体", defaultEnabled: true },
  { id: "underline", label: "下划线", defaultEnabled: true },
  { id: "strike", label: "删除线", defaultEnabled: true },
  { id: "text-color", label: "文字颜色", defaultEnabled: true },
  { id: "bg-color", label: "背景色", defaultEnabled: true },
  { id: "link", label: "链接", defaultEnabled: true },
  { id: "bullet-list", label: "无序列表", defaultEnabled: true },
  { id: "ordered-list", label: "有序列表", defaultEnabled: true },
  { id: "check-list", label: "待办列表", defaultEnabled: false },
  { id: "text-align", label: "对齐", defaultEnabled: false },
  { id: "line-height", label: "行高", defaultEnabled: false },
  { id: "clearFormat", label: "清除格式", defaultEnabled: true },
  { id: "format-painter", label: "格式刷", defaultEnabled: false },
  { id: "blockquote", label: "引用", defaultEnabled: false },
  { id: "divider", label: "分割线", defaultEnabled: false },
  { id: "image", label: "图片", defaultEnabled: false },
  { id: "table", label: "表格", defaultEnabled: false },
  { id: "code-language", label: "代码语言", defaultEnabled: false },
  { id: "code-cleanup", label: "代码清理", defaultEnabled: false },
] as const;

export type FloatingToolbarItemId = (typeof FLOATING_TOOLBAR_ITEMS)[number]["id"];

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

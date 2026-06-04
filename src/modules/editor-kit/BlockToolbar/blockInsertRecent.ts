import type { BlockInsertType } from "./blockInsertMenuItems";

const STORAGE_KEY = "yuediter:block-insert-recent";
const MAX_RECENT_ITEMS = 6;

export type BlockInsertRecentItemId = BlockInsertType | "image" | "attachment" | "status";

function normalizeRecentItems(value: unknown): BlockInsertRecentItemId[] {
  if (!Array.isArray(value)) return [];

  const allowed = new Set<BlockInsertRecentItemId>([
    "paragraph",
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "heading5",
    "heading6",
    "bulletList",
    "orderedList",
    "taskList",
    "blockquote",
    "codeBlock",
    "link",
    "divider",
    "table",
    "image",
    "attachment",
    "status",
  ]);

  return value
    .filter((item): item is BlockInsertRecentItemId => typeof item === "string" && allowed.has(item as BlockInsertRecentItemId))
    .slice(0, MAX_RECENT_ITEMS);
}

export function loadRecentBlockInsertItems(): BlockInsertRecentItemId[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    return normalizeRecentItems(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveRecentBlockInsertItems(items: BlockInsertRecentItemId[]): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeRecentItems(items)));
}

export function pushRecentBlockInsertItem(item: BlockInsertRecentItemId): BlockInsertRecentItemId[] {
  const next = [item, ...loadRecentBlockInsertItems().filter((current) => current !== item)].slice(0, MAX_RECENT_ITEMS);
  saveRecentBlockInsertItems(next);
  return next;
}

export function removeRecentBlockInsertItem(item: BlockInsertRecentItemId): BlockInsertRecentItemId[] {
  const next = loadRecentBlockInsertItems().filter((current) => current !== item);
  saveRecentBlockInsertItems(next);
  return next;
}

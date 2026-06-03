const FILTER_STORAGE_KEY = "yuediter:local-snapshot:compare-filters";

export const DEFAULT_FILTER_KEYS: readonly string[] = [
  "clientId",
  "data-client-id",
  "syncCreateId",
  "clientBatchId",
  "data-sync-create-id",
  "data-block-id",
  "data-sort-key",
];

export function loadFilterKeys(): string[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return [...DEFAULT_FILTER_KEYS];
  }

  const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
  if (!raw) return [...DEFAULT_FILTER_KEYS];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
      return parsed;
    }
    return [...DEFAULT_FILTER_KEYS];
  } catch {
    return [...DEFAULT_FILTER_KEYS];
  }
}

export function saveFilterKeys(keys: string[]): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(keys));
}

export function deepFilterKeys(value: unknown, keys: Set<string>): unknown {
  if (keys.size === 0) return value;
  if (Array.isArray(value)) return value.map((item) => deepFilterKeys(item, keys));
  if (!value || typeof value !== "object") return value;

  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    const next = deepFilterKeys(raw[key], keys);
    if (key === "attrs" && next && typeof next === "object" && !Array.isArray(next)) {
      const attrs = next as Record<string, unknown>;
      if (attrs.blockId == null && typeof raw[key] === "object" && raw[key] && !Array.isArray(raw[key])) {
        const rawAttrs = raw[key] as Record<string, unknown>;
        if (typeof rawAttrs["data-block-id"] === "string") {
          attrs.blockId = rawAttrs["data-block-id"];
        }
      }
      if (attrs.sortKey == null && typeof raw[key] === "object" && raw[key] && !Array.isArray(raw[key])) {
        const rawAttrs = raw[key] as Record<string, unknown>;
        if (typeof rawAttrs["data-sort-key"] === "string") {
          attrs.sortKey = rawAttrs["data-sort-key"];
        }
      }
      out[key] = attrs;
      continue;
    }
    if (keys.has(key)) continue;
    out[key] = next;
  }
  return out;
}

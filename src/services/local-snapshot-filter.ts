const FILTER_STORAGE_KEY = "yuediter:local-snapshot:compare-filters";

export const DEFAULT_FILTER_KEYS: readonly string[] = [
  "syncCreateId",
  "clientBatchId",
  "data-sync-create-id",
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
    if (keys.has(key)) continue;
    out[key] = deepFilterKeys(raw[key], keys);
  }
  return out;
}

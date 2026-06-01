const UNSUPPORTED_SYNC_ATTR_KEYS = new Set([
  "data-block-id",
  "data-client-id",
  "data-sort-key",
  "syncCreateId",
  "data-sync-create-id",
  "clientBatchId",
]);

export function stripUnsupportedSyncAttrs(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const stripped = stripUnsupportedSyncAttrs(item);
      if (stripped !== item) changed = true;
      return stripped;
    });
    return changed ? next : value;
  }

  if (!value || typeof value !== "object") return value;

  const raw = value as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = {};

  for (const [key, rawChild] of Object.entries(raw)) {
    if (
      key === "attrs" &&
      rawChild &&
      typeof rawChild === "object" &&
      !Array.isArray(rawChild)
    ) {
      const attrs: Record<string, unknown> = {};
      let attrsChanged = false;
      for (const [attrKey, attrValue] of Object.entries(
        rawChild as Record<string, unknown>,
      )) {
        if (UNSUPPORTED_SYNC_ATTR_KEYS.has(attrKey)) {
          attrsChanged = true;
          continue;
        }
        attrs[attrKey] = attrValue;
      }
      out[key] = attrsChanged ? attrs : rawChild;
      if (attrsChanged) changed = true;
      continue;
    }

    const child = stripUnsupportedSyncAttrs(rawChild);
    if (child !== rawChild) changed = true;
    out[key] = child;
  }

  return changed ? out : value;
}

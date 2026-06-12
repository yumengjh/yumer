export {
  canonicalStringify,
  canonicalPayloadSize,
  computeDelta,
  applyDelta,
  hashPayloadCanonical,
  buildBlockDelta,
  shouldSendDelta,
  DELTA_FORMAT,
  DELTA_MIN_FULL_SIZE,
  DELTA_MAX_RATIO,
} from "./delta";

/** update 请求瘦身：剥离 attrs 中的同步/排序元数据，由顶层字段承载。 */
export function stripPayloadForSync(payload: Record<string, unknown>): Record<string, unknown> {
  const attrs = (payload.attrs as Record<string, unknown> | undefined) ?? {};
  const nextAttrs = { ...attrs };
  for (const key of [
    "blockId",
    "clientId",
    "sortKey",
    "syncCreateId",
    "clientBatchId",
    "data-block-id",
    "data-client-id",
    "data-sort-key",
    "data-sync-create-id",
  ]) {
    delete nextAttrs[key];
  }
  return { ...payload, attrs: nextAttrs };
}

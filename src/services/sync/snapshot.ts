import type { TiptapDoc, TiptapNode } from "@/services/tiptap-converter";
import {
  alignSortKeysToVisualOrder,
  analyzeSortKeyIntegrity,
  applySortKeyRepairs,
  createSyncSnapshotIndex,
  deriveSyncEntriesWithMetrics,
  hasCorruptedSortKeys,
  hasVisualOrderDrift,
  normalizeEditorDoc,
  planRepositionSortKeyRepairs,
  planSortKeyRepairs,
  type SyncSnapshotIndex,
} from "@/services/sync/engine";
import { readIdentityFromAttrs } from "@/services/sync/identity";
import { enqueueChange } from "@/services/sync/reducer";
import { canonicalStringify, stripPayloadForSync } from "./delta-encoding";
import type {
  SyncDiffHint,
  SyncDiffMetrics,
  SyncEntry,
  SyncReducerState,
} from "@/services/sync/types";

function applyLocalSortKeys(
  snapshot: TiptapDoc,
  state: SyncReducerState,
): TiptapDoc {
  if (!Array.isArray(snapshot.content)) return snapshot;

  let changed = false;
  const content = snapshot.content.map((node) => {
    const identity = readIdentityFromAttrs(node.attrs);
    const clientId = identity.clientId ?? null;
    if (!clientId) return node;

    const entry = state.entries[clientId];
    if (!entry?.sortKey) return node;
    if (node.attrs?.sortKey === entry.sortKey) return node;

    changed = true;
    return {
      ...node,
      attrs: {
        ...(node.attrs ?? {}),
        sortKey: entry.sortKey,
      },
    };
  });

  return changed ? { ...snapshot, content } : snapshot;
}

function shouldCreateInitialUnsyncedContent(snapshot: TiptapDoc): boolean {
  const nodes = Array.isArray(snapshot.content) ? snapshot.content : [];
  return nodes.some((node) => {
    const identity = readIdentityFromAttrs(node.attrs);
    if (identity.blockId) return false;
    if (Array.isArray(node.content) && node.content.length > 0) return true;
    return node.type !== "paragraph" && node.type !== "heading";
  });
}

function collectLiveSyncKeys(snapshot: TiptapDoc): Set<string> {
  const liveKeys = new Set<string>();
  const nodes = Array.isArray(snapshot.content) ? snapshot.content : [];
  for (const node of nodes) {
    const identity = readIdentityFromAttrs(node.attrs);
    if (identity.clientId) liveKeys.add(identity.clientId);
    if (identity.blockId) liveKeys.add(identity.blockId);
  }
  return liveKeys;
}

function reconcilePendingEntriesWithSnapshot(
  state: SyncReducerState,
  snapshot: TiptapDoc,
): SyncReducerState {
  const liveKeys = collectLiveSyncKeys(snapshot);
  let nextState = state;

  for (const entry of Object.values(state.entries)) {
    if (entry.opType === "delete") continue;
    const hasLiveClient = liveKeys.has(entry.clientId);
    const hasLiveBlock = entry.blockId ? liveKeys.has(entry.blockId) : false;
    if (hasLiveClient || hasLiveBlock) continue;

    nextState = enqueueChange(nextState, {
      clientId: entry.clientId,
      blockId: entry.blockId,
      opType: "delete",
      syncCreateId: entry.syncCreateId,
    });
  }

  return nextState;
}

/**
 * sortKey 主动修复：检测到重复/乱序/非法 key 时，按视觉顺序重新分配并入队
 * move（pending create 则合并进 create entry），同时把修复结果写回快照，
 * 保证后续 diff 基于干净的 key 序列。
 */
export function repairSnapshotSortKeyOrder(
  state: SyncReducerState,
  snapshot: TiptapDoc,
  previousSnapshot?: TiptapDoc | null,
  options: {
    enqueueMoves?: boolean;
    suppressedMoveSortKeys?: ReadonlyMap<string, ReadonlySet<string>>;
  } = {},
): {
  state: SyncReducerState;
  snapshot: TiptapDoc;
  repairedCount: number;
} {
  const enqueueMoves = options.enqueueMoves !== false;
  const report = analyzeSortKeyIntegrity(snapshot);
  const corrupted = hasCorruptedSortKeys(report);

  const repairByClientId = new Map<
    string,
    { clientId: string; blockId: string | null; sortKey: string }
  >();

  if (corrupted) {
    for (const repair of planSortKeyRepairs(snapshot)) {
      repairByClientId.set(repair.clientId, repair);
    }
  }

  if (previousSnapshot) {
    for (const repair of planRepositionSortKeyRepairs(previousSnapshot, snapshot)) {
      repairByClientId.set(repair.clientId, repair);
    }
  }

  // 仅修复可寻址的块：有 blockId（可发 move）或已有 pending entry（可合并 sortKey）
  const repairs = [...repairByClientId.values()].filter(
    (repair) => repair.blockId || state.entries[repair.clientId],
  ).filter((repair) => {
    if (!repair.blockId) return true;
    const rejected = options.suppressedMoveSortKeys?.get(repair.blockId);
    return !rejected?.has(repair.sortKey);
  });
  if (repairs.length === 0) {
    return { state, snapshot, repairedCount: 0 };
  }

  if (!enqueueMoves) {
    return {
      state,
      snapshot: applySortKeyRepairs(snapshot, repairs),
      repairedCount: repairs.length,
    };
  }

  let nextState = state;
  for (const repair of repairs) {
    nextState = enqueueChange(nextState, {
      clientId: repair.clientId,
      blockId: repair.blockId,
      opType: "move",
      sortKey: repair.sortKey,
    });
  }

  return {
    state: nextState,
    snapshot: applySortKeyRepairs(snapshot, repairs),
    repairedCount: repairs.length,
  };
}

function createIdleMetrics(input: {
  topLevelCount: number;
  fingerprintCount: number;
  durationMs: number;
}): SyncDiffMetrics {
  return {
    mode: "fallback-full",
    topLevelCount: input.topLevelCount,
    dirtyCandidateCount: 0,
    fingerprintCount: input.fingerprintCount,
    sortPlanRan: false,
    derivedEntryCount: 0,
    durationMs: input.durationMs,
  };
}

export type SyncSnapshotCaptureSource =
  | "editor-effect"
  | "batch-ack-rescan"
  | "ack-content-patch"
  | "manual-save-capture";

const SKIP_DERIVE_WHEN_CANONICALLY_EQUAL_SOURCES = new Set<SyncSnapshotCaptureSource>([
  "editor-effect",
  "batch-ack-rescan",
  "ack-content-patch",
]);

function shouldSkipDeriveWhenCanonicallyEqual(
  source?: SyncSnapshotCaptureSource,
): boolean {
  return source ? SKIP_DERIVE_WHEN_CANONICALLY_EQUAL_SOURCES.has(source) : false;
}

function collectTopLevelSyncNodes(doc: TiptapDoc): Map<string, TiptapNode> {
  const nodes = new Map<string, TiptapNode>();
  for (const node of doc.content ?? []) {
    const identity = readIdentityFromAttrs(node.attrs);
    const key = identity.blockId ?? identity.clientId;
    if (key) nodes.set(key, node);
  }
  return nodes;
}

/** 按 blockId/clientId 对比各块 canonical payload，忽略仅 sync attrs 的差异。 */
export function docSyncPayloadsEqual(left: TiptapDoc, right: TiptapDoc): boolean {
  const leftNodes = collectTopLevelSyncNodes(left);
  const rightNodes = collectTopLevelSyncNodes(right);
  if (leftNodes.size !== rightNodes.size) return false;

  for (const [key, leftNode] of leftNodes) {
    const rightNode = rightNodes.get(key);
    if (!rightNode) return false;
    if (canonicalStringify(leftNode) !== canonicalStringify(rightNode)) {
      return false;
    }
  }
  return true;
}

export type SyncSnapshotCaptureOptions = {
  suppressMoveDerivation?: boolean;
  suppressedMoveSortKeys?: ReadonlyMap<string, ReadonlySet<string>>;
  /** false 时只写回本地 snapshot sortKey，不入队 move（用于 ACK 后避免与服务端打架） */
  enqueueSortKeyRepairs?: boolean;
  /** batch ACK 后：刚成功同步的 block canonical，用于过滤 rescan 产生的冗余 update */
  ackSyncedPayloadByBlockId?: ReadonlyMap<string, string>;
  captureSource?: SyncSnapshotCaptureSource;
};

export function filterRedundantAckRescanEntries(
  entries: SyncEntry[],
  ackSyncedPayloadByBlockId?: ReadonlyMap<string, string>,
): SyncEntry[] {
  if (!ackSyncedPayloadByBlockId?.size) return entries;

  return entries.filter((entry) => {
    if (entry.opType !== "update" || !entry.blockId || !entry.payload) return true;
    const syncedCanonical = ackSyncedPayloadByBlockId.get(entry.blockId);
    if (!syncedCanonical) return true;
    const nextCanonical = canonicalStringify(stripPayloadForSync(entry.payload));
    return nextCanonical !== syncedCanonical;
  });
}

export function advanceSyncSnapshotIndexed(
  state: SyncReducerState,
  previousSnapshot: TiptapDoc | null,
  previousIndex: SyncSnapshotIndex | null,
  content: TiptapDoc,
  hint?: SyncDiffHint | null,
  captureOptions?: SyncSnapshotCaptureOptions,
): {
  state: SyncReducerState;
  snapshot: TiptapDoc;
  index: SyncSnapshotIndex;
  metrics: SyncDiffMetrics;
} {
  const start = Date.now();
  let normalizedSnapshot = normalizeEditorDoc(content);
  if (hasVisualOrderDrift(normalizedSnapshot)) {
    normalizedSnapshot = alignSortKeysToVisualOrder(normalizedSnapshot);
  }
  if (
    previousSnapshot &&
    shouldSkipDeriveWhenCanonicallyEqual(captureOptions?.captureSource) &&
    docSyncPayloadsEqual(previousSnapshot, normalizedSnapshot)
  ) {
    const index = createSyncSnapshotIndex(normalizedSnapshot, {
      computePayloadFingerprints: true,
    });
    return {
      state,
      snapshot: normalizedSnapshot,
      index,
      metrics: createIdleMetrics({
        topLevelCount: index.blocks.length,
        fingerprintCount: index.blocks.length,
        durationMs: Date.now() - start,
      }),
    };
  }
  if (!previousSnapshot) {
    let nextState = state;
    let metrics: SyncDiffMetrics | null = null;
    if (shouldCreateInitialUnsyncedContent(normalizedSnapshot)) {
      const derived = deriveSyncEntriesWithMetrics(
        { type: "doc", content: [] },
        normalizedSnapshot,
        { hint },
      );
      metrics = derived.metrics;
      for (const entry of derived.entries) {
        nextState = enqueueChange(nextState, entry);
      }
    }
    const localSnapshot = applyLocalSortKeys(normalizedSnapshot, nextState);
    const initialReport = analyzeSortKeyIntegrity(localSnapshot);
    const repaired = repairSnapshotSortKeyOrder(nextState, localSnapshot);
    nextState = repaired.state;
    const snapshot = repaired.snapshot;
    const finalReport =
      repaired.repairedCount > 0 ? analyzeSortKeyIntegrity(snapshot) : initialReport;
    const corrupted = hasCorruptedSortKeys(finalReport);
    const index = createSyncSnapshotIndex(snapshot, {
      computePayloadFingerprints: true,
    });
    return {
      state: {
        ...nextState,
        hasCorruptedSortKeys: corrupted,
        sortKeyCorruptionReport: corrupted ? finalReport : null,
      },
      snapshot,
      index,
      metrics:
        metrics ??
        createIdleMetrics({
          topLevelCount: index.blocks.length,
          fingerprintCount: index.blocks.length,
          durationMs: Date.now() - start,
        }),
    };
  }

  const deriveOptions = {
    previousIndex,
    hint,
    suppressMoveDerivation: captureOptions?.suppressMoveDerivation,
    suppressedMoveSortKeys: captureOptions?.suppressedMoveSortKeys,
  };
  const repairOptions = {
    enqueueMoves: captureOptions?.enqueueSortKeyRepairs !== false,
    suppressedMoveSortKeys: captureOptions?.suppressedMoveSortKeys,
  };

  const derived = deriveSyncEntriesWithMetrics(
    previousSnapshot,
    normalizedSnapshot,
    deriveOptions,
  );
  const entries = filterRedundantAckRescanEntries(
    derived.entries,
    captureOptions?.ackSyncedPayloadByBlockId,
  );
  let nextState = state;
  for (const entry of entries) {
    nextState = enqueueChange(nextState, entry);
  }
  nextState = reconcilePendingEntriesWithSnapshot(
    nextState,
    normalizedSnapshot,
  );

  const localSnapshot = applyLocalSortKeys(normalizedSnapshot, nextState);
  const repaired = repairSnapshotSortKeyOrder(
    nextState,
    localSnapshot,
    previousSnapshot,
    repairOptions,
  );
  nextState = repaired.state;
  const snapshot = repaired.snapshot;
  const report = analyzeSortKeyIntegrity(snapshot);
  const corrupted = hasCorruptedSortKeys(report);
  return {
    state: {
      ...nextState,
      hasCorruptedSortKeys: corrupted,
      sortKeyCorruptionReport: corrupted ? report : null,
    },
    snapshot,
    index:
      snapshot === normalizedSnapshot
        ? derived.nextIndex
        : createSyncSnapshotIndex(snapshot, {
            computePayloadFingerprints: true,
          }),
    metrics: {
      ...derived.metrics,
      derivedEntryCount: entries.length,
    },
  };
}

export function advanceSyncSnapshot(
  state: SyncReducerState,
  previousSnapshot: TiptapDoc | null,
  content: TiptapDoc,
): { state: SyncReducerState; snapshot: TiptapDoc } {
  const advanced = advanceSyncSnapshotIndexed(
    state,
    previousSnapshot,
    null,
    content,
  );
  return {
    state: advanced.state,
    snapshot: advanced.snapshot,
  };
}

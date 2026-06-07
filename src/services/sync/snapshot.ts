import type { TiptapDoc } from "@/services/tiptap-converter";
import {
  analyzeSortKeyIntegrity,
  createSyncSnapshotIndex,
  deriveSyncEntriesWithMetrics,
  hasCorruptedSortKeys,
  normalizeEditorDoc,
  type SyncSnapshotIndex,
} from "@/services/sync/engine";
import { readIdentityFromAttrs } from "@/services/sync/identity";
import { enqueueChange } from "@/services/sync/reducer";
import type {
  SyncDiffHint,
  SyncDiffMetrics,
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

export function advanceSyncSnapshotIndexed(
  state: SyncReducerState,
  previousSnapshot: TiptapDoc | null,
  previousIndex: SyncSnapshotIndex | null,
  content: TiptapDoc,
  hint?: SyncDiffHint | null,
): {
  state: SyncReducerState;
  snapshot: TiptapDoc;
  index: SyncSnapshotIndex;
  metrics: SyncDiffMetrics;
} {
  const start = Date.now();
  const normalizedSnapshot = normalizeEditorDoc(content);
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
    const report = analyzeSortKeyIntegrity(normalizedSnapshot);
    const snapshot = applyLocalSortKeys(normalizedSnapshot, nextState);
    const index = createSyncSnapshotIndex(snapshot, {
      computePayloadFingerprints: true,
    });
    return {
      state: {
        ...nextState,
        hasCorruptedSortKeys: hasCorruptedSortKeys(report),
        sortKeyCorruptionReport: hasCorruptedSortKeys(report) ? report : null,
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

  const derived = deriveSyncEntriesWithMetrics(
    previousSnapshot,
    normalizedSnapshot,
    { previousIndex, hint },
  );
  let nextState = state;
  for (const entry of derived.entries) {
    nextState = enqueueChange(nextState, entry);
  }
  nextState = reconcilePendingEntriesWithSnapshot(
    nextState,
    normalizedSnapshot,
  );

  const snapshot = applyLocalSortKeys(normalizedSnapshot, nextState);
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
    metrics: derived.metrics,
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

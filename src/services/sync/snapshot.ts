import type { TiptapDoc } from "@/services/tiptap-converter";
import {
  analyzeSortKeyIntegrity,
  deriveSyncEntries,
  hasCorruptedSortKeys,
  normalizeEditorDoc,
} from "@/services/sync/engine";
import { enqueueChange } from "@/services/sync/reducer";
import type { SyncReducerState } from "@/services/sync/types";

function applyLocalSortKeys(
  snapshot: TiptapDoc,
  state: SyncReducerState,
): TiptapDoc {
  if (!Array.isArray(snapshot.content)) return snapshot;

  let changed = false;
  const content = snapshot.content.map((node) => {
    const clientId =
      typeof node.attrs?.clientId === "string"
        ? node.attrs.clientId
        : undefined;
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

export function advanceSyncSnapshot(
  state: SyncReducerState,
  previousSnapshot: TiptapDoc | null,
  content: TiptapDoc,
): { state: SyncReducerState; snapshot: TiptapDoc } {
  const normalizedSnapshot = normalizeEditorDoc(content);
  if (!previousSnapshot) {
    const report = analyzeSortKeyIntegrity(normalizedSnapshot);
    return {
      state: {
        ...state,
        hasCorruptedSortKeys: hasCorruptedSortKeys(report),
        sortKeyCorruptionReport: hasCorruptedSortKeys(report) ? report : null,
      },
      snapshot: normalizedSnapshot,
    };
  }

  const entries = deriveSyncEntries(previousSnapshot, normalizedSnapshot);
  let nextState = state;
  for (const entry of entries) {
    nextState = enqueueChange(nextState, entry);
  }

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
  };
}

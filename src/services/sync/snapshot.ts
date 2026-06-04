import type { TiptapDoc } from "@/services/tiptap-converter";
import {
  analyzeSortKeyIntegrity,
  deriveSyncEntries,
  hasCorruptedSortKeys,
  normalizeEditorDoc,
} from "@/services/sync/engine";
import { readIdentityFromAttrs } from "@/services/sync/identity";
import { enqueueChange } from "@/services/sync/reducer";
import type { SyncReducerState } from "@/services/sync/types";

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

export function advanceSyncSnapshot(
  state: SyncReducerState,
  previousSnapshot: TiptapDoc | null,
  content: TiptapDoc,
): { state: SyncReducerState; snapshot: TiptapDoc } {
  const normalizedSnapshot = normalizeEditorDoc(content);
  if (!previousSnapshot) {
    let nextState = state;
    if (shouldCreateInitialUnsyncedContent(normalizedSnapshot)) {
      const entries = deriveSyncEntries(
        { type: "doc", content: [] },
        normalizedSnapshot,
      );
      for (const entry of entries) {
        nextState = enqueueChange(nextState, entry);
      }
    }
    const report = analyzeSortKeyIntegrity(normalizedSnapshot);
    const snapshot = applyLocalSortKeys(normalizedSnapshot, nextState);
    return {
      state: {
        ...nextState,
        hasCorruptedSortKeys: hasCorruptedSortKeys(report),
        sortKeyCorruptionReport: hasCorruptedSortKeys(report) ? report : null,
      },
      snapshot,
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

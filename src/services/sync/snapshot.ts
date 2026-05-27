import type { TiptapDoc } from "@/services/tiptap-converter";
import {
  deriveSyncEntries,
  normalizeEditorDoc,
} from "@/services/sync/engine";
import { enqueueChange } from "@/services/sync/reducer";
import type { SyncReducerState } from "@/services/sync/types";

function applyLocalSortKeys(snapshot: TiptapDoc, state: SyncReducerState): TiptapDoc {
  if (!Array.isArray(snapshot.content)) return snapshot;

  let changed = false;
  const content = snapshot.content.map((node) => {
    const clientId = typeof node.attrs?.clientId === "string" ? node.attrs.clientId : undefined;
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
    return { state, snapshot: normalizedSnapshot };
  }

  const entries = deriveSyncEntries(previousSnapshot, normalizedSnapshot);
  let nextState = state;
  for (const entry of entries) {
    nextState = enqueueChange(nextState, entry);
  }

  return { state: nextState, snapshot: applyLocalSortKeys(normalizedSnapshot, nextState) };
}

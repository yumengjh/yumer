import type { TiptapDoc } from "@/services/tiptap-converter";
import {
  deriveSyncEntries,
  normalizeEditorDoc,
} from "@/services/sync/engine";
import { enqueueChange } from "@/services/sync/reducer";
import type { SyncReducerState } from "@/services/sync/types";

export function advanceSyncSnapshot(
  state: SyncReducerState,
  previousSnapshot: TiptapDoc | null,
  content: TiptapDoc,
): { state: SyncReducerState; snapshot: TiptapDoc } {
  const snapshot = normalizeEditorDoc(content);
  if (!previousSnapshot) {
    return { state, snapshot };
  }

  const entries = deriveSyncEntries(previousSnapshot, snapshot);
  let nextState = state;
  for (const entry of entries) {
    nextState = enqueueChange(nextState, entry);
  }

  return { state: nextState, snapshot };
}

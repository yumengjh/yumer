import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TiptapDoc } from "@/services/tiptap-converter";
import { postSyncBatch } from "@/services/sync/api";
import { selectSyncBatchOperations } from "@/services/sync/batching";
import { applyCreateAck } from "@/services/sync/engine";
import {
  clearPendingCommit,
  createInitialSyncState,
  markBatchInflight,
  markPendingCommit,
  resolveBatchFailure,
  resolveBatchSuccess,
} from "@/services/sync/reducer";
import { advanceSyncSnapshot } from "@/services/sync/snapshot";
import type { SyncReducerState } from "@/services/sync/types";

type SyncSource = "autosync" | "manual-save";

type UseDocumentSyncArgs = {
  docId: string | null;
  rootBlockId: string | null;
  baseVersion: number | null;
  content: TiptapDoc | null;
  onContentPatched?: (doc: TiptapDoc) => void;
};

function createBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function logSyncEvent(event: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.debug(`[sync] ${event}`, details);
}

export function useDocumentSync({
  docId,
  rootBlockId,
  baseVersion,
  content,
  onContentPatched,
}: UseDocumentSyncArgs) {
  const [syncState, setSyncState] = useState<SyncReducerState | null>(null);
  const stateRef = useRef<SyncReducerState | null>(null);
  const snapshotRef = useRef<TiptapDoc | null>(null);
  const flushRunningRef = useRef(false);

  const replaceSyncState = useCallback((next: SyncReducerState | null) => {
    stateRef.current = next;
    setSyncState(next);
    return next;
  }, []);

  const updateSyncState = useCallback(
    (updater: (current: SyncReducerState | null) => SyncReducerState | null) => {
      return replaceSyncState(updater(stateRef.current));
    },
    [replaceSyncState],
  );

  const captureContentSnapshot = useCallback(
    (nextContent: TiptapDoc | null): SyncReducerState | null => {
      const current = stateRef.current;
      if (!current || !nextContent) return current;

      const advanced = advanceSyncSnapshot(current, snapshotRef.current, nextContent);
      snapshotRef.current = advanced.snapshot;
      if (advanced.state !== current) {
        replaceSyncState(advanced.state);
      }
      return advanced.state;
    },
    [replaceSyncState],
  );

  useEffect(() => {
    if (!docId || !rootBlockId || baseVersion == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync state must reset when the document binding changes
      replaceSyncState(null);
      snapshotRef.current = null;
      return;
    }

    replaceSyncState(createInitialSyncState(docId, rootBlockId, baseVersion));
    snapshotRef.current = null;
  }, [baseVersion, docId, replaceSyncState, rootBlockId]);

  useEffect(() => {
    captureContentSnapshot(content);
  }, [captureContentSnapshot, content]);

  const flush = useCallback(
    async (source: SyncSource = "autosync") => {
      if (flushRunningRef.current) return;

      const initial = stateRef.current;
      if (!initial) return;
      if (initial.inflightBatchId) return;
      if (initial.dirtyOrder.length === 0) return;

      flushRunningRef.current = true;
      try {
        while (true) {
          const current = stateRef.current;
          if (!current) return;
          if (current.inflightBatchId) return;
          if (current.dirtyOrder.length === 0) return;

          const operations = selectSyncBatchOperations(current.dirtyOrder, current.entries);

          if (operations.length === 0) {
            return;
          }

          const clientBatchId = createBatchId();
          logSyncEvent("flush:dispatch", {
            docId: current.docId,
            clientBatchId,
            baseVersion: current.baseVersion,
            operationCount: operations.length,
            createCount: operations.filter((op) => op.opType === "create").length,
            updateCount: operations.filter((op) => op.opType === "update").length,
            deleteCount: operations.filter((op) => op.opType === "delete").length,
            moveCount: operations.filter((op) => op.opType === "move").length,
          });
          replaceSyncState(
            markBatchInflight(current, clientBatchId, operations.map((op) => op.clientId), source === "manual-save"),
          );

          try {
            const response = await postSyncBatch({
              docId: current.docId,
              rootBlockId: current.rootBlockId,
              baseVersion: current.baseVersion,
              clientBatchId,
              source,
              operations,
            });
            logSyncEvent("flush:response", {
              docId: current.docId,
              acceptedBatchId: response.acceptedBatchId,
              serverHead: response.serverHead,
              needsReload: response.needsReload,
              resultCount: response.results.length,
            });

            if (response.needsReload) {
              updateSyncState((prev) =>
                prev ? resolveBatchFailure(prev, clientBatchId, "检测到版本冲突，请刷新后重试", true) : prev,
              );
              return;
            }

            updateSyncState((prev) =>
              prev ? resolveBatchSuccess(prev, clientBatchId, response.results, response.serverHead) : prev,
            );

            const createMappings = response.results
              .filter((result) => result.success && result.clientId && result.blockId)
              .map((result) => ({
                clientId: result.clientId!,
                blockId: result.blockId!,
                sortKey: result.sortKey,
              }));

            const currentSnapshot = snapshotRef.current;
            if (currentSnapshot && createMappings.length > 0) {
              const patched = applyCreateAck(currentSnapshot, createMappings);
              snapshotRef.current = patched;
              if (onContentPatched && patched !== currentSnapshot) {
                onContentPatched(patched);
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "同步失败";
            updateSyncState((prev) =>
              prev ? resolveBatchFailure(prev, clientBatchId, message, false) : prev,
            );
            return;
          }
        }
      } finally {
        flushRunningRef.current = false;
      }
    },
    [onContentPatched, replaceSyncState, updateSyncState],
  );

  const flushAndCommitBarrier = useCallback(async (latestContent?: TiptapDoc | null): Promise<boolean> => {
    if (latestContent) {
      captureContentSnapshot(latestContent);
    }

    updateSyncState((prev) => (prev ? markPendingCommit(prev) : prev));
    try {
      await flush("manual-save");
      const current = stateRef.current;
      if (!current) return false;
      if (current.syncState === "conflicted" || current.syncState === "error") {
        return false;
      }
      return current.dirtyOrder.length === 0;
    } finally {
      updateSyncState((prev) => (prev ? clearPendingCommit(prev) : prev));
    }
  }, [captureContentSnapshot, flush, updateSyncState]);

  const uiSaveStatus = useMemo(() => {
    if (!syncState) return "idle" as const;
    if (syncState.syncState === "flushing") return "flushing" as const;
    if (syncState.syncState === "dirty") return "dirty" as const;
    if (syncState.syncState === "error" || syncState.syncState === "conflicted") return "error" as const;
    return "saved" as const;
  }, [syncState]);

  return {
    syncState,
    uiSaveStatus,
    flush,
    flushAndCommitBarrier,
  };
}

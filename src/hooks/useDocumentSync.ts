import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renewSyncSession, type SyncSessionMeta } from "@/services/document";
import type { TiptapDoc } from "@/services/tiptap-converter";
import { postSyncBatch } from "@/services/sync/api";
import { selectSyncBatchOperations } from "@/services/sync/batching";
import { summarizeSyncBatchFailures } from "@/services/sync/batch-failure";
import { applyServerAck } from "@/services/sync/engine";
import { collectOrphanedCreateDeletes } from "@/services/sync/orphaned-create";
import {
  clearPendingCommit,
  createInitialSyncState,
  enqueueChange,
  markBatchInflight,
  markPendingCommit,
  markSyncSessionLost,
  resolveBatchFailure,
  resolveBatchSuccess,
} from "@/services/sync/reducer";
import { advanceSyncSnapshot } from "@/services/sync/snapshot";
import { createSortKeysBetween } from "@/services/sync/order";
import type { SyncEntry, SyncReducerState } from "@/services/sync/types";

type SyncSource = "autosync" | "manual-save";

type UseDocumentSyncArgs = {
  docId: string | null;
  rootBlockId: string | null;
  baseVersion: number | null;
  draftRevision: number;
  syncSession?: SyncSessionMeta | null;
  content: TiptapDoc | null;
  onContentPatched?: (doc: TiptapDoc) => TiptapDoc | void;
};

function createBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function logSyncEvent(event: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.debug(`[sync] ${event}`, details);
}

function readClientId(node: TiptapDoc["content"][number]): string | null {
  const value = node.attrs?.clientId ?? node.attrs?.["data-client-id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBlockId(node: TiptapDoc["content"][number]): string | null {
  const value = node.attrs?.blockId ?? node.attrs?.["data-block-id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readSortKey(node: TiptapDoc["content"][number]): string | null {
  const value = node.attrs?.sortKey ?? node.attrs?.["data-sort-key"];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readSyncEntryKeys(node: TiptapDoc["content"][number]): string[] {
  const keys = [readBlockId(node), readClientId(node)].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set(keys)];
}

function withEntrySortKey(entry: SyncEntry, sortKey: string): SyncEntry {
  return {
    ...entry,
    sortKey,
    payload: entry.payload
      ? {
          ...entry.payload,
          attrs: {
            ...((entry.payload.attrs as Record<string, unknown> | undefined) ?? {}),
            sortKey,
            "data-sort-key": sortKey,
          },
        }
      : entry.payload,
  };
}

function rebasePendingCreatesToSnapshotOrder(
  state: SyncReducerState,
  snapshot: TiptapDoc | null,
): SyncReducerState {
  if (!snapshot?.content?.length) return state;

  const entries = { ...state.entries };
  let changed = false;
  let index = 0;

  while (index < snapshot.content.length) {
    const node = snapshot.content[index];
    const clientId = readClientId(node);
    const entry = clientId ? entries[clientId] : undefined;
    if (entry?.opType !== "create") {
      index += 1;
      continue;
    }

    const runStart = index;
    const run: Array<{ clientId: string; entry: SyncEntry }> = [];
    while (index < snapshot.content.length) {
      const runNode = snapshot.content[index];
      const runClientId = readClientId(runNode);
      const runEntry = runClientId ? entries[runClientId] : undefined;
      if (runEntry?.opType !== "create") break;
      run.push({ clientId: runClientId!, entry: runEntry });
      index += 1;
    }

    const previousExisting = [...snapshot.content.slice(0, runStart)]
      .reverse()
      .find((item) => readBlockId(item) && readSortKey(item));
    const nextExisting = snapshot.content
      .slice(index)
      .find((item) => readBlockId(item) && readSortKey(item));
    const sortKeys = createSortKeysBetween(
      previousExisting ? readSortKey(previousExisting) : null,
      nextExisting ? readSortKey(nextExisting) : null,
      run.length,
    );

    run.forEach((item, offset) => {
      const sortKey = sortKeys[offset];
      if (item.entry.sortKey !== sortKey) {
        entries[item.clientId] = withEntrySortKey(item.entry, sortKey);
        changed = true;
      }
    });
  }

  if (!changed) return state;

  const visualOrder = new Map<string, number>();
  snapshot.content.forEach((node, order) => {
    for (const key of readSyncEntryKeys(node)) {
      visualOrder.set(key, order);
    }
  });

  return {
    ...state,
    entries,
    dirtyOrder: [...state.dirtyOrder].sort(
      (left, right) =>
        (visualOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (visualOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
    ),
  };
}

export function useDocumentSync({
  docId,
  rootBlockId,
  baseVersion,
  draftRevision,
  syncSession,
  content,
  onContentPatched,
}: UseDocumentSyncArgs) {
  const [syncState, setSyncState] = useState<SyncReducerState | null>(null);
  const stateRef = useRef<SyncReducerState | null>(null);
  const snapshotRef = useRef<TiptapDoc | null>(null);
  const latestContentRef = useRef<TiptapDoc | null>(content);
  const flushRunningRef = useRef(false);
  const autosyncPausedRef = useRef(false);

  const replaceSyncState = useCallback((next: SyncReducerState | null) => {
    stateRef.current = next;
    setSyncState(next);
    return next;
  }, []);

  const updateSyncState = useCallback(
    (
      updater: (current: SyncReducerState | null) => SyncReducerState | null,
    ) => {
      return replaceSyncState(updater(stateRef.current));
    },
    [replaceSyncState],
  );

  const captureContentSnapshot = useCallback(
    (nextContent: TiptapDoc | null): SyncReducerState | null => {
      const current = stateRef.current;
      if (!current || !nextContent) return current;

      const advanced = advanceSyncSnapshot(
        current,
        snapshotRef.current,
        nextContent,
      );
      snapshotRef.current = advanced.snapshot;
      if (advanced.state.hasCorruptedSortKeys) {
        logSyncEvent("snapshot:sort-key-corruption", {
          docId: current.docId,
          report: advanced.state.sortKeyCorruptionReport,
        });
      }
      if (advanced.state !== current) {
        replaceSyncState(advanced.state);
      }
      return advanced.state;
    },
    [replaceSyncState],
  );

  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

  useEffect(() => {
    if (!docId || !rootBlockId || baseVersion == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync state must reset when the document binding changes
      replaceSyncState(null);
      snapshotRef.current = null;
      return;
    }

    replaceSyncState(
      createInitialSyncState(
        docId,
        rootBlockId,
        baseVersion,
        draftRevision,
        syncSession,
      ),
    );
    snapshotRef.current = latestContentRef.current;
  }, [baseVersion, docId, draftRevision, replaceSyncState, rootBlockId, syncSession]);

  useEffect(() => {
    captureContentSnapshot(content);
  }, [captureContentSnapshot, content]);

  useEffect(() => {
    if (!docId || !syncSession?.sessionId) return;
    const timer = window.setInterval(() => {
      void renewSyncSession(docId, syncSession)
        .then((renewed) => {
          updateSyncState((current) =>
            current
              ? {
                  ...current,
                  leaseExpiresAt: renewed.leaseExpiresAt ?? current.leaseExpiresAt,
                  lastAckedOpSeq:
                    renewed.lastAckedOpSeq ?? current.lastAckedOpSeq,
                }
              : current,
          );
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "鍚屾浼氳瘽缁澶辫触";
          updateSyncState((current) =>
            current ? markSyncSessionLost(current, message) : current,
          );
        });
    }, 2 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [docId, syncSession, updateSyncState]);

  const flush = useCallback(
    async (source: SyncSource = "autosync") => {
      if (source === "autosync" && autosyncPausedRef.current) return;
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

          const rebased = rebasePendingCreatesToSnapshotOrder(
            current,
            snapshotRef.current,
          );
          if (rebased !== current) {
            replaceSyncState(rebased);
          }

          const operations = selectSyncBatchOperations(
            rebased.dirtyOrder,
            rebased.entries,
          );

          if (operations.length === 0) {
            return;
          }

          const clientBatchId = createBatchId();
          logSyncEvent("flush:dispatch", {
            docId: rebased.docId,
            clientBatchId,
            baseVersion: rebased.baseVersion,
            operationCount: operations.length,
            createCount: operations.filter((op) => op.opType === "create")
              .length,
            updateCount: operations.filter((op) => op.opType === "update")
              .length,
            deleteCount: operations.filter((op) => op.opType === "delete")
              .length,
            moveCount: operations.filter((op) => op.opType === "move").length,
          });
          replaceSyncState(
            markBatchInflight(
              rebased,
              clientBatchId,
              operations.map((op) => op.clientId),
              source === "manual-save",
            ),
          );

          try {
            const response = await postSyncBatch({
              docId: rebased.docId,
              rootBlockId: rebased.rootBlockId,
              baseVersion: rebased.baseVersion,
              draftRevision: rebased.draftRevision,
              clientBatchId,
              source,
              sessionId: rebased.sessionId ?? undefined,
              sessionEpoch: rebased.sessionEpoch ?? undefined,
              operations,
            });
            logSyncEvent("flush:response", {
              docId: rebased.docId,
              acceptedBatchId: response.acceptedBatchId,
              serverHead: response.serverHead,
              draftRevision: response.draftRevision,
              needsReload: response.needsReload,
              resultCount: response.results.length,
            });
            const batchFailure = summarizeSyncBatchFailures(response.results);

            if (response.needsReload) {
              const lostSession = response.conflicts.some((conflict) =>
                [
                  "SYNC_SESSION_REQUIRED",
                  "SYNC_SESSION_MISMATCH",
                  "SYNC_SESSION_EXPIRED",
                ].includes(conflict.code),
              );
              updateSyncState((prev) =>
                prev
                  ? lostSession
                    ? markSyncSessionLost(
                        prev,
                        "当前编辑会话已失效，请刷新后继续编辑",
                      )
                    : resolveBatchFailure(
                        prev,
                        clientBatchId,
                        "检测到版本冲突，请刷新后重试",
                        true,
                      )
                  : prev,
              );
              return;
            }


            updateSyncState((prev) =>
              prev
                ? resolveBatchSuccess(
                    prev,
                    clientBatchId,
                    response.results,
                    response.serverHead,
                    response.draftRevision,
                    response.ackedThroughOpSeq,
                  )
                : prev,
            );

            captureContentSnapshot(latestContentRef.current);

            const createMappings = response.results
              .filter(
                (result) => result.success && result.clientId && result.blockId,
              )
              .map((result) => ({
                clientId: result.clientId!,
                blockId: result.blockId!,
                sortKey: result.sortKey,
              }));
            const serverAckMappings = response.results
              .filter(
                (result) =>
                  result.success &&
                  result.blockId &&
                  (result.clientId || result.sortKey),
              )
              .map((result) => ({
                clientId: result.clientId,
                blockId: result.blockId!,
                sortKey: result.sortKey,
              }));

            const currentSnapshot = snapshotRef.current;
            const orphanedCreateDeletes = collectOrphanedCreateDeletes(
              currentSnapshot,
              createMappings,
            );
            if (orphanedCreateDeletes.length > 0) {
              updateSyncState((prev) => {
                if (!prev) return prev;
                return orphanedCreateDeletes.reduce(
                  (next, entry) => enqueueChange(next, entry),
                  prev,
                );
              });
            }
            if (currentSnapshot && serverAckMappings.length > 0) {
              const patched = applyServerAck(currentSnapshot, serverAckMappings);
              snapshotRef.current = patched;
              if (onContentPatched && patched !== currentSnapshot) {
                try {
                  const applied = onContentPatched(patched);
                  if (applied && applied.type === "doc") {
                    captureContentSnapshot(applied);
                  }
                } catch (error) {
                  logSyncEvent("ack:content-patch-failed", {
                    docId: rebased.docId,
                    clientBatchId,
                    error: error instanceof Error ? error.message : String(error),
                  });
                }
              }
            }
            if (batchFailure) {
              updateSyncState((prev) =>
                prev
                  ? {
                      ...prev,
                      syncState: "error",
                      lastError: batchFailure,
                    }
                  : prev,
              );
              return;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "鍚屾澶辫触";
            updateSyncState((prev) =>
              prev
                ? resolveBatchFailure(prev, clientBatchId, message, false)
                : prev,
            );
            return;
          }
        }
      } finally {
        flushRunningRef.current = false;
      }
    },
    [captureContentSnapshot, onContentPatched, replaceSyncState, updateSyncState],
  );

  const flushAndCommitBarrier = useCallback(
    async (
      latestContent?: TiptapDoc | null,
      commitAction?: () => Promise<void>,
    ): Promise<boolean> => {
      if (latestContent) {
        captureContentSnapshot(latestContent);
      }

      autosyncPausedRef.current = true;
      updateSyncState((prev) => (prev ? markPendingCommit(prev) : prev));
      try {
        await flush("manual-save");
        const current = stateRef.current;
        if (!current) return false;
        if (
          current.syncState === "conflicted" ||
          current.syncState === "error"
        ) {
          return false;
        }
        if (current.dirtyOrder.length > 0) {
          return false;
        }
        if (commitAction) {
          await commitAction();
        }
        return true;
      } finally {
        autosyncPausedRef.current = false;
        updateSyncState((prev) => (prev ? clearPendingCommit(prev) : prev));
      }
    },
    [captureContentSnapshot, flush, updateSyncState],
  );

  const uiSaveStatus = useMemo(() => {
    if (!syncState) return "idle" as const;
    if (syncState.syncState === "flushing") return "flushing" as const;
    if (syncState.syncState === "dirty") return "dirty" as const;
    if (
      syncState.syncState === "error" ||
      syncState.syncState === "conflicted" ||
      syncState.syncState === "lease-lost"
    )
      return "error" as const;
    return "saved" as const;
  }, [syncState]);

  return {
    syncState,
    uiSaveStatus,
    flush,
    flushAndCommitBarrier,
  };
}
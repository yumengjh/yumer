import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acquireSyncSession,
  renewSyncSession,
  type SyncSessionMeta,
} from "@/services/document";
import type { TiptapDoc } from "@/services/tiptap-converter";
import { postDraftCheckpoint, postSyncBatchWithRetry, postSyncManifestReconcile, type SyncManifestIdentity } from "@/services/sync/api";
import { getRealtimeOriginIdentity } from "@/services/realtime/identity";
import { subscribeDocumentEvents } from "@/services/realtime/document-events";
import type { DocumentRemoteOpsEvent, RealtimeSseEvent } from "@/services/realtime/types";
import { selectSyncBatchOperations } from "@/services/sync/batching";
import { summarizeSyncBatchFailures } from "@/services/sync/batch-failure";
import { applyCheckpointAck, buildDraftCheckpoint } from "@/services/sync/checkpoint";
import {
  applyServerAck,
  applyServerDeleteAck,
  createSyncSnapshotIndex,
  type SyncSnapshotIndex,
} from "@/services/sync/engine";
import { applyRemoteOperationsToDoc } from "@/services/sync/remote-ops";
import { collectOrphanedCreateDeletes } from "@/services/sync/orphaned-create";
import {
  applyRemoteBatchSuccess,
  clearPendingCommit,
  createInitialSyncState,
  enqueueChange,
  markRemoteConflict,
  markBatchInflight,
  markPendingCommit,
  markSyncSessionLost,
  adoptServerDraftRevision,
  resolveBatchFailure,
  resolveBatchSuccess,
} from "@/services/sync/reducer";
import { computeRootManifestDigest } from "@/services/sync/manifest-digest";
import { advanceSyncSnapshotIndexed, repairSnapshotSortKeyOrder } from "@/services/sync/snapshot";
import { createSortKeysBetween } from "@/services/sync/order";
import { SyncTraceLog, buildManifestSummary, type SyncTraceEvent } from "@/services/sync/debug-log";
import type { SyncDiffHint, SyncEntry, SyncReducerState } from "@/services/sync/types";

type SyncSource = "autosync" | "manual-save";
type SyncSnapshotCaptureSource =
  | "editor-effect"
  | "batch-ack-rescan"
  | "ack-content-patch"
  | "manual-save-capture";

type UseDocumentSyncArgs = {
  docId: string | null;
  rootBlockId: string | null;
  baseVersion: number | null;
  draftRevision: number;
  syncSession?: SyncSessionMeta | null;
  content: TiptapDoc | null;
  onContentPatched?: (doc: TiptapDoc) => TiptapDoc | void;
  onRemoteContentApplied?: (doc: TiptapDoc) => void;
  onRemoteReloadRequired?: (reason: string) => void | Promise<void>;
  onSessionRecovered?: (syncSession: SyncSessionMeta) => void;
  consumeDiffHint?: (content: TiptapDoc) => SyncDiffHint | null;
};

function createBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createCheckpointClientId(): string {
  return `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createReconcileId(): string {
  return `reconcile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function logSyncEvent(event: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.debug(`[sync] ${event}`, details);
}

function logDiffEvent(details: {
  docId: string;
  source: SyncSnapshotCaptureSource;
  mode: string;
  topLevelCount: number;
  dirtyCandidateCount: number;
  fingerprintCount: number;
  sortPlanRan: boolean;
  derivedEntryCount: number;
  dirtyOrderLength: number;
  durationMs: number;
  hintReason?: string | null;
  hintStructureChanged?: boolean | null;
  hintIdentityChanged?: boolean | null;
}) {
  if (process.env.NODE_ENV === "production") return;
  const isNoopFullDiff =
    details.mode === "fallback-full" &&
    details.derivedEntryCount === 0 &&
    details.dirtyOrderLength === 0;
  const marker = isNoopFullDiff
    ? "NOOP"
    : details.mode === "content-hint"
      ? "FAST"
      : details.mode === "structure-hint"
        ? "STRUCTURE"
        : "FULL";
  const payload = {
    docId: details.docId,
    source: details.source,
    mode: details.mode,
    blocks: details.topLevelCount,
    dirtyCandidates: details.dirtyCandidateCount,
    fingerprints: details.fingerprintCount,
    sortPlan: details.sortPlanRan,
    entries: details.derivedEntryCount,
    dirtyQueue: details.dirtyOrderLength,
    durationMs: details.durationMs,
    hint: {
      reason: details.hintReason ?? null,
      structureChanged: details.hintStructureChanged ?? null,
      identityChanged: details.hintIdentityChanged ?? null,
    },
  };
  if (isNoopFullDiff) {
    console.debug(`[sync:diff:${marker}]`, payload);
  } else {
    console.log(`[sync:diff:${marker}]`, payload);
  }
}

function addSyncTrace(
  event: SyncTraceEvent,
  docId: string,
  sessionId: string | null,
  sessionEpoch: number | null,
  createPayload: () => Record<string, unknown>,
) {
  if (!SyncTraceLog.isEnabled()) return;
  SyncTraceLog.add(event, docId, sessionId, sessionEpoch, createPayload());
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

function toReconcileManifest(doc: TiptapDoc | null): SyncManifestIdentity[] {
  if (!doc?.content?.length) return [];
  return doc.content.map((node) => ({
    blockId: readBlockId(node),
    clientId: readClientId(node),
    syncCreateId:
      typeof node.attrs?.syncCreateId === "string"
        ? node.attrs.syncCreateId
        : typeof node.attrs?.["data-sync-create-id"] === "string"
          ? node.attrs["data-sync-create-id"]
          : null,
  }));
}

function buildReconcileKey(
  state: SyncReducerState,
  manifest: SyncManifestIdentity[],
): string {
  return JSON.stringify({
    docId: state.docId,
    baseVersion: state.baseVersion,
    draftRevision: state.draftRevision,
    sessionId: state.sessionId,
    sessionEpoch: state.sessionEpoch,
    manifest,
  });
}

function isSyncSessionConflict(conflicts: Array<{ code: string }>): boolean {
  return conflicts.some((conflict) =>
    ["SYNC_SESSION_REQUIRED", "SYNC_SESSION_MISMATCH", "SYNC_SESSION_EXPIRED"].includes(
      conflict.code,
    ),
  );
}

function isDraftRevisionMismatchOnly(conflicts: Array<{ code: string }>): boolean {
  return (
    conflicts.length > 0 &&
    conflicts.every((conflict) => conflict.code === "DRAFT_REVISION_MISMATCH")
  );
}

function readSyncEntryKeys(node: TiptapDoc["content"][number]): string[] {
  const keys = [readBlockId(node), readClientId(node)].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set(keys)];
}

function collectFailedClientIds(
  results: Array<{
    success: boolean;
    operation: string;
    clientId?: string;
    blockId?: string;
    error?: string;
  }>,
  operations: SyncEntry[],
): Set<string> {
  const failed = new Set<string>();
  results.forEach((result, index) => {
    if (result.success) return;
    const message = (result.error ?? "").toLowerCase();
    if (
      result.operation === "delete" &&
      (message.includes("not found") || message.includes("不存在"))
    ) {
      // delete not-found 视为成功（幂等语义），不计入失败
      return;
    }
    const clientId =
      result.clientId ??
      (result.blockId
        ? operations.find((op) => op.blockId === result.blockId)?.clientId
        : undefined) ??
      operations[index]?.clientId;
    if (clientId) failed.add(clientId);
  });
  return failed;
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
  onRemoteContentApplied,
  onRemoteReloadRequired,
  onSessionRecovered,
  consumeDiffHint,
}: UseDocumentSyncArgs) {
  const [syncState, setSyncState] = useState<SyncReducerState | null>(null);
  const stateRef = useRef<SyncReducerState | null>(null);
  const snapshotRef = useRef<TiptapDoc | null>(null);
  const snapshotIndexRef = useRef<SyncSnapshotIndex | null>(null);
  const latestContentRef = useRef<TiptapDoc | null>(content);
  const flushRunningRef = useRef(false);
  const reconcileRunningRef = useRef(false);
  const lastReconciledManifestKeyRef = useRef<string | null>(null);
  const lastServerManifestDigestRef = useRef<string | null>(null);
  const autosyncPausedRef = useRef(false);
  const batchFailureCountRef = useRef(0);
  const errorRetryAttemptRef = useRef(0);
  const remoteReloadRunningRef = useRef(false);
  const onRemoteContentAppliedRef = useRef(onRemoteContentApplied);
  const onRemoteReloadRequiredRef = useRef(onRemoteReloadRequired);
  const MAX_BATCH_FAILURES_BEFORE_CHECKPOINT = 2;

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

  const recoverExpiredSyncSession = useCallback(async (): Promise<boolean> => {
    if (!docId) return false;
    const recovered = await acquireSyncSession(docId);
    onSessionRecovered?.(recovered);
    updateSyncState((current) =>
      current
        ? {
            ...current,
            sessionId: recovered.sessionId,
            sessionEpoch: recovered.sessionEpoch,
            leaseExpiresAt: recovered.leaseExpiresAt ?? current.leaseExpiresAt,
            lastAckedOpSeq: recovered.lastAckedOpSeq ?? current.lastAckedOpSeq,
            syncState: current.dirtyOrder.length > 0 ? "dirty" : "idle",
            lastError: null,
          }
        : current,
    );
    return true;
  }, [docId, onSessionRecovered, updateSyncState]);

  useEffect(() => {
    onRemoteContentAppliedRef.current = onRemoteContentApplied;
  }, [onRemoteContentApplied]);

  useEffect(() => {
    onRemoteReloadRequiredRef.current = onRemoteReloadRequired;
  }, [onRemoteReloadRequired]);

  const requestRemoteReload = useCallback(
    async (reason: string) => {
      if (remoteReloadRunningRef.current) return;
      remoteReloadRunningRef.current = true;
      try {
        await onRemoteReloadRequiredRef.current?.(reason);
      } finally {
        remoteReloadRunningRef.current = false;
      }
    },
    [],
  );

  const handleRemoteConflict = useCallback(
    (reason: string, event?: DocumentRemoteOpsEvent) => {
      updateSyncState((current) =>
        current ? markRemoteConflict(current, reason) : current,
      );
      if (event) {
        addSyncTrace("remote:conflict", event.docId, stateRef.current?.sessionId ?? null, stateRef.current?.sessionEpoch ?? null, () => ({
          eventId: event.eventId,
          previousDraftRevision: event.previousDraftRevision,
          remoteDraftRevision: event.draftRevision,
          localDraftRevision: stateRef.current?.draftRevision ?? null,
          remoteOperationCount: event.operations.length,
          reason,
        }));
      }
      void requestRemoteReload(reason);
    },
    [requestRemoteReload, updateSyncState],
  );

  const applyRemoteEvent = useCallback(
    (event: DocumentRemoteOpsEvent) => {
      const origin = getRealtimeOriginIdentity();
      if (
        event.originClientId === origin.originClientId &&
        event.originTabId === origin.originTabId
      ) {
        return;
      }

      const current = stateRef.current;
      const latestContent = latestContentRef.current;
      if (!current || !latestContent) return;

      const clean =
        current.syncState === "idle" &&
        current.dirtyOrder.length === 0 &&
        !current.inflightBatchId;
      if (!clean) {
        handleRemoteConflict("其他设备已修改此文档，当前本地内容已过期。", event);
        return;
      }

      if (event.previousDraftRevision !== current.draftRevision) {
        handleRemoteConflict("远端同步事件与本地草稿版本不连续。", event);
        return;
      }

      try {
        const patched = applyRemoteOperationsToDoc({
          doc: latestContent,
          rootBlockId: current.rootBlockId,
          operations: event.operations,
        });
        snapshotRef.current = patched;
        snapshotIndexRef.current = createSyncSnapshotIndex(patched, {
          computePayloadFingerprints: true,
        });
        latestContentRef.current = patched;
        updateSyncState((prev) =>
          prev
            ? applyRemoteBatchSuccess(prev, {
                serverHead: event.serverHead,
                previousDraftRevision: event.previousDraftRevision,
                draftRevision: event.draftRevision,
                eventId: event.eventId,
              })
            : prev,
        );
        onRemoteContentAppliedRef.current?.(patched);
        addSyncTrace("remote:applied", event.docId, current.sessionId, current.sessionEpoch, () => ({
          eventId: event.eventId,
          previousDraftRevision: event.previousDraftRevision,
          remoteDraftRevision: event.draftRevision,
          remoteOperationCount: event.operations.length,
          nextManifest: buildManifestSummary(patched),
        }));
      } catch (error) {
        handleRemoteConflict(
          error instanceof Error ? error.message : "远端增量应用失败。",
          event,
        );
      }
    },
    [handleRemoteConflict, updateSyncState],
  );

  const handleRealtimeEvent = useCallback(
    (event: RealtimeSseEvent) => {
      if (event.type === "heartbeat") return;
      addSyncTrace("realtime:event", event.docId, stateRef.current?.sessionId ?? null, stateRef.current?.sessionEpoch ?? null, () => ({
        eventId: event.eventId,
        type: event.type,
      }));
      if (event.type === "document_reload_required") {
        handleRemoteConflict(event.reason);
        return;
      }
      applyRemoteEvent(event);
    },
    [applyRemoteEvent, handleRemoteConflict],
  );

  const captureContentSnapshot = useCallback(
    (
      nextContent: TiptapDoc | null,
      source: SyncSnapshotCaptureSource = "editor-effect",
    ): SyncReducerState | null => {
      const current = stateRef.current;
      if (!current || !nextContent) return current;

      const prevSnapshot = snapshotRef.current;
      const diffHint = consumeDiffHint?.(nextContent) ?? null;
      const advanced = advanceSyncSnapshotIndexed(
        current,
        prevSnapshot,
        snapshotIndexRef.current,
        nextContent,
        diffHint,
      );
      snapshotRef.current = advanced.snapshot;
      snapshotIndexRef.current = advanced.index;
      if (advanced.state.hasCorruptedSortKeys) {
        logSyncEvent("snapshot:sort-key-corruption", {
          docId: current.docId,
          report: advanced.state.sortKeyCorruptionReport,
        });
      }
      if (advanced.state !== current) {
        replaceSyncState(advanced.state);
      }
      logDiffEvent({
        docId: current.docId,
        source,
        mode: advanced.metrics.mode,
        topLevelCount: advanced.metrics.topLevelCount,
        dirtyCandidateCount: advanced.metrics.dirtyCandidateCount,
        fingerprintCount: advanced.metrics.fingerprintCount,
        sortPlanRan: advanced.metrics.sortPlanRan,
        derivedEntryCount: advanced.metrics.derivedEntryCount,
        dirtyOrderLength: advanced.state.dirtyOrder.length,
        durationMs: advanced.metrics.durationMs,
        hintReason: diffHint?.reason ?? null,
        hintStructureChanged: diffHint?.structureChanged ?? null,
        hintIdentityChanged: diffHint?.identityChanged ?? null,
      });

      // Trace: snapshot advance
      addSyncTrace("snapshot:advance", current.docId, current.sessionId, current.sessionEpoch, () => ({
        prevNodeCount: prevSnapshot?.content?.length ?? 0,
        nextNodeCount: nextContent.content?.length ?? 0,
        nextManifest: buildManifestSummary(nextContent),
        derivedEntryCount: Object.keys(advanced.state.entries).length,
        dirtyOrderLength: advanced.state.dirtyOrder.length,
        diff: advanced.metrics,
      }));

      return advanced.state;
    },
    [consumeDiffHint, replaceSyncState],
  );

  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

  useEffect(() => {
    if (!docId || !rootBlockId || baseVersion == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync state must reset when the document binding changes
      replaceSyncState(null);
      snapshotRef.current = null;
      snapshotIndexRef.current = null;
      lastReconciledManifestKeyRef.current = null;
      lastServerManifestDigestRef.current = null;
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
    snapshotIndexRef.current = latestContentRef.current
      ? createSyncSnapshotIndex(latestContentRef.current, {
          computePayloadFingerprints: true,
        })
      : null;
    lastReconciledManifestKeyRef.current = null;
    lastServerManifestDigestRef.current = null;
  }, [baseVersion, docId, draftRevision, replaceSyncState, rootBlockId, syncSession]);

  useEffect(() => {
    if (!docId || !rootBlockId || baseVersion == null) return;
    const subscription = subscribeDocumentEvents({
      docId,
      onOpen: () => {
        addSyncTrace("realtime:connected", docId, stateRef.current?.sessionId ?? null, stateRef.current?.sessionEpoch ?? null, () => ({
          eventId: null,
        }));
      },
      onEvent: handleRealtimeEvent,
      onError: (error) => {
        addSyncTrace("realtime:error", docId, stateRef.current?.sessionId ?? null, stateRef.current?.sessionEpoch ?? null, () => ({
          message: error instanceof Error ? error.message : String(error),
        }));
      },
    });
    return () => subscription.close();
  }, [baseVersion, docId, handleRealtimeEvent, rootBlockId]);

  useEffect(() => {
    captureContentSnapshot(content, "editor-effect");
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
            error instanceof Error ? error.message : "同步会话续租失败";
          if (
            message.includes("SYNC_SESSION_EXPIRED") ||
            message.includes("SYNC_SESSION_REQUIRED")
          ) {
            void recoverExpiredSyncSession().catch(() => {
              updateSyncState((current) =>
                current ? markSyncSessionLost(current, message) : current,
              );
            });
            return;
          }
          updateSyncState((current) =>
            current ? markSyncSessionLost(current, message) : current,
          );
        });
    }, 2 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [docId, recoverExpiredSyncSession, syncSession, updateSyncState]);

  const reconcileIdleManifest = useCallback(
    async (current: SyncReducerState) => {
      if (!current.sessionId || typeof current.sessionEpoch !== "number") return;
      if (current.dirtyOrder.length > 0 || current.inflightBatchId) return;
      if (reconcileRunningRef.current) return;

      let snapshot = snapshotRef.current;
      const stateForRepair = stateRef.current ?? current;
      if (snapshot && stateForRepair) {
        const repaired = repairSnapshotSortKeyOrder(stateForRepair, snapshot);
        if (repaired.repairedCount > 0) {
          replaceSyncState(repaired.state);
          snapshot = repaired.snapshot;
          snapshotRef.current = repaired.snapshot;
          snapshotIndexRef.current = createSyncSnapshotIndex(repaired.snapshot, {
            computePayloadFingerprints: true,
          });
          addSyncTrace("idle:sort-key-repair", current.docId, current.sessionId, current.sessionEpoch, () => ({
            repairedCount: repaired.repairedCount,
            manifest: buildManifestSummary(repaired.snapshot),
          }));
        }
      }

      const manifest = toReconcileManifest(snapshot);
      const manifestKey = buildReconcileKey(current, manifest);
      if (lastReconciledManifestKeyRef.current === manifestKey) return;

      const localDigest = await computeRootManifestDigest(snapshot);
      const serverDigest = lastServerManifestDigestRef.current;
      if (serverDigest && localDigest === serverDigest) {
        lastReconciledManifestKeyRef.current = manifestKey;
        addSyncTrace("idle:manifest", current.docId, current.sessionId, current.sessionEpoch, () => ({
          manifest: buildManifestSummary(snapshot),
          digestMatch: true,
          localDigest,
          serverDigest,
        }));
        return;
      }

      const clientBatchId = createReconcileId();
      lastReconciledManifestKeyRef.current = manifestKey;
      reconcileRunningRef.current = true;
      addSyncTrace("manifest:reconcile", current.docId, current.sessionId, current.sessionEpoch, () => ({
        clientBatchId,
        draftRevision: current.draftRevision,
        manifest: buildManifestSummary(snapshotRef.current),
      }));

      try {
        const response = await postSyncManifestReconcile({
          docId: current.docId,
          draftRevision: current.draftRevision,
          clientBatchId,
          sessionId: current.sessionId,
          sessionEpoch: current.sessionEpoch,
          manifest,
        });
        addSyncTrace("manifest:reconcile-response", current.docId, current.sessionId, current.sessionEpoch, () => ({
          clientBatchId,
          draftRevision: response.draftRevision,
          needsReload: response.needsReload,
          conflicts: response.conflicts,
          tombstoned: response.tombstoned,
        }));

        if (response.needsReload) {
          const lostSession = isSyncSessionConflict(response.conflicts);
          updateSyncState((prev) =>
            prev
              ? lostSession
                ? markSyncSessionLost(prev, "当前编辑会话已失效，请刷新后继续编辑")
                : {
                    ...prev,
                    syncState: "conflicted",
                    lastError: "检测到版本冲突，请刷新后重试",
                    draftRevision: response.draftRevision,
                  }
              : prev,
          );
          return;
        }

        updateSyncState((prev) =>
          prev && typeof response.draftRevision === "number"
            ? {
                ...prev,
                draftRevision: response.draftRevision,
                lastError: null,
              }
            : prev,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "最终态同步校验失败";
        updateSyncState((prev) =>
          prev
            ? message.includes("SYNC_SESSION")
              ? markSyncSessionLost(prev, "当前编辑会话已失效，请刷新后继续编辑")
              : {
                  ...prev,
                  syncState: "error",
                  lastError: message,
                }
            : prev,
        );
      } finally {
        reconcileRunningRef.current = false;
      }
    },
    [replaceSyncState, updateSyncState],
  );

  const runDraftCheckpoint = useCallback(
    async (latestContent?: TiptapDoc | null): Promise<boolean> => {
      const current = stateRef.current;
      const contentForCheckpoint = latestContent ?? latestContentRef.current;
      if (!current || !contentForCheckpoint) return false;
      if (!current.sessionId || typeof current.sessionEpoch !== "number") {
        updateSyncState((prev) =>
          prev
            ? markSyncSessionLost(prev, "当前编辑会话缺失，无法执行最终态同步")
            : prev,
        );
        return false;
      }

      try {
        const checkpoint = await buildDraftCheckpoint({
          docId: current.docId,
          rootBlockId: current.rootBlockId,
          content: contentForCheckpoint,
          baseVersion: current.baseVersion,
          draftRevision: current.draftRevision,
          sessionId: current.sessionId,
          sessionEpoch: current.sessionEpoch,
          clientId: current.sessionId,
          clientCheckpointId: createCheckpointClientId(),
        });

        const response = await postDraftCheckpoint(current.docId, checkpoint);
        if (response.needsReload) {
          updateSyncState((prev) =>
            prev
              ? {
                  ...prev,
                  syncState: "conflicted",
                  lastError:
                    response.conflicts[0]?.message ??
                    "最终态同步需要刷新后重试",
                  draftRevision: response.draftRevision,
                }
              : prev,
          );
          return false;
        }

        updateSyncState((prev) =>
          prev
            ? {
                ...prev,
                baseVersion: response.serverHead,
                draftRevision: response.draftRevision,
                entries: {},
                dirtyOrder: [],
                inflightBatchId: null,
                inflightEntryIds: [],
                inflightEntryRevisions: {},
                syncState: "idle",
                lastError: null,
              }
            : prev,
        );

        const patched = applyCheckpointAck(
          contentForCheckpoint,
          response.mappings,
        );
        snapshotRef.current = patched;
        snapshotIndexRef.current = createSyncSnapshotIndex(patched, {
          computePayloadFingerprints: true,
        });
        if (onContentPatched && patched !== contentForCheckpoint) {
          const applied = onContentPatched(patched);
          if (applied && applied.type === "doc") {
            snapshotRef.current = applied;
            snapshotIndexRef.current = createSyncSnapshotIndex(applied, {
              computePayloadFingerprints: true,
            });
            latestContentRef.current = applied;
          }
        }
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "最终态同步失败";
        updateSyncState((prev) =>
          prev
            ? {
                ...prev,
                syncState: "error",
                lastError: message,
              }
            : prev,
        );
        return false;
      }
    },
    [onContentPatched, updateSyncState],
  );

  const flush = useCallback(
    async (source: SyncSource = "autosync") => {
      if (source === "autosync" && autosyncPausedRef.current) return;
      if (flushRunningRef.current) return;

      const initial = stateRef.current;
      if (!initial) return;
      if (initial.inflightBatchId) return;
      if (initial.dirtyOrder.length === 0) {
        addSyncTrace("idle:manifest", initial.docId, initial.sessionId, initial.sessionEpoch, () => ({
          manifest: buildManifestSummary(snapshotRef.current),
          dirtyOrderLength: 0,
          entryCount: Object.keys(initial.entries).length,
        }));
        await reconcileIdleManifest(initial);
        return;
      }

      flushRunningRef.current = true;
      // 本次 flush 中确认失败的 entry：跳过重选，避免同一失败 op 死循环，
      // 但不阻断其余批次继续发送（下次 flush 会重试失败 entry）
      const failedEntryIds = new Set<string>();
      try {
        while (true) {
          const current = stateRef.current;
          if (!current) return;
          if (current.inflightBatchId) return;
          if (current.dirtyOrder.length === 0) {
            addSyncTrace("idle:manifest", current.docId, current.sessionId, current.sessionEpoch, () => ({
              manifest: buildManifestSummary(snapshotRef.current),
              dirtyOrderLength: 0,
              entryCount: Object.keys(current.entries).length,
            }));
            await reconcileIdleManifest(current);
            return;
          }

          const rebased = rebasePendingCreatesToSnapshotOrder(
            current,
            snapshotRef.current,
          );
          if (rebased !== current) {
            replaceSyncState(rebased);
          }

          addSyncTrace("queue:before-select", rebased.docId, rebased.sessionId, rebased.sessionEpoch, () => ({
            dirtyOrderLength: rebased.dirtyOrder.length,
            entryCount: Object.keys(rebased.entries).length,
            dirtyOrder: rebased.dirtyOrder.slice(0, 50),
            entrySummary: Object.values(rebased.entries).slice(0, 50).map((e) => ({
              clientId: e.clientId,
              blockId: e.blockId,
              syncCreateId: e.syncCreateId ?? null,
              opType: e.opType,
              revision: e.revision,
              sortKey: e.sortKey ?? null,
            })),
          }));

          const selectableDirtyOrder =
            failedEntryIds.size > 0
              ? rebased.dirtyOrder.filter((id) => !failedEntryIds.has(id))
              : rebased.dirtyOrder;
          const operations = selectSyncBatchOperations(
            selectableDirtyOrder,
            rebased.entries,
          );

          if (operations.length === 0) {
            if (failedEntryIds.size > 0) {
              // 剩余的都是本次失败的 entry：保留 error 态等待退避重试
              updateSyncState((prev) =>
                prev && prev.syncState !== "error"
                  ? {
                      ...prev,
                      syncState: "error",
                      lastError: prev.lastError ?? "部分块同步失败，稍后自动重试",
                    }
                  : prev,
              );
            }
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

          addSyncTrace("flush:dispatch", rebased.docId, rebased.sessionId, rebased.sessionEpoch, () => ({
            clientBatchId,
            baseVersion: rebased.baseVersion,
            draftRevision: rebased.draftRevision,
            operationCount: operations.length,
            operations: operations.map((op) => ({
              clientId: op.clientId,
              blockId: op.blockId,
              syncCreateId: op.syncCreateId ?? null,
              opType: op.opType,
              revision: op.revision,
              sortKey: op.sortKey ?? null,
            })),
          }));
          replaceSyncState(
            markBatchInflight(
              rebased,
              clientBatchId,
              operations.map((op) => op.clientId),
              source === "manual-save",
            ),
          );

          try {
            const response = await postSyncBatchWithRetry(
              {
                docId: rebased.docId,
                rootBlockId: rebased.rootBlockId,
                baseVersion: rebased.baseVersion,
                draftRevision: rebased.draftRevision,
                clientBatchId,
                source,
                sessionId: rebased.sessionId ?? undefined,
                sessionEpoch: rebased.sessionEpoch ?? undefined,
                operations,
              },
              {
                onRetry: (attempt, error) => {
                  logSyncEvent("flush:retry", {
                    docId: rebased.docId,
                    clientBatchId,
                    attempt,
                    error: error instanceof Error ? error.message : String(error),
                  });
                  addSyncTrace("flush:retry", rebased.docId, rebased.sessionId, rebased.sessionEpoch, () => ({
                    clientBatchId,
                    attempt,
                    error: error instanceof Error ? error.message : String(error),
                  }));
                },
              },
            );
            logSyncEvent("flush:response", {
              docId: rebased.docId,
              clientBatchId,
              serverHead: response.serverHead,
              draftRevision: response.draftRevision,
              needsReload: response.needsReload,
              resultCount: response.results.length,
            });

            addSyncTrace("flush:response", rebased.docId, rebased.sessionId, rebased.sessionEpoch, () => ({
              clientBatchId,
              serverHead: response.serverHead,
              draftRevision: response.draftRevision,
              ackedThroughOpSeq: response.ackedThroughOpSeq,
              needsReload: response.needsReload,
              resultCount: response.results.length,
              results: response.results.map((r) => ({
                operation: r.operation,
                success: r.success,
                clientId: r.clientId ?? null,
                blockId: r.blockId ?? null,
                sortKey: r.sortKey ?? null,
                error: r.error ?? null,
                matchBy: r.matchBy ?? null,
                diagnosticCode: r.diagnosticCode ?? null,
                tombstoned: r.tombstoned ?? false,
              })),
            }));
            if (response.manifestDigest) {
              lastServerManifestDigestRef.current = response.manifestDigest;
            }

            const batchFailure = summarizeSyncBatchFailures(response.results);
            if (!response.needsReload && !batchFailure) {
              batchFailureCountRef.current = 0;
            }

            if (response.needsReload) {
              const lostSession = isSyncSessionConflict(response.conflicts);
              if (lostSession) {
                updateSyncState((prev) =>
                  prev
                    ? markSyncSessionLost(
                        prev,
                        "当前编辑会话已失效，请刷新后继续编辑",
                      )
                    : prev,
                );
                return;
              }
              if (
                isDraftRevisionMismatchOnly(response.conflicts) &&
                typeof response.draftRevision === "number"
              ) {
                updateSyncState((prev) =>
                  prev
                    ? adoptServerDraftRevision(
                        prev,
                        clientBatchId,
                        response.draftRevision,
                      )
                    : prev,
                );
                addSyncTrace("flush:draft-revision-resync", rebased.docId, rebased.sessionId, rebased.sessionEpoch, () => ({
                  clientBatchId,
                  adoptedDraftRevision: response.draftRevision,
                  conflicts: response.conflicts,
                }));
                continue;
              }
              updateSyncState((prev) =>
                prev
                  ? resolveBatchFailure(
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

            const createMappings = response.results
              .filter(
                (result) =>
                  result.operation === "create" &&
                  result.success &&
                  result.clientId &&
                  result.blockId,
              )
              .map((result) => ({
                clientId: result.clientId!,
                blockId: result.blockId!,
                sortKey: result.sortKey,
              }));
            const serverAckMappings = response.results
              .filter(
                (result) =>
                  result.operation !== "delete" &&
                  result.success &&
                  result.blockId &&
                  (result.clientId || result.sortKey),
              )
              .map((result) => ({
                clientId: result.clientId,
                blockId: result.blockId!,
                sortKey: result.sortKey,
              }));
            const deleteAckMappings = response.results
              .filter(
                (result) =>
                  result.operation === "delete" &&
                  result.success &&
                  (result.blockId || result.clientId),
              )
              .map((result) => ({
                blockId: result.blockId,
                clientId: result.clientId,
              }));

            const applyBatchAckToDoc = (doc: TiptapDoc | null): TiptapDoc | null => {
              if (!doc) return doc;
              let nextDoc = doc;
              if (serverAckMappings.length > 0) {
                nextDoc = applyServerAck(nextDoc, serverAckMappings);
              }
              if (deleteAckMappings.length > 0) {
                nextDoc = applyServerDeleteAck(nextDoc, deleteAckMappings);
              }
              return nextDoc;
            };

            if (snapshotRef.current) {
              const patchedSnapshot = applyBatchAckToDoc(snapshotRef.current);
              if (patchedSnapshot && patchedSnapshot !== snapshotRef.current) {
                snapshotRef.current = patchedSnapshot;
                snapshotIndexRef.current = createSyncSnapshotIndex(patchedSnapshot, {
                  computePayloadFingerprints: true,
                });
              }
            }

            captureContentSnapshot(
              applyBatchAckToDoc(latestContentRef.current),
              "batch-ack-rescan",
            );

            const currentSnapshot = snapshotRef.current;
            const orphanedCreateDeletes = collectOrphanedCreateDeletes(
              currentSnapshot,
              createMappings,
            );
            if (orphanedCreateDeletes.length > 0) {
              addSyncTrace(
                "orphaned-create:delete-enqueued",
                rebased.docId,
                rebased.sessionId,
                rebased.sessionEpoch,
                () => ({
                  deletes: orphanedCreateDeletes.map((entry) => ({
                    clientId: entry.clientId,
                    blockId: entry.blockId,
                    syncCreateId: entry.syncCreateId ?? null,
                  })),
                }),
              );
              updateSyncState((prev) => {
                if (!prev) return prev;
                return orphanedCreateDeletes.reduce(
                  (next, entry) => enqueueChange(next, entry),
                  prev,
                );
              });
            }
            if (
              currentSnapshot &&
              (serverAckMappings.length > 0 || deleteAckMappings.length > 0)
            ) {
              let patched = currentSnapshot;
              if (serverAckMappings.length > 0) {
                patched = applyServerAck(patched, serverAckMappings);
              }
              if (deleteAckMappings.length > 0) {
                patched = applyServerDeleteAck(patched, deleteAckMappings);
              }
              addSyncTrace("ack:patch", rebased.docId, rebased.sessionId, rebased.sessionEpoch, () => ({
                clientBatchId,
                mappings: serverAckMappings,
                beforeManifest: buildManifestSummary(currentSnapshot),
                afterManifest: buildManifestSummary(patched),
              }));

              // ACK 写回的 server sortKey 可能与当前视觉顺序不一致
              // （flush 期间用户移动过块）：立即检测并入队校正 move
              const ackState = stateRef.current;
              if (ackState) {
                const repaired = repairSnapshotSortKeyOrder(ackState, patched);
                if (repaired.repairedCount > 0) {
                  replaceSyncState(repaired.state);
                  patched = repaired.snapshot;
                  addSyncTrace("ack:order-repair", rebased.docId, rebased.sessionId, rebased.sessionEpoch, () => ({
                    clientBatchId,
                    repairedCount: repaired.repairedCount,
                    afterManifest: buildManifestSummary(repaired.snapshot),
                  }));
                }
              }

              snapshotRef.current = patched;
              snapshotIndexRef.current = createSyncSnapshotIndex(patched, {
                computePayloadFingerprints: true,
              });
              if (onContentPatched && patched !== currentSnapshot) {
                try {
                  const applied = onContentPatched(patched);
                  if (applied && applied.type === "doc") {
                    captureContentSnapshot(applied, "ack-content-patch");
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
              const failedIds = collectFailedClientIds(
                response.results,
                operations,
              );
              for (const id of failedIds) failedEntryIds.add(id);
              updateSyncState((prev) =>
                prev
                  ? {
                      ...prev,
                      syncState: "error",
                      lastError: batchFailure,
                    }
                  : prev,
              );
              batchFailureCountRef.current += 1;
              if (batchFailureCountRef.current >= MAX_BATCH_FAILURES_BEFORE_CHECKPOINT) {
                const recovered = await runDraftCheckpoint(latestContentRef.current);
                if (recovered) {
                  batchFailureCountRef.current = 0;
                  failedEntryIds.clear();
                }
                return;
              }
              if (failedIds.size === 0) {
                // 无法定位失败 entry，中止本次 flush 防止同一批次死循环
                return;
              }
              // 部分失败不中断：跳过失败 entry，继续发送剩余批次
              continue;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "同步失败";
            updateSyncState((prev) =>
              prev
                ? resolveBatchFailure(prev, clientBatchId, message, false)
                : prev,
            );
            batchFailureCountRef.current += 1;
            if (batchFailureCountRef.current >= MAX_BATCH_FAILURES_BEFORE_CHECKPOINT) {
              const recovered = await runDraftCheckpoint(latestContentRef.current);
              if (recovered) {
                batchFailureCountRef.current = 0;
              }
            }
            return;
          }
        }
      } finally {
        flushRunningRef.current = false;
      }
    },
    [captureContentSnapshot, onContentPatched, reconcileIdleManifest, replaceSyncState, runDraftCheckpoint, updateSyncState],
  );

  // error 态自动重试：指数退避（2s 起，封顶 30s），网络恢复后队列自动排空，
  // 不再依赖用户继续编辑触发 dirty 才恢复同步
  useEffect(() => {
    if (!syncState) return;
    if (syncState.syncState !== "error") {
      errorRetryAttemptRef.current = 0;
      return;
    }
    if (syncState.dirtyOrder.length === 0) return;
    const attempt = Math.min(errorRetryAttemptRef.current, 4);
    const delayMs = Math.min(30_000, 2_000 * 2 ** attempt);
    const timer = window.setTimeout(() => {
      errorRetryAttemptRef.current += 1;
      void flush("autosync");
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [flush, syncState]);

  const flushAndCommitBarrier = useCallback(
    async (
      latestContent?: TiptapDoc | null,
      commitAction?: () => Promise<void>,
    ): Promise<boolean> => {
      if (latestContent) {
        captureContentSnapshot(latestContent, "manual-save-capture");
      }

      autosyncPausedRef.current = true;
      updateSyncState((prev) => (prev ? markPendingCommit(prev) : prev));
      try {
        await flush("manual-save");
        const checkpointOk = await runDraftCheckpoint(
          latestContent ?? latestContentRef.current,
        );
        if (!checkpointOk) return false;
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
    [captureContentSnapshot, flush, runDraftCheckpoint, updateSyncState],
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

  const hasPendingSync = useMemo(() => {
    if (!syncState) return false;
    return (
      syncState.dirtyOrder.length > 0 ||
      Boolean(syncState.inflightBatchId) ||
      syncState.syncState === "flushing" ||
      syncState.syncState === "dirty" ||
      syncState.syncState === "error" ||
      syncState.syncState === "conflicted" ||
      syncState.syncState === "lease-lost"
    );
  }, [syncState]);

  return {
    syncState,
    uiSaveStatus,
    hasPendingSync,
    flush,
    flushAndCommitBarrier,
  };
}

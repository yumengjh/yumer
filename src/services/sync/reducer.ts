import type { SyncSessionMeta } from "@/services/document";
import type { SyncEntry, SyncReducerState, SyncBatchResult } from "./types";

function normalizeCreatePayload(entry: SyncEntry): SyncEntry {
  if (entry.opType !== "create" || !entry.payload) return entry;

  const syncCreateId = entry.syncCreateId ?? `sync-create:${entry.clientId}`;
  const nextAttrs: Record<string, unknown> = {
    ...((entry.payload.attrs as Record<string, unknown> | undefined) ?? {}),
    blockId: null,
    clientId: entry.clientId,
    ...(entry.sortKey ? { sortKey: entry.sortKey } : {}),
  };
  delete nextAttrs.syncCreateId;
  delete nextAttrs.clientBatchId;
  delete nextAttrs["data-sync-create-id"];
  return {
    ...entry,
    syncCreateId,
    payload: {
      ...entry.payload,
      attrs: nextAttrs,
    },
  };
}

function isDeleteNotFound(
  entry: SyncEntry | undefined,
  result: SyncBatchResult,
): boolean {
  if (!entry || entry.opType !== "delete") return false;
  if (result.success) return false;
  const message = (result.error ?? "").toString().toLowerCase();
  return message.includes("not found") || message.includes("不存在");
}

export function createInitialSyncState(
  docId: string,
  rootBlockId: string,
  baseVersion: number,
  draftRevision = 0,
  syncSession?: SyncSessionMeta | null,
): SyncReducerState {
  return {
    docId,
    rootBlockId,
    baseVersion,
    draftRevision,
    sessionId: syncSession?.sessionId ?? null,
    sessionEpoch: syncSession?.sessionEpoch ?? null,
    leaseExpiresAt: syncSession?.leaseExpiresAt ?? null,
    lastAckedOpSeq: syncSession?.lastAckedOpSeq ?? null,
    localRevision: syncSession?.lastAckedOpSeq ?? 0,
    syncState: "idle",
    entries: {},
    dirtyOrder: [],
    inflightBatchId: null,
    inflightEntryIds: [],
    inflightEntryRevisions: {},
    pendingCommit: false,
    lastError: null,
    hasCorruptedSortKeys: false,
    sortKeyCorruptionReport: null,
    lastRemoteEventId: null,
  };
}

export function enqueueChange(
  state: SyncReducerState,
  incoming: SyncEntry,
): SyncReducerState {
  const current = state.entries[incoming.clientId];

  if (!current && incoming.opType === "delete" && !incoming.blockId) {
    return state;
  }

  if (
    current?.opType === "delete" &&
    (incoming.opType === "update" || incoming.opType === "move")
  ) {
    return upsertEntry(state, {
      ...current,
      blockId: incoming.blockId ?? current.blockId,
      opType: "delete",
    });
  }

  if (current?.opType === "create" && incoming.opType === "update") {
    const merged: SyncEntry = normalizeCreatePayload({
      ...current,
      payload: incoming.payload ?? current.payload,
      sortKey: incoming.sortKey ?? current.sortKey,
    });
    return upsertEntry(state, merged);
  }

  if (current?.opType === "create" && incoming.opType === "delete") {
    if (state.inflightEntryIds.includes(incoming.clientId)) {
      return upsertEntry(state, {
        clientId: incoming.clientId,
        blockId: incoming.blockId ?? current.blockId,
        opType: "delete",
        syncCreateId: current.syncCreateId,
      });
    }

    const rest = { ...state.entries };
    delete rest[incoming.clientId];
    return {
      ...state,
      localRevision: state.localRevision + 1,
      syncState: Object.keys(rest).length === 0 ? "idle" : "dirty",
      entries: rest,
      dirtyOrder: state.dirtyOrder.filter((id) => id !== incoming.clientId),
    };
  }

  if (current?.opType === "update" && incoming.opType === "delete") {
    return upsertEntry(state, {
      clientId: incoming.clientId,
      blockId: incoming.blockId ?? current.blockId,
      opType: "delete",
    });
  }

  if (current && incoming.opType === "move") {
    return upsertEntry(
      state,
      normalizeCreatePayload({
        ...current,
        opType: current.opType === "create" ? "create" : current.opType,
        parentId: incoming.parentId ?? current.parentId,
        sortKey: incoming.sortKey ?? current.sortKey,
      }),
    );
  }

  if (current) {
    return upsertEntry(
      state,
      normalizeCreatePayload({
        ...current,
        ...incoming,
        payload: incoming.payload ?? current.payload,
        sortKey: incoming.sortKey ?? current.sortKey,
      }),
    );
  }

  return upsertEntry(state, normalizeCreatePayload(incoming));
}

function upsertEntry(
  state: SyncReducerState,
  entry: SyncEntry,
): SyncReducerState {
  const nextRevision = state.localRevision + 1;
  return {
    ...state,
    localRevision: nextRevision,
    syncState: "dirty",
    lastError: null,
    entries: {
      ...state.entries,
      [entry.clientId]: {
        ...entry,
        revision: nextRevision,
      },
    },
    dirtyOrder: state.dirtyOrder.includes(entry.clientId)
      ? state.dirtyOrder
      : [...state.dirtyOrder, entry.clientId],
  };
}

export function markBatchInflight(
  state: SyncReducerState,
  batchId: string,
  inflightEntryIds: string[],
  pendingCommit = false,
): SyncReducerState {
  const inflightEntryRevisions: Record<string, number> = {};
  for (const id of inflightEntryIds) {
    const entry = state.entries[id];
    if (entry?.revision != null) {
      inflightEntryRevisions[id] = entry.revision;
    }
  }

  return {
    ...state,
    inflightBatchId: batchId,
    inflightEntryIds,
    inflightEntryRevisions,
    syncState: "flushing",
    pendingCommit: state.pendingCommit || pendingCommit,
    lastError: null,
  };
}

function getAckedClientId(
  result: SyncBatchResult,
  byIndex: SyncEntry | undefined,
  inflightEntries: SyncEntry[],
): string | null {
  if (result.clientId) return result.clientId;

  if (
    byIndex &&
    (!result.blockId ||
      byIndex.blockId === result.blockId ||
      (byIndex.opType === "delete" &&
        result.operation === "delete" &&
        (result.tombstoned || result.matchBy === "not_found")))
  ) {
    return byIndex.clientId;
  }

  if (result.blockId) {
    const matched = inflightEntries.find(
      (entry) => entry.blockId === result.blockId,
    );
    if (matched) return matched.clientId;
  }

  return null;
}

function withServerBlockId(
  entry: SyncEntry,
  blockId: string,
  sortKey?: string,
): SyncEntry {
  const nextAttrs: Record<string, unknown> = {
    ...((entry.payload?.attrs as Record<string, unknown> | undefined) ?? {}),
    blockId,
    "data-block-id": blockId,
    ...(sortKey ? { sortKey, "data-sort-key": sortKey } : {}),
  };
  delete nextAttrs.syncCreateId;
  delete nextAttrs.clientBatchId;
  delete nextAttrs["data-sync-create-id"];

  const payload = entry.payload
    ? {
        ...entry.payload,
        attrs: nextAttrs,
      }
    : entry.payload;

  if (entry.opType === "delete") {
    return {
      ...entry,
      blockId,
    };
  }

  return {
    ...entry,
    blockId,
    ...(sortKey ? { sortKey } : {}),
    opType: "update",
    payload,
  };
}

function withServerSortKey(entry: SyncEntry, sortKey: string): SyncEntry {
  const payload = entry.payload
    ? {
        ...entry.payload,
        attrs: {
          ...((entry.payload.attrs as Record<string, unknown> | undefined) ??
            {}),
          sortKey,
          "data-sort-key": sortKey,
        },
      }
    : entry.payload;

  return {
    ...entry,
    sortKey,
    payload,
  };
}

export function resolveBatchSuccess(
  state: SyncReducerState,
  batchId: string,
  results: SyncBatchResult[],
  serverHead?: number,
  serverDraftRevision?: number,
  ackedThroughOpSeq?: number,
): SyncReducerState {
  if (state.inflightBatchId !== batchId) return state;

  const nextEntries = { ...state.entries };
  const inflightEntries = state.inflightEntryIds
    .map((id) => state.entries[id])
    .filter(Boolean);

  if (results.length === 0) {
    if (inflightEntries.length > 0) {
      return {
        ...state,
        inflightBatchId: null,
        inflightEntryIds: [],
        inflightEntryRevisions: {},
        syncState: "error",
        lastError: "同步响应返回空结果，已停止自动清理待同步队列",
      };
    }
  }

  const failedClientIds = new Set<string>();
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const byIndex = inflightEntries[index];
    if (result.success || isDeleteNotFound(byIndex, result)) continue;

    const clientId = getAckedClientId(result, byIndex, inflightEntries);
    if (clientId) {
      failedClientIds.add(clientId);
    }
  }

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const byIndex = inflightEntries[index];
    const shouldTreatAsSuccess =
      result.success || isDeleteNotFound(byIndex, result);
    if (!shouldTreatAsSuccess) continue;

    const clientId = getAckedClientId(result, byIndex, inflightEntries);
    if (!clientId) continue;

    const currentEntry = nextEntries[clientId];
    if (!currentEntry) continue;
    if (failedClientIds.has(clientId)) continue;

    const inflightRevision = state.inflightEntryRevisions[clientId];
    if (currentEntry.revision === inflightRevision) {
      delete nextEntries[clientId];
      continue;
    }
    if (currentEntry.opType === "delete" && result.operation === "delete") {
      delete nextEntries[clientId];
      continue;
    }

    if (result.operation === "create" && result.blockId) {
      nextEntries[clientId] = withServerBlockId(
        currentEntry,
        result.blockId,
        result.sortKey,
      );
      continue;
    }

    if (result.sortKey) {
      nextEntries[clientId] = withServerSortKey(currentEntry, result.sortKey);
    }
  }

  const nextDirty = state.dirtyOrder.filter((id) => Boolean(nextEntries[id]));
  const hasAckFailures = results.some((result, index) => {
    return !(result.success || isDeleteNotFound(inflightEntries[index], result));
  });
  const maxAckedInflightRevision =
    !hasAckFailures && typeof ackedThroughOpSeq === "number"
      ? Math.max(state.lastAckedOpSeq ?? 0, ackedThroughOpSeq)
      : state.lastAckedOpSeq ?? null;
  return {
    ...state,
    entries: nextEntries,
    dirtyOrder: nextDirty,
    inflightBatchId: null,
    inflightEntryIds: [],
    inflightEntryRevisions: {},
    baseVersion:
      typeof serverHead === "number" ? serverHead : state.baseVersion,
    draftRevision:
      typeof serverDraftRevision === "number"
        ? serverDraftRevision
        : state.draftRevision,
    lastAckedOpSeq: maxAckedInflightRevision,
    syncState: nextDirty.length > 0 ? "dirty" : "idle",
    lastError: null,
  };
}

export function resolveBatchFailure(
  state: SyncReducerState,
  batchId: string,
  error: string,
  conflicted = false,
): SyncReducerState {
  if (state.inflightBatchId !== batchId) return state;
  return {
    ...state,
    inflightBatchId: null,
    inflightEntryIds: [],
    inflightEntryRevisions: {},
    syncState: conflicted ? "conflicted" : "error",
    lastError: error,
  };
}

export function markSyncSessionLost(
  state: SyncReducerState,
  error: string,
): SyncReducerState {
  return {
    ...state,
    inflightBatchId: null,
    inflightEntryIds: [],
    inflightEntryRevisions: {},
    syncState: "lease-lost",
    lastError: error,
  };
}

export function applyRemoteBatchSuccess(
  state: SyncReducerState,
  input: {
    serverHead: number;
    previousDraftRevision: number;
    draftRevision: number;
    eventId: string;
  },
): SyncReducerState {
  if (state.draftRevision !== input.previousDraftRevision) {
    return {
      ...state,
      syncState: "conflicted",
      lastError: "远端同步事件与本地草稿版本不连续，请重新加载",
    };
  }
  return {
    ...state,
    baseVersion: input.serverHead,
    draftRevision: input.draftRevision,
    lastRemoteEventId: input.eventId,
    syncState: "idle",
    lastError: null,
  };
}

export function markRemoteConflict(
  state: SyncReducerState,
  error: string,
): SyncReducerState {
  return {
    ...state,
    syncState: "conflicted",
    lastError: error,
  };
}

export function markPendingCommit(state: SyncReducerState): SyncReducerState {
  return {
    ...state,
    pendingCommit: true,
  };
}

export function clearPendingCommit(state: SyncReducerState): SyncReducerState {
  return {
    ...state,
    pendingCommit: false,
  };
}

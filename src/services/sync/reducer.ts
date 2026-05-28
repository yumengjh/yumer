import type { SyncEntry, SyncReducerState, SyncBatchResult } from "./types";

function normalizeCreatePayload(entry: SyncEntry): SyncEntry {
  if (entry.opType !== "create" || !entry.payload) return entry;

  const syncCreateId = entry.syncCreateId ?? `sync-create:${entry.clientId}`;
  return {
    ...entry,
    syncCreateId,
    payload: {
      ...entry.payload,
      attrs: {
        ...((entry.payload.attrs as Record<string, unknown> | undefined) ?? {}),
        blockId: null,
        clientId: entry.clientId,
        syncCreateId,
        ...(entry.sortKey ? { sortKey: entry.sortKey } : {}),
      },
    },
  };
}

function isDeleteNotFound(entry: SyncEntry | undefined, result: SyncBatchResult): boolean {
  if (!entry || entry.opType !== "delete") return false;
  if (result.success) return false;
  const message = (result.error ?? "").toString().toLowerCase();
  return message.includes("not found") || message.includes("不存在");
}

export function createInitialSyncState(
  docId: string,
  rootBlockId: string,
  baseVersion: number,
): SyncReducerState {
  return {
    docId,
    rootBlockId,
    baseVersion,
    localRevision: 0,
    syncState: "idle",
    entries: {},
    dirtyOrder: [],
    inflightBatchId: null,
    inflightEntryIds: [],
    inflightEntryRevisions: {},
    pendingCommit: false,
    lastError: null,
  };
}

export function enqueueChange(state: SyncReducerState, incoming: SyncEntry): SyncReducerState {
  const current = state.entries[incoming.clientId];

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

  if (current?.opType === "delete" && incoming.opType === "update") {
    return state;
  }

  if (current && incoming.opType === "move") {
    return upsertEntry(state, normalizeCreatePayload({
      ...current,
      opType: current.opType === "create" ? "create" : current.opType,
      parentId: incoming.parentId ?? current.parentId,
      sortKey: incoming.sortKey ?? current.sortKey,
    }));
  }

  if (current) {
    return upsertEntry(state, normalizeCreatePayload({
      ...current,
      ...incoming,
      payload: incoming.payload ?? current.payload,
      sortKey: incoming.sortKey ?? current.sortKey,
    }));
  }

  return upsertEntry(state, normalizeCreatePayload(incoming));
}

function upsertEntry(state: SyncReducerState, entry: SyncEntry): SyncReducerState {
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

  if (byIndex && (!result.blockId || byIndex.blockId === result.blockId)) {
    return byIndex.clientId;
  }

  if (result.blockId) {
    const matched = inflightEntries.find((entry) => entry.blockId === result.blockId);
    if (matched) return matched.clientId;
  }

  return null;
}

function withServerBlockId(entry: SyncEntry, blockId: string, sortKey?: string): SyncEntry {
  const payload = entry.payload
    ? {
        ...entry.payload,
        attrs: {
          ...((entry.payload.attrs as Record<string, unknown> | undefined) ?? {}),
          blockId,
          "data-block-id": blockId,
          ...(sortKey ? { sortKey, "data-sort-key": sortKey } : {}),
        },
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

export function resolveBatchSuccess(
  state: SyncReducerState,
  batchId: string,
  results: SyncBatchResult[],
  serverHead?: number,
): SyncReducerState {
  if (state.inflightBatchId !== batchId) return state;

  const nextEntries = { ...state.entries };
  const inflightEntries = state.inflightEntryIds
    .map((id) => state.entries[id])
    .filter(Boolean);

  if (results.length === 0) {
    for (const entry of inflightEntries) {
      if (nextEntries[entry.clientId]?.revision === state.inflightEntryRevisions[entry.clientId]) {
        delete nextEntries[entry.clientId];
      }
    }
  }

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const byIndex = inflightEntries[index];
    const shouldTreatAsSuccess = result.success || isDeleteNotFound(byIndex, result);
    if (!shouldTreatAsSuccess) continue;

    const clientId = getAckedClientId(result, byIndex, inflightEntries);
    if (!clientId) continue;

    const currentEntry = nextEntries[clientId];
    if (!currentEntry) continue;

    const inflightRevision = state.inflightEntryRevisions[clientId];
    if (currentEntry.revision === inflightRevision) {
      delete nextEntries[clientId];
      continue;
    }

    if (result.operation === "create" && result.blockId) {
      nextEntries[clientId] = withServerBlockId(currentEntry, result.blockId, result.sortKey);
    }
  }

  const nextDirty = state.dirtyOrder.filter((id) => Boolean(nextEntries[id]));
  return {
    ...state,
    entries: nextEntries,
    dirtyOrder: nextDirty,
    inflightBatchId: null,
    inflightEntryIds: [],
    inflightEntryRevisions: {},
    baseVersion: typeof serverHead === "number" ? serverHead : state.baseVersion,
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

import { apiGet, apiPost } from "@/services/api-client";
import { createSortKeyBetween } from "./order";
import { SyncDebugLog } from "./debug-log";
import type { SyncEntry, SyncBatchResult } from "./types";

export interface SyncBatchResponse {
  acceptedBatchId: string | null;
  appliedAt: number;
  serverHead: number;
  draftRevision?: number;
  ackedThroughOpSeq?: number;
  needsReload: boolean;
  conflicts: Array<{ code: string; message: string }>;
  results: SyncBatchResult[];
}

export interface DocumentSyncState {
  docId: string;
  head: number;
  draftRevision: number;
  publishedHead: number;
  hasPendingDraft: boolean;
  pendingCount: number;
  updatedAt: string;
}

type SyncSource = "autosync" | "manual-save";

type BatchCreateBody = {
  type: "create";
  clientId: string;
  syncCreateId?: string;
  data: {
    docId: string;
    type: string;
    payload: Record<string, unknown>;
    parentId: string;
    sortKey?: string;
  };
};

type BatchUpdateBody = {
  type: "update";
  blockId: string;
  data: {
    payload: Record<string, unknown>;
    plainText?: string;
  };
};

type BatchDeleteBody = {
  type: "delete";
  blockId?: string;
  clientId?: string;
  syncCreateId?: string;
};

type BatchMoveBody = {
  type: "move";
  blockId: string;
  parentId: string;
  sortKey: string;
};

export type BatchOperationBody = BatchCreateBody | BatchUpdateBody | BatchDeleteBody | BatchMoveBody;

function buildCreatePayload(entry: SyncEntry, sortKey?: string): Record<string, unknown> {
  return {
    ...(entry.payload as Record<string, unknown>),
    attrs: {
      ...(((entry.payload?.attrs as Record<string, unknown> | undefined) ?? {})),
      blockId: null,
      clientId: entry.clientId,
      ...(sortKey ? { sortKey } : {}),
    },
  };
}

function reserveCreateSortKey(requestedSortKey: string | undefined, reservedSortKeys: Set<string>): string | undefined {
  if (!requestedSortKey) return requestedSortKey;
  if (!reservedSortKeys.has(requestedSortKey)) {
    reservedSortKeys.add(requestedSortKey);
    return requestedSortKey;
  }

  let candidate = requestedSortKey;
  while (reservedSortKeys.has(candidate)) {
    candidate = createSortKeyBetween(candidate, null);
  }
  reservedSortKeys.add(candidate);
  return candidate;
}

export function buildSyncBatchOperations(input: {
  docId: string;
  rootBlockId: string;
  operations: SyncEntry[];
}): BatchOperationBody[] {
  const bodyOperations: BatchOperationBody[] = [];
  const reservedCreateSortKeys = new Set<string>();

  for (const entry of input.operations) {
    if (entry.opType === "create") {
      if (!entry.payload || !entry.blockType) continue;
      const syncCreateId = entry.syncCreateId ?? `sync-create:${entry.clientId}`;
      const sortKey = reserveCreateSortKey(entry.sortKey, reservedCreateSortKeys);
      bodyOperations.push({
        type: "create",
        clientId: entry.clientId,
        syncCreateId,
        data: {
          docId: input.docId,
          type: entry.blockType,
          payload: buildCreatePayload(entry, sortKey),
          parentId: input.rootBlockId,
          sortKey,
        },
      });
      continue;
    }

    if (entry.opType === "update") {
      if (!entry.blockId || !entry.payload) continue;
      bodyOperations.push({
        type: "update",
        blockId: entry.blockId,
        data: {
          payload: entry.payload,
          plainText: entry.plainText,
        },
      });
      if (entry.sortKey) {
        bodyOperations.push({
          type: "move",
          blockId: entry.blockId,
          parentId: entry.parentId ?? input.rootBlockId,
          sortKey: entry.sortKey,
        });
      }
      continue;
    }

    if (entry.opType === "move") {
      if (!entry.blockId || !entry.sortKey) continue;
      bodyOperations.push({
        type: "move",
        blockId: entry.blockId,
        parentId: entry.parentId ?? input.rootBlockId,
        sortKey: entry.sortKey,
      });
      continue;
    }

    bodyOperations.push({
      type: "delete",
      ...(entry.blockId ? { blockId: entry.blockId } : {}),
      clientId: entry.clientId,
      ...(entry.syncCreateId ? { syncCreateId: entry.syncCreateId } : {}),
    });
  }

  return bodyOperations;
}

export async function postSyncBatch(input: {
  docId: string;
  rootBlockId: string;
  baseVersion: number;
  draftRevision: number;
  clientBatchId: string;
  source: SyncSource;
  sessionId?: string;
  sessionEpoch?: number;
  operations: SyncEntry[];
}): Promise<SyncBatchResponse> {
  const bodyOperations = buildSyncBatchOperations(input);
  const ackedThroughOpSeq = input.operations.reduce((max, entry) => {
    return typeof entry.revision === "number" ? Math.max(max, entry.revision) : max;
  }, 0);

  if (bodyOperations.length === 0) {
    return {
      acceptedBatchId: input.clientBatchId,
      appliedAt: Date.now(),
      serverHead: input.baseVersion,
      draftRevision: input.draftRevision,
      needsReload: false,
      conflicts: [],
      results: [],
    };
  }

  const requestBody = {
    docId: input.docId,
    baseVersion: input.baseVersion,
    draftRevision: input.draftRevision,
    clientBatchId: input.clientBatchId,
    source: input.source,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(typeof input.sessionEpoch === "number"
      ? { sessionEpoch: input.sessionEpoch }
      : {}),
    ...(ackedThroughOpSeq > 0 ? { ackedThroughOpSeq } : {}),
    createVersion: false,
    operations: bodyOperations,
  };

  const startTime = Date.now();
  try {
    const response = await apiPost<SyncBatchResponse>("/blocks/batch", requestBody);
    if (
      bodyOperations.length > 0 &&
      !response.needsReload &&
      (!Array.isArray(response.results) || response.results.length === 0)
    ) {
      throw new Error("同步协议错误：非空批次返回了空结果");
    }
    SyncDebugLog.add({
      id: input.clientBatchId,
      timestamp: startTime,
      source: input.source,
      docId: input.docId,
      baseVersion: input.baseVersion,
      clientBatchId: input.clientBatchId,
      operationCount: bodyOperations.length,
      requestBody,
      responseBody: response,
      duration: Date.now() - startTime,
      success: true,
    });
    return response;
  } catch (error) {
    SyncDebugLog.add({
      id: input.clientBatchId,
      timestamp: startTime,
      source: input.source,
      docId: input.docId,
      baseVersion: input.baseVersion,
      clientBatchId: input.clientBatchId,
      operationCount: bodyOperations.length,
      requestBody,
      error: error instanceof Error ? error.message : "未知错误",
      duration: Date.now() - startTime,
      success: false,
    });
    throw error;
  }
}

export async function getDocumentSyncState(docId: string): Promise<DocumentSyncState> {
  return apiGet<DocumentSyncState>(`/documents/${docId}/sync-state`);
}

import { apiGet, apiPost } from "@/services/api-client";
import type { SyncEntry, SyncBatchResult } from "./types";

export interface SyncBatchResponse {
  acceptedBatchId: string | null;
  appliedAt: number;
  serverHead: number;
  needsReload: boolean;
  conflicts: Array<{ code: string; message: string }>;
  results: SyncBatchResult[];
}

export interface DocumentSyncState {
  docId: string;
  head: number;
  publishedHead: number;
  hasPendingDraft: boolean;
  pendingCount: number;
  updatedAt: string;
}

type SyncSource = "autosync" | "manual-save";

type BatchCreateBody = {
  type: "create";
  clientId: string;
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
  blockId: string;
};

type BatchMoveBody = {
  type: "move";
  blockId: string;
  parentId: string;
  sortKey: string;
};

type BatchOperationBody = BatchCreateBody | BatchUpdateBody | BatchDeleteBody | BatchMoveBody;

export async function postSyncBatch(input: {
  docId: string;
  rootBlockId: string;
  baseVersion: number;
  clientBatchId: string;
  source: SyncSource;
  operations: SyncEntry[];
}): Promise<SyncBatchResponse> {
  const bodyOperations: BatchOperationBody[] = [];
  for (const entry of input.operations) {
    if (entry.opType === "create") {
      if (!entry.payload || !entry.blockType) continue;
      bodyOperations.push({
        type: "create",
        clientId: entry.clientId,
        data: {
          docId: input.docId,
          type: entry.blockType,
          payload: entry.payload,
          parentId: input.rootBlockId,
          sortKey: entry.sortKey,
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

    if (!entry.blockId) continue;
    bodyOperations.push({
      type: "delete",
      blockId: entry.blockId,
    });
  }

  if (bodyOperations.length === 0) {
    return {
      acceptedBatchId: input.clientBatchId,
      appliedAt: Date.now(),
      serverHead: input.baseVersion,
      needsReload: false,
      conflicts: [],
      results: [],
    };
  }

  return apiPost<SyncBatchResponse>("/blocks/batch", {
    docId: input.docId,
    baseVersion: input.baseVersion,
    clientBatchId: input.clientBatchId,
    source: input.source,
    createVersion: false,
    operations: bodyOperations,
  });
}

export async function getDocumentSyncState(docId: string): Promise<DocumentSyncState> {
  return apiGet<DocumentSyncState>(`/documents/${docId}/sync-state`);
}

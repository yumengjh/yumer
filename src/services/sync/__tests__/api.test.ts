import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSyncBatchOperations, postSyncBatch, postSyncManifestReconcile } from "../api";
import type { SyncEntry } from "../types";

const { apiPost } = vi.hoisted(() => ({
  apiPost: vi.fn(),
}));

vi.mock("@/services/api-client", () => ({
  apiGet: vi.fn(),
  apiPost,
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

describe("sync api payload builder", () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  it("deduplicates repeated create sortKeys before sending a batch", () => {
    const operations: SyncEntry[] = ["1", "2", "3"].map((suffix) => ({
      clientId: `client_${suffix}`,
      blockId: null,
      opType: "create",
      syncCreateId: `sync-create:client_${suffix}`,
      blockType: "paragraph",
      sortKey: "001998",
      payload: {
        type: "paragraph",
        attrs: {
          clientId: `client_${suffix}`,
          sortKey: "001998",
        },
      },
    }));

    const bodyOperations = buildSyncBatchOperations({
      docId: "doc_1",
      rootBlockId: "root_1",
      operations,
    });

    const createSortKeys = bodyOperations.map((operation) =>
      operation.type === "create" ? operation.data.sortKey : null,
    );
    const payloadSortKeys = bodyOperations.map((operation) =>
      operation.type === "create"
        ? (operation.data.payload.attrs as Record<string, unknown>).sortKey
        : null,
    );
    const payloadSyncCreateIds = bodyOperations.map((operation) =>
      operation.type === "create"
        ? (operation.data.payload.attrs as Record<string, unknown>).syncCreateId
        : null,
    );
    const operationSyncCreateIds = bodyOperations.map((operation) =>
      operation.type === "create" ? operation.syncCreateId : null,
    );

    expect(createSortKeys).toEqual(["001998", "002998", "003998"]);
    expect(payloadSortKeys).toEqual(createSortKeys);
    expect(payloadSyncCreateIds).toEqual([undefined, undefined, undefined]);
    expect(operationSyncCreateIds).toEqual([
      "sync-create:client_1",
      "sync-create:client_2",
      "sync-create:client_3",
    ]);
  });

  it("rejects malformed batch responses that omit results for non-empty operations", async () => {
    apiPost.mockResolvedValue({
      acceptedBatchId: "batch_missing_results",
      appliedAt: Date.now(),
      serverHead: 3,
      draftRevision: 1,
      needsReload: false,
      conflicts: [],
      results: [],
    });

    await expect(
      postSyncBatch({
        docId: "doc_1",
        rootBlockId: "root_1",
        baseVersion: 3,
        draftRevision: 1,
        clientBatchId: "batch_missing_results",
        source: "autosync",
        operations: [
          {
            clientId: "client_sync",
            blockId: "block_sync",
            opType: "update",
            payload: {
              type: "paragraph",
              content: [{ type: "text", text: "x" }],
            },
          },
        ],
      }),
    ).rejects.toThrow("同步协议错误");
  });

  it("sends delete tombstones by client identity when a deleted create has no server blockId", () => {
    const bodyOperations = buildSyncBatchOperations({
      docId: "doc_1",
      rootBlockId: "root_1",
      operations: [
        {
          clientId: "client_deleted_before_ack",
          blockId: null,
          opType: "delete",
          syncCreateId: "sync-create:client_deleted_before_ack",
        },
      ],
    });

    expect(bodyOperations).toEqual([
      {
        type: "delete",
        clientId: "client_deleted_before_ack",
        syncCreateId: "sync-create:client_deleted_before_ack",
      },
    ]);
  });

  it("preserves conflict responses with empty results so the caller can enter reload state", async () => {
    apiPost.mockResolvedValue({
      acceptedBatchId: "batch_stale_session",
      appliedAt: Date.now(),
      serverHead: 4,
      draftRevision: 2,
      needsReload: true,
      conflicts: [
        {
          code: "SYNC_SESSION_MISMATCH",
          message: "sync session is stale",
        },
      ],
      results: [],
    });

    await expect(
      postSyncBatch({
        docId: "doc_1",
        rootBlockId: "root_1",
        baseVersion: 3,
        draftRevision: 1,
        clientBatchId: "batch_stale_session",
        source: "autosync",
        operations: [
          {
            clientId: "client_sync",
            blockId: "block_sync",
            opType: "update",
            revision: 9,
            payload: { type: "paragraph" },
          },
        ],
      }),
    ).resolves.toMatchObject({
      needsReload: true,
      conflicts: [{ code: "SYNC_SESSION_MISMATCH" }],
      results: [],
    });
  });

  it("forwards optional sync session metadata in sync batch requests", async () => {
    apiPost.mockResolvedValue({
      acceptedBatchId: "batch_session",
      appliedAt: Date.now(),
      serverHead: 3,
      draftRevision: 1,
      needsReload: false,
      conflicts: [],
      results: [
        {
          operation: "update",
          success: true,
          blockId: "block_sync",
        },
      ],
    });

    await postSyncBatch({
      docId: "doc_1",
      rootBlockId: "root_1",
      baseVersion: 3,
      draftRevision: 1,
      clientBatchId: "batch_session",
      source: "autosync",
      sessionId: "session_1",
      sessionEpoch: 4,
      operations: [
        {
          clientId: "client_sync",
          blockId: "block_sync",
          opType: "update",
          revision: 9,
          payload: {
            type: "paragraph",
            content: [{ type: "text", text: "x" }],
          },
        },
      ],
    });

    expect(apiPost).toHaveBeenCalledWith(
      "/blocks/batch",
      expect.objectContaining({
        sessionId: "session_1",
        sessionEpoch: 4,
        ackedThroughOpSeq: 9,
      }),
    );
  });

  it("posts only sync identity fields for idle manifest reconciliation", async () => {
    apiPost.mockResolvedValue({
      docId: "doc_1",
      checkedAt: Date.now(),
      draftRevision: 4,
      needsReload: false,
      conflicts: [],
      tombstoned: [],
    });

    await postSyncManifestReconcile({
      docId: "doc_1",
      draftRevision: 3,
      clientBatchId: "reconcile_1",
      sessionId: "session_1",
      sessionEpoch: 2,
      manifest: [
        {
          blockId: "block_1",
          clientId: "client_1",
          syncCreateId: "sync-create:client_1",
          // @ts-expect-error verifies the request builder strips trace-only fields.
          textPreview: "not sent",
        },
      ],
    });

    expect(apiPost).toHaveBeenCalledWith("/documents/doc_1/sync-reconcile", {
      draftRevision: 3,
      clientBatchId: "reconcile_1",
      sessionId: "session_1",
      sessionEpoch: 2,
      manifest: [
        {
          blockId: "block_1",
          clientId: "client_1",
          syncCreateId: "sync-create:client_1",
        },
      ],
    });
  });
});

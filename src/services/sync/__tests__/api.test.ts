import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSyncBatchOperations,
  postDraftCheckpoint,
  postSyncBatch,
  postSyncManifestReconcile,
} from "../api";
import { createCanonicalSortKey } from "../order";
import { compareSortKeys } from "../fractional-key";
import { getSyncBaseStore } from "../base-store";
import { DELTA_MIN_FULL_SIZE } from "../delta";
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

  it("deduplicates repeated create sortKeys before sending a batch", async () => {
    const duplicateKey = createCanonicalSortKey(1);
    const operations: SyncEntry[] = ["1", "2", "3"].map((suffix) => ({
      clientId: `client_${suffix}`,
      blockId: null,
      opType: "create",
      syncCreateId: `sync-create:client_${suffix}`,
      blockType: "paragraph",
      sortKey: duplicateKey,
      payload: {
        type: "paragraph",
        attrs: {
          clientId: `client_${suffix}`,
          sortKey: duplicateKey,
        },
      },
    }));

    const bodyOperations = await buildSyncBatchOperations({
      docId: "doc_1",
      rootBlockId: "root_1",
      operations,
    });

    const createSortKeys = bodyOperations
      .filter((operation) => operation.type === "create")
      .map((operation) => operation.data.sortKey!);

    expect(createSortKeys).toHaveLength(3);
    expect(new Set(createSortKeys).size).toBe(3);
    for (let index = 1; index < createSortKeys.length; index += 1) {
      expect(compareSortKeys(createSortKeys[index - 1], createSortKeys[index])).toBeLessThan(0);
    }
  });

  it("merges structural fields into update and strips sync attrs from payload", async () => {
    const bodyOperations = await buildSyncBatchOperations({
      docId: "doc_1",
      rootBlockId: "root_1",
      operations: [
        {
          clientId: "client_move",
          blockId: "block_move",
          opType: "update",
          sortKey: createCanonicalSortKey(2),
          payload: {
            type: "paragraph",
            attrs: {
              blockId: "block_move",
              clientId: "client_move",
              sortKey: createCanonicalSortKey(2),
            },
            content: [{ type: "text", text: "moved" }],
          },
        },
      ],
    });

    expect(bodyOperations).toEqual([
      {
        type: "update",
        blockId: "block_move",
        data: {
          payload: {
            type: "paragraph",
            attrs: {},
            content: [{ type: "text", text: "moved" }],
          },
          sortKey: createCanonicalSortKey(2),
          parentId: "root_1",
        },
      },
    ]);
  });

  it("sends delta for large code block updates when a synced base exists", async () => {
    const blockId = "block_large_code";
    const baseStore = getSyncBaseStore("doc_delta");
    baseStore.clear();
    const largeText = "x".repeat(DELTA_MIN_FULL_SIZE);
    await baseStore.seedFromPayload({
      blockId,
      ver: 4,
      payload: {
        type: "codeBlock",
        attrs: { language: "typescript" },
        content: [{ type: "text", text: largeText }],
      },
    });

    const bodyOperations = await buildSyncBatchOperations({
      docId: "doc_delta",
      rootBlockId: "root_1",
      baseStore,
      operations: [
        {
          clientId: "client_code",
          blockId,
          opType: "update",
          payload: {
            type: "codeBlock",
            attrs: {
              blockId,
              clientId: "client_code",
              language: "typescript",
              lineNumbers: true,
            },
            content: [{ type: "text", text: `${largeText}y` }],
          },
        },
      ],
    });

    expect(bodyOperations).toHaveLength(1);
    expect(bodyOperations[0].type).toBe("update");
    if (bodyOperations[0].type !== "update") return;
    expect(bodyOperations[0].data.delta?.format).toBe("dmp-v1");
    expect(bodyOperations[0].data.delta?.baseVer).toBe(4);
    expect(bodyOperations[0].data.payload).toBeUndefined();
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

  it("posts draft checkpoints to the document checkpoint endpoint", async () => {
    apiPost.mockResolvedValue({
      acceptedCheckpointId: "checkpoint_1",
      appliedAt: 1710000000000,
      serverHead: 3,
      draftRevision: 5,
      needsReload: false,
      conflicts: [],
      contentHash: "sha256:test",
      mappings: [],
      tombstoned: [],
    });

    const response = await postDraftCheckpoint("doc_1", {
      mode: "checkpoint",
      coverage: "full",
      clientCheckpointId: "checkpoint_1",
      clientId: "frontend-client",
      baseVersion: 3,
      draftRevision: 4,
      sessionId: "sync_1",
      sessionEpoch: 2,
      contentHash: "sha256:test",
      generatedAt: 1710000000000,
      rootBlockId: "root_1",
      blocks: [],
    });

    expect(apiPost).toHaveBeenCalledWith(
      "/documents/doc_1/draft-checkpoint",
      expect.objectContaining({
        clientCheckpointId: "checkpoint_1",
      }),
    );
    expect(response.draftRevision).toBe(5);
  });

  it("sends delete tombstones by client identity when a deleted create has no server blockId", async () => {
    const bodyOperations = await buildSyncBatchOperations({
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
        originClientId: expect.any(String),
        originTabId: expect.any(String),
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

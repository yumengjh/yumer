import { describe, expect, it } from "vitest";
import {
  createInitialSyncState,
  enqueueChange,
  markSyncSessionLost,
  markBatchInflight,
  resolveBatchSuccess,
} from "../reducer";

describe("sync reducer", () => {
  it("merges create followed by update into one create", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_a",
      blockId: null,
      opType: "create",
      blockType: "paragraph",
      payload: { type: "paragraph", attrs: { clientId: "client_a" } },
    });
    state = enqueueChange(state, {
      clientId: "client_a",
      blockId: null,
      opType: "update",
      payload: {
        type: "paragraph",
        attrs: { clientId: "client_a" },
        content: [{ type: "text", text: "A" }],
      },
    });

    expect(state.dirtyOrder).toEqual(["client_a"]);
    expect(state.entries.client_a.opType).toBe("create");
    expect((state.entries.client_a.payload as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe("A");
  });

  it("drops create followed by delete before flush", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_b",
      blockId: null,
      opType: "create",
      blockType: "paragraph",
      payload: { type: "paragraph" },
    });
    state = enqueueChange(state, {
      clientId: "client_b",
      blockId: null,
      opType: "delete",
    });

    expect(state.dirtyOrder).toEqual([]);
    expect(state.entries.client_b).toBeUndefined();
  });

  it("keeps delete terminal when a later update arrives for the same block", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_restore",
      blockId: "b_restore",
      opType: "update",
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "first line" }],
      },
    });
    state = enqueueChange(state, {
      clientId: "client_restore",
      blockId: "b_restore",
      opType: "delete",
    });
    state = enqueueChange(state, {
      clientId: "client_restore",
      blockId: "b_restore",
      opType: "update",
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "first line recovered" }],
      },
    });

    expect(state.dirtyOrder).toEqual(["client_restore"]);
    expect(state.entries.client_restore.opType).toBe("delete");
    expect(state.entries.client_restore.blockId).toBe("b_restore");
  });

  it("seeds sync session metadata into the initial reducer state", () => {
    const state = createInitialSyncState("doc_1", "root_1", 3, 7, {
      sessionId: "session_1",
      sessionEpoch: 2,
      leaseExpiresAt: "2026-06-04T23:59:59.000Z",
      lastAckedOpSeq: 11,
    });

    expect(state.draftRevision).toBe(7);
    expect(state.sessionId).toBe("session_1");
    expect(state.sessionEpoch).toBe(2);
    expect(state.leaseExpiresAt).toBe("2026-06-04T23:59:59.000Z");
    expect(state.lastAckedOpSeq).toBe(11);
  });

  it("keeps pending operations when the active sync session is lost", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_pending",
      blockId: "block_pending",
      opType: "update",
      payload: { type: "paragraph" },
    });

    state = markSyncSessionLost(state, "SYNC_SESSION_EXPIRED");

    expect(state.syncState).toBe("lease-lost");
    expect(state.dirtyOrder).toEqual(["client_pending"]);
    expect(state.entries.client_pending).toBeDefined();
  });

  it("keeps pending commit marker while inflight batch is resolving", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_c",
      blockId: "b_1",
      opType: "update",
      payload: { type: "paragraph" },
    });
    state = markBatchInflight(state, "batch_1", [state.entries.client_c.clientId], true);

    expect(state.syncState).toBe("flushing");
    expect(state.pendingCommit).toBe(true);

    state = resolveBatchSuccess(state, "batch_1", [
      {
        clientId: "client_c",
        blockId: "b_1",
        success: true,
        operation: "update",
      },
    ]);

    expect(state.syncState).toBe("idle");
    expect(state.pendingCommit).toBe(true);
  });

  it("keeps both payload and ordering when an existing block is edited and moved", () => {
    let state = createInitialSyncState("doc_1", "root_1", 5);
    state = enqueueChange(state, {
      clientId: "c_a",
      blockId: "b_a",
      opType: "update",
      payload: { type: "paragraph", content: [{ type: "text", text: "changed" }] },
    });
    state = enqueueChange(state, {
      clientId: "c_a",
      blockId: "b_a",
      opType: "move",
      sortKey: "003000",
    });

    expect(state.entries.c_a.payload).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "changed" }],
    });
    expect(state.entries.c_a.sortKey).toBe("003000");
  });

  it("clears inflight update entry even when ack omits clientId", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_d",
      blockId: "b_9",
      opType: "update",
      payload: { type: "paragraph", content: [{ type: "text", text: "x" }] },
    });
    state = markBatchInflight(state, "batch_2", ["client_d"], false);
    state = resolveBatchSuccess(state, "batch_2", [
      {
        operation: "update",
        success: true,
        blockId: "b_9",
      },
    ]);

    expect(state.entries.client_d).toBeUndefined();
    expect(state.dirtyOrder).toEqual([]);
    expect(state.syncState).toBe("idle");
  });

  it("keeps an entry dirty when one backend result for the same block fails", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_move_update",
      blockId: "b_move_update",
      opType: "update",
      sortKey: "002000",
      payload: { type: "paragraph", content: [{ type: "text", text: "changed" }] },
    });
    state = markBatchInflight(state, "batch_partial", ["client_move_update"], false);

    state = resolveBatchSuccess(state, "batch_partial", [
      {
        operation: "update",
        success: true,
        blockId: "b_move_update",
      },
      {
        operation: "move",
        success: false,
        blockId: "b_move_update",
        error: "Parent block not found",
      },
    ]);

    expect(state.entries.client_move_update).toBeDefined();
    expect(state.dirtyOrder).toEqual(["client_move_update"]);
    expect(state.syncState).toBe("dirty");
  });

  it("treats delete-not-found as idempotent success to stop retry loop", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_del",
      blockId: "b_missing",
      opType: "delete",
    });
    state = markBatchInflight(state, "batch_del_1", ["client_del"], false);
    state = resolveBatchSuccess(state, "batch_del_1", [
      {
        operation: "delete",
        success: false,
        blockId: "b_missing",
        error: "Block not found",
      },
    ]);

    expect(state.entries.client_del).toBeUndefined();
    expect(state.dirtyOrder).toEqual([]);
    expect(state.syncState).toBe("idle");
  });

  it("clears a duplicate delete re-enqueued while the same delete is inflight", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_delete_repeat",
      blockId: "block_delete_repeat",
      opType: "delete",
    });
    state = markBatchInflight(state, "batch_delete_repeat", ["client_delete_repeat"], false);

    state = enqueueChange(state, {
      clientId: "client_delete_repeat",
      blockId: "block_delete_repeat",
      opType: "delete",
    });

    state = resolveBatchSuccess(state, "batch_delete_repeat", [
      {
        operation: "delete",
        success: true,
        blockId: "block_delete_repeat",
      },
    ]);

    expect(state.entries.client_delete_repeat).toBeUndefined();
    expect(state.dirtyOrder).toEqual([]);
    expect(state.syncState).toBe("idle");
  });

  it("treats an empty ack for inflight entries as a protocol error", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_without_block",
      blockId: null,
      opType: "update",
      payload: { type: "paragraph", content: [{ type: "text", text: "x" }] },
    });
    state = markBatchInflight(state, "batch_empty", ["client_without_block"], false);

    state = resolveBatchSuccess(state, "batch_empty", []);

    expect(state.entries.client_without_block).toBeDefined();
    expect(state.dirtyOrder).toEqual(["client_without_block"]);
    expect(state.syncState).toBe("error");
    expect(state.lastError).toContain("空结果");
  });

  it("keeps edits made to an existing block while an older update is inflight", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_fast",
      blockId: "block_fast",
      opType: "update",
      payload: { type: "paragraph", content: [{ type: "text", text: "old queued text" }] },
    });
    state = markBatchInflight(state, "batch_fast_1", ["client_fast"], false);

    state = enqueueChange(state, {
      clientId: "client_fast",
      blockId: "block_fast",
      opType: "update",
      payload: { type: "paragraph", content: [{ type: "text", text: "new typed text" }] },
    });

    state = resolveBatchSuccess(state, "batch_fast_1", [
      {
        operation: "update",
        success: true,
        blockId: "block_fast",
      },
    ]);

    expect(state.dirtyOrder).toEqual(["client_fast"]);
    expect(state.syncState).toBe("dirty");
    expect((state.entries.client_fast.payload as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(
      "new typed text",
    );
  });

  it("turns edits made to a newly created block while create is inflight into a follow-up update", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_new",
      blockId: null,
      opType: "create",
      blockType: "paragraph",
      payload: { type: "paragraph", attrs: { clientId: "client_new" } },
    });
    state = markBatchInflight(state, "batch_create_1", ["client_new"], false);

    state = enqueueChange(state, {
      clientId: "client_new",
      blockId: null,
      opType: "update",
      payload: {
        type: "paragraph",
        attrs: { clientId: "client_new" },
        content: [{ type: "text", text: "typed before create ack" }],
      },
    });

    state = resolveBatchSuccess(state, "batch_create_1", [
      {
        operation: "create",
        success: true,
        clientId: "client_new",
        blockId: "server_block_new",
        sortKey: "000984",
      },
    ]);

    expect(state.dirtyOrder).toEqual(["client_new"]);
    expect(state.syncState).toBe("dirty");
    expect(state.entries.client_new.opType).toBe("update");
    expect(state.entries.client_new.blockId).toBe("server_block_new");
    expect(state.entries.client_new.sortKey).toBe("000984");
    expect((state.entries.client_new.payload as { attrs?: Record<string, unknown> }).attrs).toMatchObject({
      blockId: "server_block_new",
      "data-block-id": "server_block_new",
      sortKey: "000984",
      "data-sort-key": "000984",
    });
    expect(
      (state.entries.client_new.payload as { attrs?: Record<string, unknown> }).attrs?.syncCreateId,
    ).toBeUndefined();
    expect(
      (state.entries.client_new.payload as { attrs?: Record<string, unknown> }).attrs?.[
        "data-sync-create-id"
      ],
    ).toBeUndefined();
    expect((state.entries.client_new.payload as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(
      "typed before create ack",
    );
  });

  it("carries server sortKey into a follow-up dirty update after move ack", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_move",
      blockId: "block_move",
      opType: "move",
      sortKey: "002000",
    });
    state = markBatchInflight(state, "batch_move_1", ["client_move"], false);

    state = enqueueChange(state, {
      clientId: "client_move",
      blockId: "block_move",
      opType: "update",
      payload: {
        type: "paragraph",
        attrs: { clientId: "client_move", blockId: "block_move", sortKey: "002000" },
        content: [{ type: "text", text: "typed while move inflight" }],
      },
    });

    state = resolveBatchSuccess(state, "batch_move_1", [
      {
        operation: "move",
        success: true,
        blockId: "block_move",
        sortKey: "001500",
      },
    ]);

    expect(state.dirtyOrder).toEqual(["client_move"]);
    expect(state.entries.client_move.sortKey).toBe("001500");
    expect((state.entries.client_move.payload as { attrs?: Record<string, unknown> }).attrs).toMatchObject({
      sortKey: "001500",
      "data-sort-key": "001500",
    });
  });

  it("advances the draft revision from a successful batch acknowledgement", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3, 7);
    state = enqueueChange(state, {
      clientId: "client_update",
      blockId: "block_update",
      opType: "update",
      payload: { type: "paragraph" },
    });
    state = markBatchInflight(state, "batch_revision", ["client_update"], false);

    state = resolveBatchSuccess(
      state,
      "batch_revision",
      [{ operation: "update", success: true, blockId: "block_update" }],
      3,
      8,
    );

    expect(state.draftRevision).toBe(8);
  });

  it("advances lastAckedOpSeq after a fully successful batch", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3, 7, {
      sessionId: "session_1",
      sessionEpoch: 2,
      lastAckedOpSeq: 4,
    });
    state = enqueueChange(state, {
      clientId: "client_ack",
      blockId: "block_ack",
      opType: "update",
      payload: { type: "paragraph" },
    });
    state = markBatchInflight(state, "batch_ack", ["client_ack"], false);

    state = resolveBatchSuccess(
      state,
      "batch_ack",
      [{ operation: "update", success: true, blockId: "block_ack" }],
      3,
      8,
      5,
    );

    expect(state.lastAckedOpSeq).toBe(5);
  });

  it("turns a delete made to a newly created block while create is inflight into a follow-up delete", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_deleted_new",
      blockId: null,
      opType: "create",
      blockType: "paragraph",
      payload: { type: "paragraph", attrs: { clientId: "client_deleted_new" } },
    });
    state = markBatchInflight(state, "batch_create_delete_1", ["client_deleted_new"], false);

    state = enqueueChange(state, {
      clientId: "client_deleted_new",
      blockId: null,
      opType: "delete",
    });

    state = resolveBatchSuccess(state, "batch_create_delete_1", [
      {
        operation: "create",
        success: true,
        clientId: "client_deleted_new",
        blockId: "server_block_deleted_new",
      },
    ]);

    expect(state.dirtyOrder).toEqual(["client_deleted_new"]);
    expect(state.syncState).toBe("dirty");
    expect(state.entries.client_deleted_new.opType).toBe("delete");
    expect(state.entries.client_deleted_new.blockId).toBe("server_block_deleted_new");
  });

  it("clears a create entry when the server suppresses it by tombstone", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_tombstoned_create",
      blockId: null,
      opType: "create",
      syncCreateId: "sync-create:client_tombstoned_create",
      blockType: "paragraph",
      payload: { type: "paragraph", attrs: { clientId: "client_tombstoned_create" } },
    });
    state = markBatchInflight(state, "batch_tombstoned_create", ["client_tombstoned_create"], false);

    state = resolveBatchSuccess(state, "batch_tombstoned_create", [
      {
        operation: "create",
        success: true,
        clientId: "client_tombstoned_create",
        tombstoned: true,
        diagnosticCode: "CREATE_SUPPRESSED_BY_TOMBSTONE",
      },
    ]);

    expect(state.entries.client_tombstoned_create).toBeUndefined();
    expect(state.dirtyOrder).toEqual([]);
    expect(state.syncState).toBe("idle");
  });

  it("clears a client-identity delete when the server stores a tombstone ack", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_deleted_before_create_ack",
      blockId: null,
      opType: "delete",
      syncCreateId: "sync-create:client_deleted_before_create_ack",
    });
    state = markBatchInflight(
      state,
      "batch_delete_tombstone",
      ["client_deleted_before_create_ack"],
      false,
    );

    state = resolveBatchSuccess(state, "batch_delete_tombstone", [
      {
        operation: "delete",
        success: true,
        blockId: "client_deleted_before_create_ack",
        matchBy: "not_found",
        diagnosticCode: "DELETE_TARGET_NOT_FOUND_BY_CLIENT_IDENTITY",
        tombstoned: true,
      },
    ]);

    expect(state.entries.client_deleted_before_create_ack).toBeUndefined();
    expect(state.dirtyOrder).toEqual([]);
    expect(state.syncState).toBe("idle");
  });

  it("normalizes create payload attrs after create+update merge", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_fix",
      blockId: null,
      opType: "create",
      syncCreateId: "sync-create:client_fix",
      blockType: "paragraph",
      sortKey: "001995",
      payload: {
        type: "paragraph",
        attrs: { clientId: "client_fix", syncCreateId: "sync-create:client_fix" },
      },
    });
    state = enqueueChange(state, {
      clientId: "client_fix",
      blockId: null,
      opType: "update",
      payload: {
        type: "paragraph",
        attrs: { clientId: "client_fix", syncCreateId: "sync-create:foreign" },
        content: [{ type: "text", text: "2" }],
      },
    });

    expect((state.entries.client_fix.payload as { attrs?: Record<string, unknown> }).attrs).toMatchObject({
      blockId: null,
      clientId: "client_fix",
      sortKey: "001995",
    });
    expect(
      (state.entries.client_fix.payload as { attrs?: Record<string, unknown> }).attrs?.syncCreateId,
    ).toBeUndefined();
  });
  it("keeps delete when a later update arrives for the same client", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_deleted_existing",
      blockId: "block_deleted_existing",
      opType: "update",
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "before delete" }],
      },
    });
    state = enqueueChange(state, {
      clientId: "client_deleted_existing",
      blockId: "block_deleted_existing",
      opType: "delete",
    });
    state = enqueueChange(state, {
      clientId: "client_deleted_existing",
      blockId: "block_deleted_existing",
      opType: "update",
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "should not revive" }],
      },
    });

    expect(state.dirtyOrder).toEqual(["client_deleted_existing"]);
    expect(state.entries.client_deleted_existing.opType).toBe("delete");
    expect(state.entries.client_deleted_existing.blockId).toBe("block_deleted_existing");
  });

  it("keeps delete when a later move arrives for the same client", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_deleted_moved",
      blockId: "block_deleted_moved",
      opType: "update",
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "before delete" }],
      },
    });
    state = enqueueChange(state, {
      clientId: "client_deleted_moved",
      blockId: "block_deleted_moved",
      opType: "delete",
    });
    state = enqueueChange(state, {
      clientId: "client_deleted_moved",
      blockId: "block_deleted_moved",
      opType: "move",
      sortKey: "009000",
    });

    expect(state.dirtyOrder).toEqual(["client_deleted_moved"]);
    expect(state.entries.client_deleted_moved.opType).toBe("delete");
    expect(state.entries.client_deleted_moved.blockId).toBe("block_deleted_moved");
  });

  it("treats empty ack results for inflight entries as a protocol error", () => {
    let state = createInitialSyncState("doc_1", "root_1", 3);
    state = enqueueChange(state, {
      clientId: "client_protocol",
      blockId: "block_protocol",
      opType: "update",
      payload: { type: "paragraph", content: [{ type: "text", text: "x" }] },
    });
    state = markBatchInflight(state, "batch_protocol", ["client_protocol"], false);

    state = resolveBatchSuccess(state, "batch_protocol", []);

    expect(state.entries.client_protocol).toBeDefined();
    expect(state.dirtyOrder).toEqual(["client_protocol"]);
    expect(state.syncState).toBe("error");
    expect(state.lastError).toContain("空结果");
  });
});

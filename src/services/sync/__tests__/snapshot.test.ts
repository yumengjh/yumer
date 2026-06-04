import { describe, expect, it } from "vitest";
import { createInitialSyncState, markBatchInflight, resolveBatchSuccess } from "../reducer";
import { advanceSyncSnapshot } from "../snapshot";
import { selectSyncBatchOperations } from "../batching";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("sync snapshot advancement", () => {
  it("initializes the snapshot without enqueueing a change", () => {
    const state = createInitialSyncState("doc_1", "root_1", 1);
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1" },
          content: [{ type: "text", text: "loaded" }],
        },
      ],
    };

    const next = advanceSyncSnapshot(state, null, doc);

    expect(next.state.dirtyOrder).toEqual([]);
    expect(next.snapshot.content?.[0].attrs?.clientId).toBe("client_1");
  });

  it("treats an initial edited block without a server blockId as unsynced", () => {
    const state = createInitialSyncState("doc_1", "root_1", 1);
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "client_unsynced" },
          content: [{ type: "text", text: "first line typed into empty doc" }],
        },
      ],
    };

    const next = advanceSyncSnapshot(state, null, doc);

    expect(next.state.dirtyOrder).toEqual(["client_unsynced"]);
    expect(next.state.entries.client_unsynced).toMatchObject({
      clientId: "client_unsynced",
      blockId: null,
      opType: "create",
      sortKey: "001000",
    });
  });

  it("synchronously enqueues differences between the previous and current editor snapshot", () => {
    const state = createInitialSyncState("doc_1", "root_1", 1);
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1" },
          content: [{ type: "text", text: "old text" }],
        },
      ],
    };
    const current: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1" },
          content: [{ type: "text", text: "new text just typed" }],
        },
      ],
    };

    const next = advanceSyncSnapshot(state, previous, current);

    expect(next.state.dirtyOrder).toEqual(["client_1"]);
    expect(next.state.syncState).toBe("dirty");
    expect((next.state.entries.client_1.payload as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(
      "new text just typed",
    );
    expect(next.snapshot.content?.[0].content?.[0].text).toBe("new text just typed");
  });

  it("keeps a block without a server blockId as create when it is edited later", () => {
    const state = createInitialSyncState("doc_1", "root_1", 1);
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "client_unsynced" },
        },
      ],
    };
    const current: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "client_unsynced" },
          content: [{ type: "text", text: "now has content" }],
        },
      ],
    };

    const next = advanceSyncSnapshot(state, previous, current);

    expect(next.state.dirtyOrder).toEqual(["client_unsynced"]);
    expect(next.state.entries.client_unsynced).toMatchObject({
      clientId: "client_unsynced",
      blockId: null,
      opType: "create",
      sortKey: "001000",
    });
  });

  it("enqueues moves for existing blocks that only have server block ids", () => {
    const state = createInitialSyncState("doc_1", "root_1", 1);
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_paragraph", sortKey: "027000" },
          content: [{ type: "text", text: "paragraph" }],
        },
        {
          type: "codeBlock",
          attrs: { blockId: "block_code", sortKey: "027500" },
          content: [{ type: "text", text: "code" }],
        },
      ],
    };
    const current: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { blockId: "block_code", sortKey: "027500" },
          content: [{ type: "text", text: "code" }],
        },
        {
          type: "paragraph",
          attrs: { blockId: "block_paragraph", sortKey: "027000" },
          content: [{ type: "text", text: "paragraph" }],
        },
      ],
    };

    const next = advanceSyncSnapshot(state, previous, current);
    const generatedClientId = next.snapshot.content?.[0].attrs?.clientId;

    expect(generatedClientId).toEqual(expect.any(String));
    expect(generatedClientId).not.toBe("block_code");
    expect(next.state.dirtyOrder).toEqual([generatedClientId]);
    expect(next.state.entries[generatedClientId as string]).toMatchObject({
      clientId: generatedClientId,
      blockId: "block_code",
      opType: "move",
      sortKey: "013500",
    });
    expect(next.snapshot.content?.[0].attrs?.sortKey).toBe("013500");
  });

  it("persists generated sortKeys into the local snapshot for sequential blank-line creation", () => {
    let state = createInitialSyncState("doc_1", "root_1", 1);

    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1", sortKey: "001000" },
          content: [{ type: "text", text: "1" }],
        },
      ],
    };

    const currentStep1: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1", sortKey: "001000" },
          content: [{ type: "text", text: "1" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "blank_1" },
        },
      ],
    };

    const step1 = advanceSyncSnapshot(state, previous, currentStep1);
    state = step1.state;

    expect(step1.snapshot.content?.[1].attrs?.sortKey).toBe("002000");

    const currentStep2: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1", sortKey: "001000" },
          content: [{ type: "text", text: "1" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "blank_1" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "block_2" },
          content: [{ type: "text", text: "2" }],
        },
      ],
    };

    const step2 = advanceSyncSnapshot(state, step1.snapshot, currentStep2);

    expect(step2.snapshot.content?.[1].attrs?.sortKey).toBe("002000");
    expect(step2.snapshot.content?.[2].attrs?.sortKey).toBe("003000");
    expect(step2.state.entries.blank_1.sortKey).toBe("002000");
    expect(step2.state.entries.block_2.sortKey).toBe("003000");
  });

  it("keeps deleting an older existing block when a replacement wave is removed during create ack", () => {
    let state = createInitialSyncState("doc_1", "root_1", 1);

    const loaded: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "b_old_a", clientId: "c_old_a", sortKey: "001000" },
          content: [{ type: "text", text: "old a" }],
        },
        {
          type: "paragraph",
          attrs: { blockId: "b_old_b", clientId: "c_old_b", sortKey: "002000" },
          content: [{ type: "text", text: "old b" }],
        },
      ],
    };

    const initial = advanceSyncSnapshot(state, null, loaded);
    state = initial.state;

    const replacementWave: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_final", sortKey: "001000" },
          content: [{ type: "text", text: "final text" }],
        },
        {
          type: "paragraph",
          attrs: { blockId: "b_old_b", clientId: "c_old_b", sortKey: "002000" },
          content: [{ type: "text", text: "old b" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_temp_3", sortKey: "003000" },
          content: [{ type: "text", text: "temp 3" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_temp_4", sortKey: "004000" },
          content: [{ type: "text", text: "temp 4" }],
        },
      ],
    };

    const step1 = advanceSyncSnapshot(state, initial.snapshot, replacementWave);
    state = markBatchInflight(
      step1.state,
      "batch_1",
      step1.state.dirtyOrder,
      false,
    );

    const finalLocal: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_final", sortKey: "001000" },
          content: [{ type: "text", text: "final text" }],
        },
      ],
    };

    const step2 = advanceSyncSnapshot(state, step1.snapshot, finalLocal);

    expect(step2.state.entries.c_old_b).toMatchObject({
      clientId: "c_old_b",
      blockId: "b_old_b",
      opType: "delete",
    });

    const afterAck = resolveBatchSuccess(step2.state, "batch_1", [
      {
        operation: "create",
        success: true,
        clientId: "c_final",
        blockId: "b_final",
        sortKey: "001000",
      },
      {
        operation: "delete",
        success: true,
        blockId: "b_old_a",
      },
      {
        operation: "create",
        success: true,
        clientId: "c_temp_3",
        blockId: "b_temp_3",
        sortKey: "003000",
      },
      {
        operation: "create",
        success: true,
        clientId: "c_temp_4",
        blockId: "b_temp_4",
        sortKey: "004000",
      },
    ]);

    const followUp = selectSyncBatchOperations(
      afterAck.dirtyOrder,
      afterAck.entries,
    );

    expect(followUp).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: "c_old_b",
          blockId: "b_old_b",
          opType: "delete",
        }),
      ]),
    );
  });
});

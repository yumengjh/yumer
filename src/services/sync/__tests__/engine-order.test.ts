import { describe, expect, it } from "vitest";
import {
  applyCreateAck,
  applyServerAck,
  applyServerDeleteAck,
  deriveSyncEntries,
} from "../engine";
import type { TiptapDoc } from "@/services/tiptap-converter";
import {
  assertSortKeyBetween,
  compareSortKeys,
  createCanonicalSortKey,
  createSortKeyBetween,
  SK0,
  SK1,
  SK2,
  SK3,
  SK4,
} from "./test-sort-key";

const SK5 = createCanonicalSortKey(5);
const SK_BEFORE_0 = createSortKeyBetween(null, SK0);
const SK_SERVER_CREATE = createSortKeyBetween(null, SK0);
const SK_SERVER_MOVE = createSortKeyBetween(SK0, SK1);
const SK_SERVER_NESTED_ITEM = createSortKeyBetween(SK0, SK1);
const SK_SERVER_NESTED_PARA = createSortKeyBetween(SK_SERVER_NESTED_ITEM, SK1);

describe("deriveSyncEntries order handling", () => {
  it("creates a non-colliding sortKey when inserting between existing blocks", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: SK2 },
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_x" },
          content: [{ type: "text", text: "inserted" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: SK2 },
        },
      ],
    };

    const entries = deriveSyncEntries(previous, next);
    const create = entries.find((entry) => entry.clientId === "c_x");

    expect(create?.opType).toBe("create");
    assertSortKeyBetween(create?.sortKey, SK0, SK2);
  });

  it("does not move unchanged existing blocks when inserting into a document with duplicated sortKeys", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
          content: [{ type: "text", text: "A" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: SK0 },
          content: [{ type: "text", text: "B" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_c", blockId: "b_c", sortKey: SK2 },
          content: [{ type: "text", text: "C" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
          content: [{ type: "text", text: "A" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_x" },
          content: [{ type: "text", text: "X" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: SK0 },
          content: [{ type: "text", text: "B" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_c", blockId: "b_c", sortKey: SK2 },
          content: [{ type: "text", text: "C" }],
        },
      ],
    };

    const entries = deriveSyncEntries(previous, next);

    expect(entries.filter((entry) => entry.opType === "move")).toEqual([]);
    expect(entries.find((entry) => entry.clientId === "c_x")?.opType).toBe(
      "create",
    );
  });

  it("does not emit moves for a text-only update when existing sortKeys are out of array order", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
          content: [{ type: "text", text: "A" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: SK_BEFORE_0 },
          content: [{ type: "text", text: "B" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_c", blockId: "b_c", sortKey: SK2 },
          content: [{ type: "text", text: "C" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
          content: [{ type: "text", text: "A" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: SK_BEFORE_0 },
          content: [{ type: "text", text: "B edited" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_c", blockId: "b_c", sortKey: SK2 },
          content: [{ type: "text", text: "C" }],
        },
      ],
    };

    const entries = deriveSyncEntries(previous, next);

    expect(entries.filter((entry) => entry.opType === "move")).toEqual([]);
    expect(entries).toMatchObject([
      { clientId: "c_b", blockId: "b_b", opType: "update" },
    ]);
  });

  it("allocates unique sortKeys when multiple top-level blocks are created in sequence", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
        },
        { type: "paragraph", attrs: { clientId: "c_empty_1" } },
        { type: "paragraph", attrs: { clientId: "c_empty_2" } },
        {
          type: "paragraph",
          attrs: { clientId: "c_after" },
          content: [{ type: "text", text: "after blanks" }],
        },
      ],
    };

    const creates = deriveSyncEntries(previous, next).filter(
      (entry) => entry.opType === "create",
    );

    expect(creates.map((entry) => entry.clientId)).toEqual([
      "c_empty_1",
      "c_empty_2",
      "c_after",
    ]);
    const sortKeys = creates.map((entry) => entry.sortKey!);
    expect(sortKeys).toHaveLength(3);
    for (let index = 1; index < sortKeys.length; index += 1) {
      expect(compareSortKeys(sortKeys[index - 1], sortKeys[index])).toBeLessThan(0);
    }
    expect(compareSortKeys(SK0, sortKeys[0])).toBeLessThan(0);
  });

  it("overrides duplicated inherited sortKeys when creating multiple adjacent blocks", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_new_1", sortKey: SK1 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_new_2", sortKey: SK1 },
          content: [{ type: "text", text: "2" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_new_3", sortKey: SK1 },
        },
      ],
    };

    const creates = deriveSyncEntries(previous, next).filter(
      (entry) => entry.opType === "create",
    );

    const sortKeys = creates.map((entry) => entry.sortKey!);
    expect(sortKeys).toHaveLength(3);
    expect(new Set(sortKeys).size).toBe(3);
    for (let index = 1; index < sortKeys.length; index += 1) {
      expect(compareSortKeys(sortKeys[index - 1], sortKeys[index])).toBeLessThan(0);
    }
  });

  it("overrides inherited syncCreateId so each create keeps its own stable identity", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            clientId: "c_1",
            blockId: "b_1",
            sortKey: SK0,
            syncCreateId: "sync-create:c_1",
          },
          content: [{ type: "text", text: "1" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            clientId: "c_1",
            blockId: "b_1",
            sortKey: SK0,
            syncCreateId: "sync-create:c_1",
          },
          content: [{ type: "text", text: "1" }],
        },
        {
          type: "paragraph",
          attrs: {
            clientId: "c_blank",
            syncCreateId: "sync-create:c_1",
          },
        },
        {
          type: "paragraph",
          attrs: {
            clientId: "c_2",
            syncCreateId: "sync-create:c_1",
          },
          content: [{ type: "text", text: "2" }],
        },
      ],
    };

    const creates = deriveSyncEntries(previous, next).filter(
      (entry) => entry.opType === "create",
    );

    expect(creates.map((entry) => entry.syncCreateId)).toEqual([
      "sync-create:c_blank",
      "sync-create:c_2",
    ]);
    expect((creates[0].payload?.attrs as Record<string, unknown> | undefined)?.syncCreateId).toBeUndefined();
    expect((creates[1].payload?.attrs as Record<string, unknown> | undefined)?.syncCreateId).toBeUndefined();
  });

  it("emits move entries when existing blocks change relative order", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: SK2 },
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: SK2 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: SK0 },
        },
      ],
    };

    const entries = deriveSyncEntries(previous, next);

    expect(
      entries.some(
        (entry) => entry.opType === "move" && entry.blockId === "b_b",
      ),
    ).toBe(true);
    const movedSortKey = entries.find((entry) => entry.blockId === "b_b")?.sortKey;
    expect(movedSortKey).toBeDefined();
    expect(compareSortKeys(movedSortKey!, SK0)).toBeLessThan(0);
  });

  it("emits a move when existing blockId-only code blocks change relative order", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "b_paragraph", sortKey: SK0 },
          content: [{ type: "text", text: "paragraph" }],
        },
        {
          type: "codeBlock",
          attrs: { blockId: "b_code", sortKey: SK1 },
          content: [{ type: "text", text: "code" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { blockId: "b_code", sortKey: SK1 },
          content: [{ type: "text", text: "code" }],
        },
        {
          type: "paragraph",
          attrs: { blockId: "b_paragraph", sortKey: SK0 },
          content: [{ type: "text", text: "paragraph" }],
        },
      ],
    };

    const entries = deriveSyncEntries(previous, next);
    const move = entries.find((entry) => entry.opType === "move");

    expect(move).toMatchObject({
      blockId: "b_code",
      opType: "move",
    });
    expect(compareSortKeys(move!.sortKey!, SK0)).toBeLessThan(0);
    expect(move?.clientId).toEqual(expect.any(String));
    expect(move?.clientId).not.toBe("b_code");
  });

  it("only emits a move for the dragged block when moving the tail block to the front", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_2", blockId: "b_2", sortKey: SK1 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_3", blockId: "b_3", sortKey: SK2 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_4", blockId: "b_4", sortKey: SK3 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_5", blockId: "b_5", sortKey: SK4 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_6", blockId: "b_6", sortKey: SK5 },
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_6", blockId: "b_6", sortKey: SK5 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_2", blockId: "b_2", sortKey: SK1 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_3", blockId: "b_3", sortKey: SK2 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_4", blockId: "b_4", sortKey: SK3 },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_5", blockId: "b_5", sortKey: SK4 },
        },
      ],
    };

    const moves = deriveSyncEntries(previous, next).filter(
      (entry) => entry.opType === "move",
    );

    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      clientId: "c_6",
      blockId: "b_6",
      opType: "move",
    });
    expect(compareSortKeys(moves[0].sortKey!, SK1)).toBeLessThan(0);
  });

  it("keeps the existing clientId when a previously loaded block is edited", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_loaded", blockId: "b_loaded", sortKey: SK0 },
          content: [{ type: "text", text: "before" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_loaded", blockId: "b_loaded", sortKey: SK0 },
          content: [{ type: "text", text: "after" }],
        },
      ],
    };

    const entries = deriveSyncEntries(previous, next);

    expect(entries).toMatchObject([
      {
        clientId: "c_loaded",
        blockId: "b_loaded",
        opType: "update",
      },
    ]);
    expect(entries.some((entry) => entry.clientId === "b_loaded")).toBe(false);
  });

  it("does not emit content updates for sync metadata-only changes", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            clientId: "c_a",
            blockId: "b_a",
            sortKey: SK0,
            syncCreateId: "sync-create:c_a",
          },
          content: [{ type: "text", text: "same text" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            clientId: "c_a",
            blockId: "b_a",
            sortKey: SK_SERVER_CREATE,
            syncCreateId: "sync-create:c_a",
            clientBatchId: "batch_1",
            "data-sort-key": SK_SERVER_CREATE,
            "data-sync-create-id": "sync-create:c_a",
          },
          content: [{ type: "text", text: "same text" }],
        },
      ],
    };

    expect(deriveSyncEntries(previous, next)).toEqual([]);
  });

  it("patches server sortKey returned by create ack into the local snapshot", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            clientId: "c_new",
            blockId: null,
            sortKey: SK0,
            syncCreateId: "sync-create:c_new",
            "data-sync-create-id": "sync-create:c_new",
            clientBatchId: "batch_1",
          },
        },
      ],
    };

    const patched = applyCreateAck(doc, [
      { clientId: "c_new", blockId: "b_new", sortKey: SK_SERVER_CREATE },
    ]);

    expect(patched.content[0].attrs?.blockId).toBe("b_new");
    expect(patched.content[0].attrs?.["data-block-id"]).toBe("b_new");
    expect(patched.content[0].attrs?.sortKey).toBe(SK_SERVER_CREATE);
    expect(patched.content[0].attrs?.["data-sort-key"]).toBe(SK_SERVER_CREATE);
    expect(patched.content[0].attrs?.syncCreateId).toBeUndefined();
    expect(patched.content[0].attrs?.clientBatchId).toBeUndefined();
    expect(patched.content[0].attrs?.["data-sync-create-id"]).toBeUndefined();
  });

  it("patches server sortKey returned by move ack by block id", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_existing", blockId: "b_existing", sortKey: SK2 },
        },
      ],
    };

    const patched = applyServerAck(doc, [
      { blockId: "b_existing", sortKey: SK_SERVER_MOVE },
    ]);

    expect(patched.content[0].attrs?.blockId).toBe("b_existing");
    expect(patched.content[0].attrs?.sortKey).toBe(SK_SERVER_MOVE);
    expect(patched.content[0].attrs?.["data-sort-key"]).toBe(SK_SERVER_MOVE);
  });
  it("patches nested nodes returned by ack recursively", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { clientId: "list_client" },
          content: [
            {
              type: "listItem",
              attrs: { clientId: "item_client", syncCreateId: "sync-create:item_client" },
              content: [
                {
                  type: "paragraph",
                  attrs: { clientId: "paragraph_client", clientBatchId: "batch_nested" },
                  content: [{ type: "text", text: "nested" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const patched = applyServerAck(doc, [
      { clientId: "item_client", blockId: "block_item", sortKey: SK_SERVER_NESTED_ITEM },
      { clientId: "paragraph_client", blockId: "block_paragraph", sortKey: SK_SERVER_NESTED_PARA },
    ]);

    const listItem = patched.content[0].content?.[0];
    const paragraph = listItem?.content?.[0];

    expect(listItem?.attrs?.blockId).toBe("block_item");
    expect(listItem?.attrs?.sortKey).toBe(SK_SERVER_NESTED_ITEM);
    expect(listItem?.attrs?.syncCreateId).toBeUndefined();
    expect(paragraph?.attrs?.blockId).toBe("block_paragraph");
    expect(paragraph?.attrs?.sortKey).toBe(SK_SERVER_NESTED_PARA);
    expect(paragraph?.attrs?.clientBatchId).toBeUndefined();
  });

  it("removes top-level blocks acknowledged as deleted", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_keep", blockId: "b_keep" },
          content: [{ type: "text", text: "keep" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_gone", blockId: "b_gone" },
          content: [{ type: "text", text: "gone" }],
        },
      ],
    };

    const patched = applyServerDeleteAck(doc, [
      { blockId: "b_gone", clientId: "c_gone" },
    ]);

    expect(patched.content).toHaveLength(1);
    expect(patched.content[0].attrs?.blockId).toBe("b_keep");
  });

  it("does not re-derive create entries when both snapshots carry acked blockIds", () => {
    const pending: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_new" },
          content: [{ type: "text", text: "hello" }],
        },
      ],
    };
    const acked = applyServerAck(pending, [
      { clientId: "c_new", blockId: "b_new", sortKey: SK_SERVER_CREATE },
    ]);
    const entries = deriveSyncEntries(acked, acked);
    expect(entries.some((entry) => entry.opType === "create")).toBe(false);
  });
});

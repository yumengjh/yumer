import { describe, expect, it } from "vitest";
import { applyCreateAck, applyServerAck, deriveSyncEntries } from "../engine";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("deriveSyncEntries order handling", () => {
  it("creates a non-colliding sortKey when inserting between existing blocks", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" },
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_x" },
          content: [{ type: "text", text: "inserted" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" },
        },
      ],
    };

    const entries = deriveSyncEntries(previous, next);
    const create = entries.find((entry) => entry.clientId === "c_x");

    expect(create?.opType).toBe("create");
    expect(create?.sortKey).toBe("001500");
  });

  it("does not move unchanged existing blocks when inserting into a document with duplicated sortKeys", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" },
          content: [{ type: "text", text: "A" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: "001000" },
          content: [{ type: "text", text: "B" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_c", blockId: "b_c", sortKey: "002000" },
          content: [{ type: "text", text: "C" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" },
          content: [{ type: "text", text: "A" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_x" },
          content: [{ type: "text", text: "X" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: "001000" },
          content: [{ type: "text", text: "B" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_c", blockId: "b_c", sortKey: "002000" },
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
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" },
          content: [{ type: "text", text: "A" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: "000500" },
          content: [{ type: "text", text: "B" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_c", blockId: "b_c", sortKey: "002000" },
          content: [{ type: "text", text: "C" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" },
          content: [{ type: "text", text: "A" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: "000500" },
          content: [{ type: "text", text: "B edited" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_c", blockId: "b_c", sortKey: "002000" },
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
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" },
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" },
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
    expect(creates.map((entry) => entry.sortKey)).toEqual([
      "002000",
      "003000",
      "004000",
    ]);
  });

  it("overrides duplicated inherited sortKeys when creating multiple adjacent blocks", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "000998" },
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "000998" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_new_1", sortKey: "001998" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_new_2", sortKey: "001998" },
          content: [{ type: "text", text: "2" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_new_3", sortKey: "001998" },
        },
      ],
    };

    const creates = deriveSyncEntries(previous, next).filter(
      (entry) => entry.opType === "create",
    );

    expect(creates.map((entry) => entry.sortKey)).toEqual([
      "001998",
      "002998",
      "003998",
    ]);
    expect(new Set(creates.map((entry) => entry.sortKey)).size).toBe(3);
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
            sortKey: "001000",
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
            sortKey: "001000",
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
    expect(creates[0].payload?.attrs?.syncCreateId).toBeUndefined();
    expect(creates[1].payload?.attrs?.syncCreateId).toBeUndefined();
  });

  it("emits move entries when existing blocks change relative order", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" },
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" },
        },
      ],
    };

    const entries = deriveSyncEntries(previous, next);

    expect(
      entries.some(
        (entry) => entry.opType === "move" && entry.blockId === "b_b",
      ),
    ).toBe(true);
  });

  it("emits a move when existing blockId-only code blocks change relative order", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "b_paragraph", sortKey: "027000" },
          content: [{ type: "text", text: "paragraph" }],
        },
        {
          type: "codeBlock",
          attrs: { blockId: "b_code", sortKey: "027500" },
          content: [{ type: "text", text: "code" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { blockId: "b_code", sortKey: "027500" },
          content: [{ type: "text", text: "code" }],
        },
        {
          type: "paragraph",
          attrs: { blockId: "b_paragraph", sortKey: "027000" },
          content: [{ type: "text", text: "paragraph" }],
        },
      ],
    };

    const entries = deriveSyncEntries(previous, next);
    const move = entries.find((entry) => entry.opType === "move");

    expect(move).toMatchObject({
      blockId: "b_code",
      opType: "move",
      sortKey: "001000",
    });
    expect(move?.clientId).toEqual(expect.any(String));
    expect(move?.clientId).not.toBe("b_code");
  });

  it("only emits a move for the dragged block when moving the tail block to the front", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_2", blockId: "b_2", sortKey: "001750" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_3", blockId: "b_3", sortKey: "002750" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_4", blockId: "b_4", sortKey: "003750" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_5", blockId: "b_5", sortKey: "004750" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_6", blockId: "b_6", sortKey: "005750" },
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_6", blockId: "b_6", sortKey: "005750" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_2", blockId: "b_2", sortKey: "001750" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_3", blockId: "b_3", sortKey: "002750" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_4", blockId: "b_4", sortKey: "003750" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_5", blockId: "b_5", sortKey: "004750" },
        },
      ],
    };

    const moves = deriveSyncEntries(previous, next).filter(
      (entry) => entry.opType === "move",
    );

    expect(moves).toEqual([
      {
        clientId: "c_6",
        blockId: "b_6",
        opType: "move",
        sortKey: "001000",
      },
    ]);
  });

  it("keeps the existing clientId when a previously loaded block is edited", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_loaded", blockId: "b_loaded", sortKey: "001000" },
          content: [{ type: "text", text: "before" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "c_loaded", blockId: "b_loaded", sortKey: "001000" },
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
            sortKey: "001000",
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
            sortKey: "000984",
            syncCreateId: "sync-create:c_a",
            clientBatchId: "batch_1",
            "data-sort-key": "000984",
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
            sortKey: "001000",
            syncCreateId: "sync-create:c_new",
            "data-sync-create-id": "sync-create:c_new",
            clientBatchId: "batch_1",
          },
        },
      ],
    };

    const patched = applyCreateAck(doc, [
      { clientId: "c_new", blockId: "b_new", sortKey: "000984" },
    ]);

    expect(patched.content[0].attrs?.blockId).toBe("b_new");
    expect(patched.content[0].attrs?.["data-block-id"]).toBe("b_new");
    expect(patched.content[0].attrs?.sortKey).toBe("000984");
    expect(patched.content[0].attrs?.["data-sort-key"]).toBe("000984");
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
          attrs: { clientId: "c_existing", blockId: "b_existing", sortKey: "002000" },
        },
      ],
    };

    const patched = applyServerAck(doc, [
      { blockId: "b_existing", sortKey: "001500" },
    ]);

    expect(patched.content[0].attrs?.blockId).toBe("b_existing");
    expect(patched.content[0].attrs?.sortKey).toBe("001500");
    expect(patched.content[0].attrs?.["data-sort-key"]).toBe("001500");
  });
});

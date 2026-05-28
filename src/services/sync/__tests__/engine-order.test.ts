import { describe, expect, it } from "vitest";
import { applyCreateAck, deriveSyncEntries } from "../engine";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("deriveSyncEntries order handling", () => {
  it("creates a non-colliding sortKey when inserting between existing blocks", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
        { type: "paragraph", attrs: { clientId: "c_x" }, content: [{ type: "text", text: "inserted" }] },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
      ],
    };

    const entries = deriveSyncEntries(previous, next);
    const create = entries.find((entry) => entry.clientId === "c_x");

    expect(create?.opType).toBe("create");
    expect(create?.sortKey).toBe("001500");
  });

  it("allocates unique sortKeys when multiple top-level blocks are created in sequence", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
        { type: "paragraph", attrs: { clientId: "c_empty_1" } },
        { type: "paragraph", attrs: { clientId: "c_empty_2" } },
        { type: "paragraph", attrs: { clientId: "c_after" }, content: [{ type: "text", text: "after blanks" }] },
      ],
    };

    const creates = deriveSyncEntries(previous, next).filter((entry) => entry.opType === "create");

    expect(creates.map((entry) => entry.clientId)).toEqual(["c_empty_1", "c_empty_2", "c_after"]);
    expect(creates.map((entry) => entry.sortKey)).toEqual(["002000", "003000", "004000"]);
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

    const creates = deriveSyncEntries(previous, next).filter((entry) => entry.opType === "create");

    expect(creates.map((entry) => entry.syncCreateId)).toEqual([
      "sync-create:c_blank",
      "sync-create:c_2",
    ]);
    expect(creates[0].payload?.attrs).toMatchObject({ syncCreateId: "sync-create:c_blank" });
    expect(creates[1].payload?.attrs).toMatchObject({ syncCreateId: "sync-create:c_2" });
  });

  it("emits move entries when existing blocks change relative order", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
      ],
    };

    const entries = deriveSyncEntries(previous, next);

    expect(entries.some((entry) => entry.opType === "move" && entry.blockId === "b_b")).toBe(true);
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
          attrs: { clientId: "c_new", blockId: null, sortKey: "001000" },
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
  });
});

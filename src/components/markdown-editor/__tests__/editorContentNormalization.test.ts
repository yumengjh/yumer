import { describe, expect, it } from "vitest";
import { stripUnsupportedSyncAttrs } from "../editorContentNormalization";

describe("editor content normalization", () => {
  it("strips sync aliases that the TipTap schema does not persist", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            blockId: "server-1",
            "data-block-id": "server-1",
            clientId: "client-1",
            "data-client-id": "client-1",
            sortKey: "001000",
            "data-sort-key": "001000",
            syncCreateId: "sync-create:client-1",
            "data-sync-create-id": "sync-create:client-1",
            clientBatchId: "batch-1",
          },
          content: [{ type: "text", text: "hello" }],
        },
      ],
    };

    expect(stripUnsupportedSyncAttrs(doc)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            blockId: "server-1",
            clientId: "client-1",
            sortKey: "001000",
          },
          content: [{ type: "text", text: "hello" }],
        },
      ],
    });
  });

  it("preserves regular node attrs and returns unchanged values by reference", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: {
            level: 2,
            blockId: "server-1",
            clientId: "client-1",
            sortKey: "001000",
          },
          content: [{ type: "text", text: "Title" }],
        },
      ],
    };

    expect(stripUnsupportedSyncAttrs(doc)).toBe(doc);
  });
});

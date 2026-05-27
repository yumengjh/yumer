import { describe, expect, it } from "vitest";
import { blocksToTiptapJson } from "../tiptap-converter";

describe("blocksToTiptapJson sync metadata", () => {
  it("preserves server sortKey on loaded TipTap nodes", () => {
    const doc = blocksToTiptapJson([
      {
        blockId: "block_a",
        type: "paragraph",
        sortKey: "001000",
        payload: {
          type: "paragraph",
          attrs: { clientId: "client_a" },
          content: [{ type: "text", text: "A" }],
        },
      },
      {
        blockId: "block_b",
        type: "paragraph",
        sortKey: "002000",
        payload: {
          type: "paragraph",
          attrs: { clientId: "client_b" },
          content: [{ type: "text", text: "B" }],
        },
      },
    ]);

    expect(doc.content.map((node) => node.attrs?.sortKey)).toEqual(["001000", "002000"]);
  });
});

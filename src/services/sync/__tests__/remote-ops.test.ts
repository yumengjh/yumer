import { describe, expect, it } from "vitest";
import { applyRemoteOperationsToDoc } from "../remote-ops";
import type { TiptapDoc } from "@/services/tiptap-converter";
import { createSortKeyBetween, SK0, SK1 } from "./test-sort-key";

const SK_MID = createSortKeyBetween(SK0, SK1);
const SK_BEFORE_0 = createSortKeyBetween(null, SK0);

describe("remote sync operations", () => {
  it("applies top-level create update move and delete operations", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_a", clientId: "client_a", sortKey: SK0 },
          content: [{ type: "text", text: "A" }],
        },
        {
          type: "paragraph",
          attrs: { blockId: "block_b", clientId: "client_b", sortKey: SK1 },
          content: [{ type: "text", text: "B" }],
        },
      ],
    };

    const next = applyRemoteOperationsToDoc({
      doc,
      rootBlockId: "root_1",
      operations: [
        {
          type: "create",
          blockId: "block_c",
          clientId: "client_c",
          parentId: "root_1",
          sortKey: SK_MID,
          blockType: "paragraph",
          payload: {
            type: "paragraph",
            attrs: { clientId: "client_c" },
            content: [{ type: "text", text: "C" }],
          },
        },
        {
          type: "update",
          blockId: "block_b",
          payload: {
            type: "paragraph",
            attrs: {},
            content: [{ type: "text", text: "B2" }],
          },
        },
        {
          type: "move",
          blockId: "block_b",
          parentId: "root_1",
          sortKey: SK_BEFORE_0,
        },
        {
          type: "delete",
          blockId: "block_a",
        },
      ],
    });

    expect(next.content.map((node) => node.attrs?.blockId)).toEqual([
      "block_b",
      "block_c",
    ]);
    expect(next.content[0].attrs?.sortKey).toBe(SK_BEFORE_0);
    expect(next.content[0].content?.[0].text).toBe("B2");
    expect(next.content[1].attrs).toMatchObject({
      blockId: "block_c",
      clientId: "client_c",
      sortKey: SK_MID,
    });
  });

  it("rejects nested remote operations in the first version", () => {
    expect(() =>
      applyRemoteOperationsToDoc({
        doc: { type: "doc", content: [] },
        rootBlockId: "root_1",
        operations: [
          {
            type: "create",
            blockId: "block_nested",
            parentId: "block_parent",
            sortKey: SK0,
            blockType: "paragraph",
            payload: { type: "paragraph" },
          },
        ],
      }),
    ).toThrow("REMOTE_NESTED_OPERATION_UNSUPPORTED");
  });
});

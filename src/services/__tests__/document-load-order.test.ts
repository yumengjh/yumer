import { describe, expect, it } from "vitest";
import { flattenBlockTreeInDocumentOrder, type Block } from "../document";

describe("document load order", () => {
  it("keeps each parent's children in local sortKey order without global resorting", () => {
    const root: Block = {
      blockId: "root",
      docId: "doc_1",
      type: "root",
      payload: {},
      sortKey: "0",
      indent: 0,
      collapsed: false,
      children: [
        {
          blockId: "parent_b",
          docId: "doc_1",
          type: "paragraph",
          payload: {},
          sortKey: "002000",
          indent: 0,
          collapsed: false,
          children: [
            { blockId: "child_a", docId: "doc_1", type: "paragraph", payload: {}, sortKey: "001000", indent: 0, collapsed: false },
          ],
        },
        {
          blockId: "parent_a",
          docId: "doc_1",
          type: "paragraph",
          payload: {},
          sortKey: "001000",
          indent: 0,
          collapsed: false,
        },
      ],
    };

    expect(flattenBlockTreeInDocumentOrder(root).map((block) => block.blockId)).toEqual([
      "root",
      "parent_a",
      "parent_b",
      "child_a",
    ]);
  });
});

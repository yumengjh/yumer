import { describe, expect, it } from "vitest";
import { createSortKeyBetween, readTopLevelOrder } from "../order";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("sync order helpers", () => {
  it("creates a sortKey between existing siblings instead of reusing the inserted index", () => {
    expect(createSortKeyBetween("001000", "002000")).toBe("001500");
  });

  it("creates a sortKey before the first sibling", () => {
    expect(createSortKeyBetween(null, "001000")).toBe("000500");
  });

  it("creates a sortKey after the last sibling", () => {
    expect(createSortKeyBetween("003000", null)).toBe("004000");
  });

  it("reads top-level block order by clientId, blockId, and index", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a" } },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b" } },
      ],
    };

    expect(readTopLevelOrder(doc)).toEqual([
      { clientId: "c_a", blockId: "b_a", index: 0 },
      { clientId: "c_b", blockId: "b_b", index: 1 },
    ]);
  });
});

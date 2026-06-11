import { describe, expect, it } from "vitest";
import {
  compareSortKeys,
  createCanonicalSortKey,
  createSortKeyBetween,
  createSortKeysBetween,
  readTopLevelOrder,
} from "../order";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("sync order helpers", () => {
  it("creates a fractional sortKey strictly between siblings", () => {
    const left = createCanonicalSortKey(0);
    const right = createCanonicalSortKey(1);
    const middle = createSortKeyBetween(left, right);
    expect(compareSortKeys(left, middle)).toBeLessThan(0);
    expect(compareSortKeys(middle, right)).toBeLessThan(0);
  });

  it("creates a sortKey before the first sibling", () => {
    const first = createCanonicalSortKey(0);
    const before = createSortKeyBetween(null, first);
    expect(compareSortKeys(before, first)).toBeLessThan(0);
  });

  it("creates a sortKey after the last sibling", () => {
    const last = createCanonicalSortKey(2);
    const after = createSortKeyBetween(last, null);
    expect(compareSortKeys(last, after)).toBeLessThan(0);
  });

  it("allocates multiple strictly increasing keys in a gap", () => {
    const keys = createSortKeysBetween(
      createCanonicalSortKey(0),
      createCanonicalSortKey(3),
      3,
    );
    expect(keys).toHaveLength(3);
    for (let index = 1; index < keys.length; index += 1) {
      expect(compareSortKeys(keys[index - 1], keys[index])).toBeLessThan(0);
    }
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

import { describe, expect, it } from "vitest";
import {
  compareSortKeys,
  createCanonicalSortKey,
  createSortKeyBetween,
} from "@/services/sync/order";
import {
  planExplicitMoveSortKey,
  withExplicitMoveSortKeyAttrs,
} from "./sortKeyReorder";

const K0 = createCanonicalSortKey(0);
const K1 = createCanonicalSortKey(1);
const K2 = createCanonicalSortKey(2);
const K3 = createCanonicalSortKey(3);

function node(sortKey: string | null) {
  return {
    attrs: sortKey ? { sortKey, "data-sort-key": sortKey } : {},
  };
}

describe("explicit block reorder sortKeys", () => {
  it("allocates a new sortKey for the moved tail block when dragging it to the front", () => {
    const planned = planExplicitMoveSortKey(
      [node(K0), node(K1), node(K2)],
      2,
      0,
    );

    expect(planned).not.toBeNull();
    expect(compareSortKeys(planned!, K0)).toBeLessThan(0);
  });

  it("allocates a new sortKey between target neighbors when moving a block down", () => {
    const planned = planExplicitMoveSortKey(
      [node(K0), node(K1), node(K2), node(K3)],
      1,
      3,
    );

    expect(planned).not.toBeNull();
    expect(compareSortKeys(K2, planned!)).toBeLessThan(0);
    expect(compareSortKeys(planned!, K3)).toBeLessThan(0);
  });

  it("returns null for no-op adjacent gaps", () => {
    expect(planExplicitMoveSortKey([node(K0), node(K1)], 0, 0)).toBeNull();
    expect(planExplicitMoveSortKey([node(K0), node(K1)], 0, 1)).toBeNull();
  });

  it("writes both sortKey attrs so local TipTap JSON and DOM metadata stay aligned", () => {
    const movedKey = createSortKeyBetween(K0, K1);
    expect(withExplicitMoveSortKeyAttrs({ blockId: "b_1" }, movedKey)).toEqual({
      blockId: "b_1",
      sortKey: movedKey,
      "data-sort-key": movedKey,
    });
  });
});

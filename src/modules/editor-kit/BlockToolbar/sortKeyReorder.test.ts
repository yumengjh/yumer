import { describe, expect, it } from "vitest";
import {
  planExplicitMoveSortKey,
  withExplicitMoveSortKeyAttrs,
} from "./sortKeyReorder";

function node(sortKey: string | null) {
  return {
    attrs: sortKey ? { sortKey, "data-sort-key": sortKey } : {},
  };
}

describe("explicit block reorder sortKeys", () => {
  it("allocates a new sortKey for the moved tail block when dragging it to the front", () => {
    const planned = planExplicitMoveSortKey(
      [node("001000"), node("002000"), node("003000")],
      2,
      0,
    );

    expect(planned).toBe("000500");
  });

  it("allocates a new sortKey between target neighbors when moving a block down", () => {
    const planned = planExplicitMoveSortKey(
      [node("001000"), node("002000"), node("003000"), node("004000")],
      1,
      3,
    );

    expect(planned).toBe("003500");
  });

  it("returns null for no-op adjacent gaps", () => {
    expect(
      planExplicitMoveSortKey([node("001000"), node("002000")], 0, 0),
    ).toBeNull();
    expect(
      planExplicitMoveSortKey([node("001000"), node("002000")], 0, 1),
    ).toBeNull();
  });

  it("writes both sortKey attrs so local TipTap JSON and DOM metadata stay aligned", () => {
    expect(withExplicitMoveSortKeyAttrs({ blockId: "b_1" }, "000500")).toEqual({
      blockId: "b_1",
      sortKey: "000500",
      "data-sort-key": "000500",
    });
  });
});

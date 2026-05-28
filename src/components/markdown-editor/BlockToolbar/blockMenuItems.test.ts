// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  createBlockMenuItems,
  getHeadingAnchorIdFromBlock,
} from "./blockMenuItems";

function getMenuKeys(items: ReturnType<typeof createBlockMenuItems>): string[] {
  return items
    .flatMap((item) => {
      if (!item || !("key" in item) || typeof item.key !== "string") return [];
      return [item.key];
    });
}

describe("block menu heading anchor actions", () => {
  it("reads heading anchor ids from data-anchor first", () => {
    const heading = document.createElement("h2");
    heading.dataset.anchor = "AnchorAb";
    heading.id = "ignored";

    expect(getHeadingAnchorIdFromBlock(heading)).toBe("AnchorAb");
  });

  it("ignores non-heading blocks for anchor link actions", () => {
    const paragraph = document.createElement("p");
    paragraph.dataset.anchor = "AnchorAb";

    expect(getHeadingAnchorIdFromBlock(paragraph)).toBeNull();
    expect(
      getMenuKeys(
        createBlockMenuItems({
          canMoveUp: true,
          canMoveDown: true,
          headingAnchorId: getHeadingAnchorIdFromBlock(paragraph),
        }),
      ),
    ).not.toContain("copyAnchorLink");
  });

  it("adds the copy anchor action for heading blocks only", () => {
    const heading = document.createElement("h3");
    heading.id = "AnchorAb";

    expect(
      getMenuKeys(
        createBlockMenuItems({
          canMoveUp: true,
          canMoveDown: true,
          headingAnchorId: getHeadingAnchorIdFromBlock(heading),
        }),
      ),
    ).toContain("copyAnchorLink");
  });
});

import { describe, expect, it } from "vitest";
import {
  BLOCK_INSERT_MENU_ITEMS,
  getBlockInsertMenuKeys,
} from "./blockInsertMenuItems";

describe("block insert menu items", () => {
  it("offers block-level insert actions in a stable order", () => {
    expect(getBlockInsertMenuKeys(BLOCK_INSERT_MENU_ITEMS)).toEqual([
      "paragraph",
      "heading1",
      "heading2",
      "heading3",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "divider",
      "table",
    ]);
  });
});

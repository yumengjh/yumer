// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  loadRecentBlockInsertItems,
  pushRecentBlockInsertItem,
  removeRecentBlockInsertItem,
  saveRecentBlockInsertItems,
} from "./blockInsertRecent";

describe("block insert recent items", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("deduplicates and caps recent items", () => {
    saveRecentBlockInsertItems(["paragraph", "heading1", "table", "image", "codeBlock", "bulletList"]);

    pushRecentBlockInsertItem("heading1");
    pushRecentBlockInsertItem("orderedList");

    expect(loadRecentBlockInsertItems()).toEqual([
      "orderedList",
      "heading1",
      "paragraph",
      "table",
      "image",
      "codeBlock",
    ]);
  });

  it("removes a recent item by id", () => {
    saveRecentBlockInsertItems(["paragraph", "image", "table"]);
    removeRecentBlockInsertItem("image");
    expect(loadRecentBlockInsertItems()).toEqual(["paragraph", "table"]);
  });
});

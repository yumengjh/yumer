import { describe, expect, it } from "vitest";
import type { LocalSnapshotBlockChange } from "@/services/local-snapshot-compare";
import {
  buildLocalSnapshotDiffEntries,
  DEFAULT_VISIBLE_DIFF_CATEGORIES,
  filterLocalSnapshotDiffEntries,
} from "@/services/local-snapshot-diff-explorer";

const modifiedChange = (
  beforeAttrs: Record<string, unknown>,
  afterAttrs: Record<string, unknown>,
  beforeText = "old text",
  afterText = "new text",
): LocalSnapshotBlockChange => ({
  kind: "modified",
  blockKey: "block-a",
  label: `paragraph: ${afterText}`,
  beforeIndex: 0,
  afterIndex: 0,
  before: {
    type: "paragraph",
    attrs: { clientId: "block-a", ...beforeAttrs },
    content: [{ type: "text", text: beforeText }],
  },
  after: {
    type: "paragraph",
    attrs: { clientId: "block-a", ...afterAttrs },
    content: [{ type: "text", text: afterText }],
  },
});

describe("local snapshot diff explorer", () => {
  it("classifies content, sortKey, style, and auto generated metadata changes", () => {
    const entries = buildLocalSnapshotDiffEntries([
      modifiedChange({ sortKey: "001000" }, { sortKey: "002000" }, "same", "same"),
      modifiedChange({ textAlign: "left" }, { textAlign: "center" }, "same", "same"),
      modifiedChange({}, {}, "hello", "hello world"),
      modifiedChange({ syncCreateId: "tmp" }, { syncCreateId: "srv" }, "same", "same"),
      modifiedChange({ "data-block-id": "b_1" }, { "data-block-id": "b_2" }, "same", "same"),
    ]);

    expect(entries.map((entry) => Array.from(entry.categories))).toEqual([
      ["sort"],
      ["style"],
      ["content"],
      ["auto-meta"],
      ["auto-meta"],
    ]);
  });

  it("hides auto generated metadata by default but keeps it searchable when enabled", () => {
    const entries = buildLocalSnapshotDiffEntries([
      modifiedChange({ syncCreateId: "tmp" }, { syncCreateId: "srv" }, "same", "same"),
      modifiedChange({ sortKey: "001000" }, { sortKey: "002000" }, "same", "same"),
    ]);

    const visible = filterLocalSnapshotDiffEntries(entries, {
      query: "",
      visibleCategories: DEFAULT_VISIBLE_DIFF_CATEGORIES,
    });
    expect(visible.map((entry) => entry.categories.has("sort"))).toEqual([true]);

    const searched = filterLocalSnapshotDiffEntries(entries, {
      query: "syncCreateId",
      visibleCategories: new Set([...DEFAULT_VISIBLE_DIFF_CATEGORIES, "auto-meta"]),
    });
    expect(searched).toHaveLength(1);
    expect(searched[0].categories.has("auto-meta")).toBe(true);
  });
});

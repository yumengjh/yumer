import { describe, expect, it } from "vitest";
import { buildJsonStructureDiff } from "@/services/json-structure-diff";

describe("json structure diff", () => {
  it("emits git-style hunks for changed, added, and deleted JSON paths", () => {
    const before = {
      type: "paragraph",
      attrs: { clientId: "a", sortKey: "001000" },
      content: [{ type: "text", text: "old text" }],
      marks: [{ type: "bold" }],
    };
    const after = {
      type: "paragraph",
      attrs: { clientId: "a", sortKey: "001500" },
      content: [{ type: "text", text: "new text" }],
      extra: true,
    };

    const diff = buildJsonStructureDiff(before, after, { ignoredKeys: new Set(["sortKey"]) });

    expect(diff.truncated).toBe(false);
    expect(diff.hunks.map((hunk) => hunk.path)).toEqual(["content[0].text", "extra", "marks"]);
    expect(diff.hunks[0].lines).toEqual([
      { kind: "removed", text: '"old text"' },
      { kind: "added", text: '"new text"' },
    ]);
    expect(diff.hunks[1].lines).toEqual([{ kind: "added", text: "true" }]);
    expect(diff.hunks[2].lines).toEqual([{ kind: "removed", text: '[{"type":"bold"}]' }]);
  });

  it("limits large JSON diffs without walking forever", () => {
    const before = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`k${index}`, index]));
    const after = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`k${index}`, index + 1]));

    const diff = buildJsonStructureDiff(before, after, { maxHunks: 3 });

    expect(diff.hunks).toHaveLength(3);
    expect(diff.truncated).toBe(true);
    expect(diff.totalChanges).toBeGreaterThan(3);
  });
});

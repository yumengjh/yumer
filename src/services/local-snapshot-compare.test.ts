import { describe, expect, it } from "vitest";
import type { TiptapDoc } from "@/services/tiptap-converter";
import { compareLocalSnapshotBlocks } from "@/services/local-snapshot-compare";

const paragraph = (clientId: string, text: string, attrs: Record<string, unknown> = {}) => ({
  type: "paragraph",
  attrs: { clientId, ...attrs },
  content: [{ type: "text", text }],
});

const doc = (content: TiptapDoc["content"]): TiptapDoc => ({ type: "doc", content });

describe("local snapshot block compare", () => {
  it("detects added, deleted, modified, and moved top-level blocks by stable identity", () => {
    const before = doc([
      paragraph("a", "unchanged"),
      paragraph("b", "will move"),
      paragraph("c", "old text"),
      paragraph("d", "removed"),
    ]);
    const after = doc([
      paragraph("a", "unchanged"),
      paragraph("c", "new text"),
      paragraph("b", "will move"),
      paragraph("e", "added"),
    ]);

    const result = compareLocalSnapshotBlocks(before, after, { ignoredKeys: new Set() });

    expect(result.summary).toEqual({
      totalBefore: 4,
      totalAfter: 4,
      unchanged: 1,
      added: 1,
      deleted: 1,
      modified: 1,
      moved: 1,
      metadataOnly: 0,
    });
    expect(result.changes.map((change) => [change.kind, change.blockKey])).toEqual([
      ["modified", "c"],
      ["moved", "b"],
      ["added", "e"],
      ["deleted", "d"],
    ]);
  });

  it("separates ignored metadata-only differences from content changes", () => {
    const before = doc([
      paragraph("a", "same", { clientBatchId: "batch_1" }),
      paragraph("b", "old", { clientBatchId: "batch_1" }),
    ]);
    const after = doc([
      paragraph("a", "same", { clientBatchId: "batch_2" }),
      paragraph("b", "new", { clientBatchId: "batch_2" }),
    ]);

    const result = compareLocalSnapshotBlocks(before, after, {
      ignoredKeys: new Set(["clientBatchId"]),
    });

    expect(result.summary.metadataOnly).toBe(1);
    expect(result.summary.modified).toBe(1);
    expect(result.changes.map((change) => change.kind)).toEqual(["metadata-only", "modified"]);
  });
});

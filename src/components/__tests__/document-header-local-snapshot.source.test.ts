import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader local snapshot compare panel", () => {
  it("exposes a block-level one-click compare panel for local snapshot versus current content", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("本地数据快照");
    expect(source).toContain("一键对比");
    expect(source).toContain("header-local-snapshot-compare");
    expect(source).toContain("compareLocalSnapshotBlocks");
    expect(source).toContain("currentDocumentContent");
    expect(source).toContain("buildJsonStructureDiff");
    expect(source).toContain("header-local-snapshot-compare__hunk");
    expect(source).toContain("header-local-snapshot-compare__structured-diff");
    expect(source).toContain("change.kind === \"metadata-only\"");
    expect(source).toContain("new Set<string>()");
    expect(source).toContain("showMetadataChanges");
    expect(source).toContain("visibleSnapshotBlockChanges");
    expect(source).toContain("setShowMetadataChanges");
    expect(source).not.toContain("MAX_FULL_DIFF_LINES");
    expect(source).not.toContain("computeLineDiff");
    expect(source).not.toContain("全文 LCS Diff");
    expect(source).not.toContain("currentDocumentJson");
  });
});

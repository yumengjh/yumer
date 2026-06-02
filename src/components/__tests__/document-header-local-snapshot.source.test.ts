import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader local snapshot compare panel", () => {
  it("exposes a searchable diff explorer for local snapshot versus current content", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("header-local-snapshot-compare");
    expect(source).toContain("compareLocalSnapshotBlocks");
    expect(source).toContain("currentDocumentContent");
    expect(source).toContain("buildLocalSnapshotDiffEntries");
    expect(source).toContain("filterLocalSnapshotDiffEntries");
    expect(source).toContain("diffQuery");
    expect(source).toContain("visibleDiffCategories");
    expect(source).toContain("header-local-snapshot-compare__hunk");
    expect(source).toContain("copyLocalSnapshotCompactJson");
    expect(source).toContain("copyCurrentDocumentCompactJson");
    expect(source).toContain("copyCombinedCompactJson");
    expect(source).toContain("copyJsonWithSyncDebugRecords");
    expect(source).toContain("currentDocumentSyncDebugRecordsJson");
    expect(source).toContain("buildCurrentDocumentSyncDebugPayload");
    expect(source).toContain("SyncDebugLog.getAll");
    expect(source).toContain("requestBody");
    expect(source).toContain("responseBody");
    expect(source).toContain("localSnapshotCompactJson");
    expect(source).toContain("currentDocumentCompactJson");
    expect(source).toContain("combinedCompactJson");
    expect(source).toContain("header-local-snapshot-compare__raw-actions");
    expect(source).not.toContain("MAX_FULL_DIFF_LINES");
    expect(source).not.toContain("computeLineDiff");
    expect(source).not.toContain("currentDocumentJson");
  });
});

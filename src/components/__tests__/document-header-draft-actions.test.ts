import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader draft actions", () => {
  it("shows a discard draft control for any discardable draft state", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("onDiscardDraft");
    expect(source).toContain("hasDiscardableDraft");
    expect(source).toContain("currentDraftMeta?.exists === true");
    expect(source).toContain("hasUnsavedChanges");
    expect(source).toContain("showDiscardDraft");
    expect(source).toContain("DeleteOutlined");
  });
});

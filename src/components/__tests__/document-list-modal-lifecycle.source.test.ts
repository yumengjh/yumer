import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentListModal lifecycle controls", () => {
  it("exposes trash and restore actions with a dedicated trash view", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentListModal.tsx"),
      "utf8",
    );

    expect(source).toContain("Segmented");
    expect(source).toContain("listDocuments");
    expect(source).toContain('status: "deleted"');
    expect(source).toContain("restoreDoc");
    expect(source).toContain("permanentlyDeleteDoc");
    expect(source).toContain("handleRestore");
    expect(source).toContain("handlePermanentDelete");
    expect(source).toContain("trashDaysRemaining");
    expect(source).toContain("doc-list__items--trash-grid");
    expect(source).toContain("doc-list__item-deadline");
    expect(source).toContain("移至回收站");
    expect(source).toContain("回收站");
    expect(source).toContain("UndoOutlined");
    expect(source).toContain("DocumentViewMode");
  });
});

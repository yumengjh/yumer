import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentTrashDrawer", () => {
  it("renders a compact top drawer trash page with restore and permanent delete actions", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentTrashDrawer.tsx"),
      "utf8",
    );

    expect(source).toContain("Drawer");
    expect(source).toContain('placement="top"');
    expect(source).toContain('height="86vh"');
    expect(source).toContain("listDocuments");
    expect(source).toContain('status: "deleted"');
    expect(source).toContain("restoreDoc");
    expect(source).toContain("permanentlyDeleteDoc");
    expect(source).toContain("handleRestore");
    expect(source).toContain("handlePermanentDelete");
    expect(source).toContain("trashDaysRemaining");
    expect(source).toContain("document-trash-drawer__grid");
    expect(source).toContain("Popconfirm");
    expect(source).toContain("DeleteOutlined");
    expect(source).toContain("ReloadOutlined");
    expect(source).toContain("UndoOutlined");
  });
});

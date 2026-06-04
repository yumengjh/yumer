import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("BlockInsertPanel structure", () => {
  it("contains the panel sections requested by product design", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/editor-kit/BlockToolbar/BlockInsertPanel.tsx"),
      "utf8",
    );

    expect(source).toContain("最近使用");
    expect(source).toContain("常用语法");
    expect(source).toContain("图片");
    expect(source).toContain("表格");
    expect(source).toContain("H4");
    expect(source).toContain("H5");
    expect(source).toContain("H6");
    expect(source).toContain("LinkOutlined");
    expect(source).toContain("TablePicker");
    expect(source).toContain("loadRecentBlockInsertItems");
    expect(source).toContain("removeRecentBlockInsertItem");
    expect(source).toContain("pushRecentBlockInsertItem");
  });
});

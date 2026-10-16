import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("BlockMenu 语雀块菜单结构", () => {
  it("包含 转换 / 删除 复制 剪切 / 缩进 / 在下方添加，并复用插入面板", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/editor-kit/BlockToolbar/BlockMenu.tsx"),
      "utf8",
    );

    expect(source).toContain("BlockInsertPanel");
    for (const label of ["转换", "删除", "复制", "剪切", "缩进", "在下方添加"]) {
      expect(source).toContain(`label: '${label}'`);
    }
  });
});

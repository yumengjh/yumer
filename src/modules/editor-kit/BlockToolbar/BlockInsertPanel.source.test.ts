import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INSERT_CARD_GROUPS, searchInsertCards } from "./BlockInsertPanel";

describe("BlockInsertPanel 语雀插入面板", () => {
  it("按语雀分组：基础两列卡片 + 普通列表", () => {
    expect(INSERT_CARD_GROUPS.map((group) => group.title)).toEqual(["基础", "程序员专区", "布局和样式"]);
    expect(INSERT_CARD_GROUPS[0].layout).toBe("two-column");
    expect(INSERT_CARD_GROUPS[0].items.map((item) => item.id)).toEqual(["image", "table"]);
  });

  it("支持按名称与拼音首字母快捷键搜索", () => {
    expect(searchInsertCards("代码").map((item) => item.id)).toEqual(["codeBlock"]);
    expect(searchInsertCards("/glk").map((item) => item.id)).toEqual(["highlightBlock"]);
    expect(searchInsertCards("不存在的功能")).toEqual([]);
  });

  it("包含搜索框、表格尺寸选择器与空结果提示", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/editor-kit/BlockToolbar/BlockInsertPanel.tsx"),
      "utf8",
    );
    expect(source).toContain("请输入要搜索的功能名称");
    expect(source).toContain("TableSizeSelector");
    expect(source).toContain("暂无匹配的搜索结果");
  });
});

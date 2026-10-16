import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = () =>
  fs.readFileSync(path.resolve(process.cwd(), "src/modules/editor-kit/Toolbar/DesktopToolbar.tsx"), "utf8");

describe("DesktopToolbar 语雀工具栏", () => {
  it("按语雀顺序排列控件，并保留代码清理扩展", () => {
    const text = source();
    const order = ["\"insert\"", "\"undo\"", "\"format-painter\"", "\"text-mode\"", "\"font-size\"", "\"more-mark\"", "\"text-color\"", "\"bg-color\"", "\"text-align\"", "\"ordered-list\"", "\"line-height\"", "\"check-list\"", "\"divider\"", "\"code-cleanup\""];
    let last = -1;
    for (const id of order) {
      const index = text.indexOf(`has(${id})`) >= 0 ? text.indexOf(`has(${id})`) : text.indexOf(`id: ${id}`);
      expect(index, id).toBeGreaterThan(last);
      last = index;
    }
    expect(text).toContain("runEditorCleanupAction(tiptap, action)");
  });

  it("宽度不足时把放不下的控件收进「更多」", () => {
    const text = source();
    expect(text).toContain("MORE_WIDTH");
    expect(text).toContain("ResizeObserver");
    expect(text).toContain("data-testid=\"toolbar-more\"");
  });
});

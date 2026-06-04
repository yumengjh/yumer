import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("BlockMenu insert submenu wiring", () => {
  it("renders hoverable insert panel triggers inside the block menu with antd popover", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/editor-kit/BlockToolbar/BlockMenu.tsx"),
      "utf8",
    );

    expect(source).toContain("BlockInsertPanel");
    expect(source).toContain("Popover");
    expect(source).toContain("trigger={[]}");
    expect(source).toContain("arrow={false}");
    expect(source).toContain("placement=\"rightTop\"");
    expect(source).toContain("open={Boolean(activeInsertSide)");
    expect(source).toContain("className: 'block-menu-insert-trigger block-menu-insert-trigger--above'");
    expect(source).toContain("className: 'block-menu-insert-trigger block-menu-insert-trigger--below'");
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentSidebar trash action", () => {
  it("presents deletion as moving to trash", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentSidebar/index.tsx"),
      "utf8",
    );

    expect(source).toContain("移至回收站");
    expect(source).toContain("文档已移至回收站");
    expect(source).toContain("移至回收站失败");
  });
});

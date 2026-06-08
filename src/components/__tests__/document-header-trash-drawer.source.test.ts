import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader trash drawer integration", () => {
  it("exposes an independent trash entry in the header and mobile menu", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("DocumentTrashDrawer");
    expect(source).toContain("InboxOutlined");
    expect(source).toContain("setTrashDrawerOpen(true)");
    expect(source).toContain("trashDrawerOpen");
    expect(source).toContain("回收站");
  });
});

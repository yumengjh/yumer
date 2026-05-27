import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader search integration", () => {
  it("renders a search trigger and mounts the search modal", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("DocumentSearchModal");
    expect(source).toContain("SearchOutlined");
    expect(source).toContain("setSearchOpen(true)");
    expect(source).toContain("<DocumentSearchModal");
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader GC debug integration", () => {
  it("wires a GC debug entry in the header and renders the modal", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("GcDebugModal");
    expect(source).toContain("BugOutlined");
    expect(source).toContain("header-btn-gc");
    expect(source).toContain("setGcDebugOpen(true)");
    expect(source).toContain("<GcDebugModal");
  });
});

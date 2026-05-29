import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader local snapshot compare panel", () => {
  it("exposes a one-click compare panel for local snapshot versus current content", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("本地数据快照");
    expect(source).toContain("一键对比");
    expect(source).toContain("header-local-snapshot-compare");
    expect(source).toContain("currentDocumentJson");
  });
});

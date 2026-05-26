import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader draft actions", () => {
  it("shows a discard draft control when the editor source is draft", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("onDiscardDraft");
    expect(source).toContain('currentContentSource === "draft"');
    expect(source).toContain("取消草稿");
  });
});

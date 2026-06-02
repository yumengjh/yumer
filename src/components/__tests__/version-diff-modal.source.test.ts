import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("VersionDiffModal source", () => {
  it("supports comparing draft against saved revisions inside the existing modal", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/VersionDiffModal.tsx"),
      "utf8",
    );

    expect(source).toContain("getEditContent");
    expect(source).toContain('value: "draft"');
    expect(source).toContain("草稿");
    expect(source).toContain("latestRevisionKey");
    expect(source).toContain('setToKey("draft")');
    expect(source).toContain("选择版本或草稿");
    expect(source).toContain("getVersionDiff(docId, fromRef, toRef)");
    expect(source).toContain("noVisibleDiff");
    expect(source).toContain("没有可见差异");
    expect(source).toContain("revertDocument");
    expect(source).toContain("回退到此版本");
    expect(source).toContain("保存草稿并回退");
    expect(source).toContain("丢弃草稿并回退");
  });
});

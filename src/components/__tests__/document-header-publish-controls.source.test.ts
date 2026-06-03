import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader publish controls", () => {
  it("exposes cancel publish control and wires version modal publish callbacks", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("unpublishDoc");
    expect(source).toContain("handleUnpublish");
    expect(source).toContain("取消发布");
    expect(source).toContain("onPublished={handleVersionPublished}");
    expect(source).toContain("publishedHead={currentDoc.publishedHead ?? 0}");
  });
});

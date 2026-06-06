import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("document sidebar create source", () => {
  it("does not select a document again after createDoc already activates it", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentSidebar/index.tsx"),
      "utf8",
    );

    expect(source).toContain('await createDoc({ title: "无标题文档" });');
    expect(source).toContain('await createDoc({\n        title: "无标题文档",');
    expect(source).not.toContain("onSelect(doc.docId)");
  });
});

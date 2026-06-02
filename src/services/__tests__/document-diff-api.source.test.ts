import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("document diff api source", () => {
  it("builds draft-aware diff queries", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/services/document.ts"),
      "utf8",
    );

    expect(source).toContain('export type DiffRefKind = "revision" | "draft"');
    expect(source).toContain('query.set("fromKind", from.kind)');
    expect(source).toContain('query.set("toKind", to.kind)');
    expect(source).toContain('if (from.kind === "revision" && typeof from.version === "number")');
    expect(source).toContain('if (to.kind === "revision" && typeof to.version === "number")');
    expect(source).toContain('export async function revertDocument(');
    expect(source).toContain('...(draftStrategy ? { draftStrategy } : {})');
  });
});

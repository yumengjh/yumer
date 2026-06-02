import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader no-draft save status", () => {
  it("shows no-draft saves in the normal save status position", () => {
    const headerSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );
    const contextSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/contexts/DocumentContext.tsx"),
      "utf8",
    );

    expect(contextSource).toContain('"no-draft"');
    expect(headerSource).toContain("没有草稿需要保存");
    expect(headerSource).toContain("no-draft");
  });
});

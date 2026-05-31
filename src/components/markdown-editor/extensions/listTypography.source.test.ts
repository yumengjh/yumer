import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("listTypography source contract", () => {
  it("applies typography vars to both listItem and taskItem nodes", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/extensions/listTypography.ts"),
      "utf8",
    );

    expect(source).toContain('"listItem"');
    expect(source).toContain('"taskItem"');
  });
});

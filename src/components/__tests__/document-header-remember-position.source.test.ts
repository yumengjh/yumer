import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader remember position action", () => {
  it("wires a remember-position control into the header actions", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("onRememberPosition");
    expect(source).toContain("PushpinOutlined");
    expect(source).toContain("记住当前位置");
  });
});

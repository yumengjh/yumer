import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DocumentHeader public revalidation controls", () => {
  it("exposes a manual public cache refresh action with session-scoped secret entry", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(source).toContain("ReloadOutlined");
    expect(source).toContain("revalidatePublicDocument");
    expect(source).toContain("PUBLIC_DOC_REVALIDATE_SECRET_KEY");
    expect(source).toContain("sessionStorage.getItem(PUBLIC_DOC_REVALIDATE_SECRET_KEY)");
    expect(source).toContain("sessionStorage.setItem(PUBLIC_DOC_REVALIDATE_SECRET_KEY");
    expect(source).toContain("<Input.Password");
    expect(source).toContain("刷新公开页缓存");
    expect(source).toContain('key: "revalidate"');
  });
});

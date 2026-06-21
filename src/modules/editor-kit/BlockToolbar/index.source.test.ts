import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("BlockToolbar transaction update source guards", () => {
  it("coalesces editor transaction updates through requestAnimationFrame", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/editor-kit/BlockToolbar/index.tsx"),
      "utf8",
    );

    const frameRefAt = source.indexOf("transactionFrameRef");
    const effectAt = source.indexOf("const onUpdate = () =>", frameRefAt);
    const requestFrameAt = source.indexOf("window.requestAnimationFrame", effectAt);
    const subscribeAt = source.indexOf("editor.on('transaction', onUpdate)", effectAt);
    const cancelFrameAt = source.indexOf("window.cancelAnimationFrame", subscribeAt);

    expect(frameRefAt).toBeGreaterThanOrEqual(0);
    expect(effectAt).toBeGreaterThan(frameRefAt);
    expect(requestFrameAt).toBeGreaterThan(effectAt);
    expect(requestFrameAt).toBeLessThan(subscribeAt);
    expect(cancelFrameAt).toBeGreaterThan(subscribeAt);
  });

  it("skips React and layout refreshes while the hovered target remains connected", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/editor-kit/BlockToolbar/index.tsx"),
      "utf8",
    );

    expect(source).toContain("const targetDetached =");
    expect(source).toContain("if (!targetDetached) return;");
    expect(source).not.toContain("updateCount");
  });
});

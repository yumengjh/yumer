import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./FloatingSelectionToolbar.tsx", import.meta.url)),
  "utf8",
);

describe("FloatingSelectionToolbar scheduling", () => {
  it("coalesces events into one frame and avoids duplicate visibility writes", () => {
    expect(source).toContain("if (animationFrameRef.current !== null) return;");
    expect(source).toContain("if (isVisibleRef.current === nextVisible) return;");
    expect(source).toContain("cancelAnimationFrame(animationFrameRef.current)");
  });
});

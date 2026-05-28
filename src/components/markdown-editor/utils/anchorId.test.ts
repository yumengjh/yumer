import { describe, expect, it } from "vitest";
import {
  buildAnchorUrl,
  createHeadingAnchorPatchPlan,
  generateAnchorId,
} from "./anchorId";

describe("anchorId helpers", () => {
  it("generates six-letter anchor ids with the backend alphabet", () => {
    const anchorId = generateAnchorId(() => new Uint8Array([0, 25, 26, 51, 52, 255]));

    expect(anchorId).toBe("AZazAv");
    expect(anchorId).toMatch(/^[A-Za-z]{6}$/);
  });

  it("builds full anchor urls without the legacy h- prefix", () => {
    expect(buildAnchorUrl("https://example.com/doc/abc?latest=1", "AbCdEf")).toBe(
      "https://example.com/doc/abc?latest=1#AbCdEf",
    );
  });

  it("fills missing heading anchors and rewrites duplicates within one document", () => {
    const plan = createHeadingAnchorPatchPlan(
      [
        { pos: 1, anchorId: "AlphaA" },
        { pos: 2, anchorId: null },
        { pos: 3, anchorId: "AlphaA" },
        { pos: 4, anchorId: "BravoB" },
      ],
      (() => {
        const generated = ["BravoB", "CharlieC", "DeltaDd"];
        let index = 0;
        return () => generated[index++] ?? `Fallback${index}`;
      })(),
    );

    expect(plan).toEqual([
      { pos: 2, anchorId: "CharlieC" },
      { pos: 3, anchorId: "DeltaDd" },
    ]);
  });
});

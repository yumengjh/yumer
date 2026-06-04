// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { resolveHeadingElementId, resolveHeadingId } from "./headingId";

describe("heading id resolution", () => {
  it("prefers the persisted anchor id", () => {
    expect(resolveHeadingId({ anchorId: "qEmdXB", fallbackId: "heading-0" })).toBe("qEmdXB");
  });

  it("falls back when the heading has no anchor id", () => {
    expect(resolveHeadingId({ anchorId: null, fallbackId: "heading-0" })).toBe("heading-0");
  });

  it("reads data-anchor before legacy fallback ids on DOM elements", () => {
    const heading = document.createElement("h2");
    heading.setAttribute("data-anchor", "qEmdXB");
    heading.id = "heading-0";

    expect(resolveHeadingElementId(heading, "heading-1")).toBe("qEmdXB");
  });
});

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { shouldRetainHoveredTarget } from "./targetTransition";

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("shouldRetainHoveredTarget", () => {
  it("keeps the current block target when the next target is a descendant block", () => {
    const outer = document.createElement("li");
    const inner = document.createElement("li");
    outer.appendChild(inner);

    outer.getBoundingClientRect = () => makeRect(0, 0, 200, 120);
    inner.getBoundingClientRect = () => makeRect(20, 40, 180, 40);

    expect(
      shouldRetainHoveredTarget(
        { kind: "block", element: outer, anchorElement: outer },
        { kind: "block", element: inner, anchorElement: inner },
      ),
    ).toBe(true);
  });

  it("allows switching to table targets inside the current block", () => {
    const outer = document.createElement("div");
    const tableWrapper = document.createElement("div");
    outer.appendChild(tableWrapper);

    expect(
      shouldRetainHoveredTarget(
        { kind: "block", element: outer, anchorElement: outer },
        {
          kind: "table",
          element: tableWrapper,
          anchorElement: tableWrapper,
          tableElement: document.createElement("table"),
        },
      ),
    ).toBe(false);
  });
});

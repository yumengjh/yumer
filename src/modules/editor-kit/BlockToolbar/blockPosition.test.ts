// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { computeBlockHandlePosition } from "./blockPosition";

function rect(init: Partial<DOMRect>): DOMRect {
  const left = init.left ?? 0;
  const top = init.top ?? 0;
  const width = init.width ?? 0;
  const height = init.height ?? 0;
  return {
    left,
    top,
    width,
    height,
    right: init.right ?? left + width,
    bottom: init.bottom ?? top + height,
    x: init.x ?? left,
    y: init.y ?? top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("computeBlockHandlePosition", () => {
  it("centers the handle on the first visible text line instead of the block top", () => {
    const wrapper = document.createElement("div");
    const block = document.createElement("p");
    const line = document.createElement("span");
    block.append(line);

    wrapper.scrollTop = 20;
    wrapper.scrollLeft = 5;
    wrapper.getBoundingClientRect = () =>
      rect({ left: 100, top: 50, width: 600, height: 400 });
    block.getBoundingClientRect = () =>
      rect({ left: 160, top: 80, width: 400, height: 96 });
    line.getBoundingClientRect = () =>
      rect({ left: 160, top: 112, width: 220, height: 32 });

    const position = computeBlockHandlePosition(block, wrapper, {
      handleHeight: 22,
      handleWidth: 22,
    });

    expect(position.top).toBe(87);
  });
});

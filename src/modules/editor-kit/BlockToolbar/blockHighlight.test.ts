// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { collectBlockToolbarHighlightRects } from "./blockHighlight";

function createTargetRoot() {
  const root = document.createElement("li");
  root.id = "outer";
  root.innerHTML = `
    <p id="outer-paragraph">outer</p>
    <ul>
      <li id="inner">
        <p id="inner-paragraph">inner</p>
      </li>
    </ul>
  `;
  return root;
}

describe("collectBlockToolbarHighlightRects", () => {
  it("collects the target block and its descendant blocks together", () => {
    const root = createTargetRoot();
    root.getBoundingClientRect = () => ({
      top: 10,
      left: 20,
      width: 300,
      height: 160,
      right: 320,
      bottom: 170,
      x: 20,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect);
    const outerParagraph = root.querySelector<HTMLElement>("#outer-paragraph")!;
    const inner = root.querySelector<HTMLElement>("#inner")!;
    const innerParagraph = root.querySelector<HTMLElement>("#inner-paragraph")!;
    outerParagraph.getBoundingClientRect = () => ({
      top: 16,
      left: 28,
      width: 120,
      height: 24,
      right: 148,
      bottom: 40,
      x: 28,
      y: 16,
      toJSON: () => ({}),
    } as DOMRect);
    inner.getBoundingClientRect = () => ({
      top: 50,
      left: 40,
      width: 220,
      height: 42,
      right: 260,
      bottom: 92,
      x: 40,
      y: 50,
      toJSON: () => ({}),
    } as DOMRect);
    innerParagraph.getBoundingClientRect = () => ({
      top: 54,
      left: 52,
      width: 100,
      height: 22,
      right: 152,
      bottom: 76,
      x: 52,
      y: 54,
      toJSON: () => ({}),
    } as DOMRect);
    const wrapper = document.createElement("div");
    wrapper.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const rects = collectBlockToolbarHighlightRects({
      kind: "block",
      element: root,
      anchorElement: root,
    }, wrapper);

    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ top: 10, left: 20, width: 300, height: 160 });
  });

  it("returns an empty list without a target", () => {
    const wrapper = document.createElement("div");
    expect(collectBlockToolbarHighlightRects(null, wrapper)).toEqual([]);
  });
});

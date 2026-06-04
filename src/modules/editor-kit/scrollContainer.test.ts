// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { resolveEditorScrollContainer, resolveEditorViewportTop } from "./scrollContainer";

describe("resolveEditorScrollContainer", () => {
  it("prefers the legacy main-content container when present", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <section class="main-content">
        <div class="editor-root">
          <p data-block-id="block_1">hello</p>
        </div>
      </section>
    `;

    const editorRoot = root.querySelector(".editor-root") as HTMLElement;
    const container = resolveEditorScrollContainer(editorRoot);

    expect(container).toBe(root.querySelector(".main-content"));
  });

  it("falls back to the doc-main-content container used by the current layout", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <main class="doc-main-content">
        <div class="editor-root">
          <p data-block-id="block_1">hello</p>
        </div>
      </main>
    `;

    const editorRoot = root.querySelector(".editor-root") as HTMLElement;
    const container = resolveEditorScrollContainer(editorRoot);

    expect(container).toBe(root.querySelector(".doc-main-content"));
  });

  it("uses the document scrolling element when no dedicated container exists", () => {
    const editorRoot = document.createElement("div");
    document.body.appendChild(editorRoot);

    try {
      const container = resolveEditorScrollContainer(editorRoot);
      expect(container).toBe(document.scrollingElement);
    } finally {
      editorRoot.remove();
    }
  });
});

describe("resolveEditorViewportTop", () => {
  it("returns 0 for the documentElement root scroller instead of its bounding top", () => {
    const original = document.documentElement.getBoundingClientRect;
    document.documentElement.getBoundingClientRect = () =>
      ({
        top: -49,
      } as DOMRect);

    try {
      expect(resolveEditorViewportTop(document.documentElement)).toBe(0);
    } finally {
      document.documentElement.getBoundingClientRect = original;
    }
  });

  it("keeps using the element top for dedicated scroll containers", () => {
    const container = document.createElement("main");
    const original = container.getBoundingClientRect;
    container.getBoundingClientRect = () =>
      ({
        top: 24,
      } as DOMRect);

    try {
      expect(resolveEditorViewportTop(container)).toBe(24);
    } finally {
      container.getBoundingClientRect = original;
    }
  });
});

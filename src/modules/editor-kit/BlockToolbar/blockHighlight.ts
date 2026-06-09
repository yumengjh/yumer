import type { BlockToolbarTarget } from "./blockTarget";

export interface BlockToolbarHighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const BLOCK_HIGHLIGHT_SELECTOR = [
  "blockquote",
  "pre",
  ".highlight-block-view",
  "[data-highlight-block]",
  "table",
  "td",
  "th",
  "li",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
].join(",");

export function collectBlockToolbarHighlightRects(
  target: BlockToolbarTarget | null,
  wrapper: HTMLElement,
): BlockToolbarHighlightRect[] {
  if (!target) return [];

  const wrapperRect = wrapper.getBoundingClientRect();
  const elements = new Set<HTMLElement>();
  elements.add(target.element);

  for (const element of Array.from(target.element.querySelectorAll<HTMLElement>(BLOCK_HIGHLIGHT_SELECTOR))) {
    elements.add(element);
  }

  const rects = Array.from(elements)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top - wrapperRect.top + wrapper.scrollTop,
        left: rect.left - wrapperRect.left + wrapper.scrollLeft,
        right: rect.right - wrapperRect.left + wrapper.scrollLeft,
        bottom: rect.bottom - wrapperRect.top + wrapper.scrollTop,
      };
    })
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);

  if (rects.length === 0) return [];

  const top = Math.min(...rects.map((rect) => rect.top));
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return [{
    top,
    left,
    width: right - left,
    height: bottom - top,
  }];
}

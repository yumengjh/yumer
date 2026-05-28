const EDITOR_SCROLL_CONTAINER_SELECTORS = [
  ".main-content",
  ".doc-main-content",
] as const;

export function resolveEditorScrollContainer(element: HTMLElement): HTMLElement | Element | null {
  for (const selector of EDITOR_SCROLL_CONTAINER_SELECTORS) {
    const container = element.closest<HTMLElement>(selector);
    if (container) {
      return container;
    }
  }

  return element.ownerDocument.scrollingElement;
}

export function resolveEditorViewportTop(scrollContainer: HTMLElement | Element | null): number {
  if (!(scrollContainer instanceof HTMLElement)) {
    return 0;
  }

  const ownerDocument = scrollContainer.ownerDocument;
  if (scrollContainer === ownerDocument.documentElement || scrollContainer === ownerDocument.body) {
    return 0;
  }

  return scrollContainer.getBoundingClientRect().top;
}

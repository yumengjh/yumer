export type BlockToolbarTargetKind = "block" | "table";

export interface BlockToolbarTarget {
  kind: BlockToolbarTargetKind;
  /**
   * DOM node used by the floating handle for positioning and block-level actions.
   * For tables this is the outer .tableWrapper when present, otherwise the table.
   */
  element: HTMLElement;
  /**
   * Stable visual box used for the six-dot handle position.
   * Container blocks keep this on their outer box even when the mouse is over inner text.
   */
  anchorElement: HTMLElement;
  tableElement?: HTMLTableElement;
  tableCellElement?: HTMLTableCellElement;
}

const CONTAINER_BLOCK_SELECTOR = [
  "blockquote",
  "pre",
  ".highlight-block-view",
  "[data-highlight-block]",
].join(",");

const BLOCK_SELECTOR = [
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

function asElement(node: EventTarget | Node | Element | null): Element | null {
  if (!node) return null;
  if (node instanceof Element) return node;
  if (node instanceof Node) return node.parentElement;
  return null;
}

function closestWithin<T extends Element>(
  element: Element,
  selector: string,
  editorDom: HTMLElement,
): T | null {
  const match = element.closest(selector);
  if (!match || match === editorDom || !editorDom.contains(match)) return null;
  return match as T;
}

function getTopLevelChild(element: Element, editorDom: HTMLElement): HTMLElement | null {
  let current: Element | null = element;
  while (current && current.parentElement && current.parentElement !== editorDom) {
    current = current.parentElement;
  }

  if (!current || current === editorDom || !editorDom.contains(current)) return null;
  return current as HTMLElement;
}

function getListItemDepth(item: HTMLElement): number {
  let depth = 0;
  let current = item.parentElement;
  while (current) {
    if (current.tagName === "LI") depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function findListItemByY(editorDom: HTMLElement, clientY: number): HTMLElement | null {
  const candidates = Array.from(editorDom.querySelectorAll<HTMLElement>("li"))
    .map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        item,
        rect,
        depth: getListItemDepth(item),
        height: rect.bottom - rect.top,
      };
    })
    .filter(({ rect, height }) => height > 0 && clientY >= rect.top && clientY <= rect.bottom)
    .sort((a, b) => b.depth - a.depth || a.height - b.height);

  return candidates[0]?.item ?? null;
}

export function getTableElementFromToolbarTarget(
  element: HTMLElement | null,
): HTMLTableElement | null {
  if (!element) return null;
  if (element instanceof HTMLTableElement) return element;
  return element.querySelector("table");
}

export function resolveBlockToolbarTarget(
  node: EventTarget | Node | Element | null,
  editorDom: HTMLElement,
  clientY?: number,
): BlockToolbarTarget | null {
  const element = asElement(node);
  if (!element || !editorDom.contains(element)) return null;

  const tableWrapper = closestWithin<HTMLElement>(element, ".tableWrapper", editorDom);
  const table =
    closestWithin<HTMLTableElement>(element, "table", editorDom) ??
    tableWrapper?.querySelector<HTMLTableElement>("table") ??
    null;
  if (table) {
    const wrapper = tableWrapper ?? closestWithin<HTMLElement>(table, ".tableWrapper", editorDom);
    const cell = closestWithin<HTMLTableCellElement>(element, "td,th", editorDom);
    return {
      kind: "table",
      element: wrapper ?? table,
      anchorElement: wrapper ?? table,
      tableElement: table,
      tableCellElement: cell ?? undefined,
    };
  }

  if (clientY != null) {
    const itemAtY = findListItemByY(editorDom, clientY);
    if (itemAtY) {
      return { kind: "block", element: itemAtY, anchorElement: itemAtY };
    }
  }

  const listContainer = element.matches("ul,ol")
    ? (element as HTMLElement)
    : closestWithin<HTMLElement>(element, "ul,ol", editorDom);
  if (listContainer && clientY != null) {
    const childItem = Array.from(listContainer.children).find((child) => {
      if (!(child instanceof HTMLElement) || child.tagName !== "LI") return false;
      const rect = child.getBoundingClientRect();
      return clientY >= rect.top && clientY <= rect.bottom;
    });

    if (childItem instanceof HTMLElement) {
      return { kind: "block", element: childItem, anchorElement: childItem };
    }
  }

  const listItem = closestWithin<HTMLElement>(
    element,
    'li,li[data-type="taskItem"],li.task-list-item',
    editorDom,
  );
  if (listItem) {
    return { kind: "block", element: listItem, anchorElement: listItem };
  }

  const containerBlock = closestWithin<HTMLElement>(
    element,
    CONTAINER_BLOCK_SELECTOR,
    editorDom,
  );
  if (containerBlock) {
    return { kind: "block", element: containerBlock, anchorElement: containerBlock };
  }

  const block = closestWithin<HTMLElement>(element, BLOCK_SELECTOR, editorDom);
  if (block) {
    return { kind: "block", element: block, anchorElement: block };
  }

  const topLevel = getTopLevelChild(element, editorDom);
  return topLevel ? { kind: "block", element: topLevel, anchorElement: topLevel } : null;
}

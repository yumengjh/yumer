interface BlockHandlePositionOptions {
  handleHeight?: number;
  handleWidth?: number;
  minGap?: number;
}

const DEFAULT_HANDLE_SIZE = 22;
const DEFAULT_MIN_GAP = 4;

const BLOCK_EXTRA_OFFSET: Record<string, number> = {
  LI: 28,
  BLOCKQUOTE: 8,
  PRE: 8,
  DEFAULT: 0,
};

const BLOCK_TYPE_EXTRA_OFFSET: Record<string, number> = {
  taskItem: 32,
  callout: 12,
  codeBlock: 8,
  blockquote: 8,
};

function isUsableRect(rect: DOMRect | ClientRect | null): rect is DOMRect | ClientRect {
  return !!rect && rect.width > 0 && rect.height > 0;
}

function firstRangeRectForText(node: Node): DOMRect | ClientRect | null {
  if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = Array.from(range.getClientRects()).find(isUsableRect) ?? null;
    range.detach();
    return rect;
  }

  for (const child of Array.from(node.childNodes)) {
    const rect = firstRangeRectForText(child);
    if (rect) return rect;
  }

  return null;
}

function firstVisibleChildRect(block: HTMLElement): DOMRect | ClientRect | null {
  for (const child of Array.from(block.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const rect = child.getBoundingClientRect();
    if (isUsableRect(rect)) return rect;
  }
  return null;
}

function getFirstLineRect(block: HTMLElement): DOMRect | ClientRect {
  const textRect = firstRangeRectForText(block);
  if (textRect) return textRect;

  const childRect = firstVisibleChildRect(block);
  if (childRect) return childRect;

  return block.getBoundingClientRect();
}

function getExtraLeftOffset(block: HTMLElement): number {
  const tagExtra = BLOCK_EXTRA_OFFSET[block.tagName] ?? BLOCK_EXTRA_OFFSET.DEFAULT;
  const typeExtra = block.dataset.type
    ? (BLOCK_TYPE_EXTRA_OFFSET[block.dataset.type] ?? 0)
    : 0;
  const taskItemExtra = block.classList.contains("task-list-item")
    ? BLOCK_TYPE_EXTRA_OFFSET.taskItem
    : 0;
  return Math.max(tagExtra, typeExtra, taskItemExtra);
}

export function computeBlockHandlePosition(
  block: HTMLElement,
  wrapper: HTMLElement,
  options: BlockHandlePositionOptions = {},
) {
  const handleHeight = options.handleHeight ?? DEFAULT_HANDLE_SIZE;
  const handleWidth = options.handleWidth ?? DEFAULT_HANDLE_SIZE;
  const minGap = options.minGap ?? DEFAULT_MIN_GAP;

  const wrapperRect = wrapper.getBoundingClientRect();
  const blockRect = block.getBoundingClientRect();
  const lineRect = getFirstLineRect(block);
  const extra = getExtraLeftOffset(block);

  const left = Math.max(
    0,
    blockRect.left - wrapperRect.left + wrapper.scrollLeft - handleWidth - minGap - extra,
  );
  const lineCenterY = lineRect.top + lineRect.height / 2;
  const top = lineCenterY - wrapperRect.top + wrapper.scrollTop - handleHeight / 2;

  return { top, left };
}

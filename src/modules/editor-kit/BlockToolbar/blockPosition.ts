export type PositionKind = 'block' | 'table';

interface BlockHandlePositionOptions {
  handleHeight?: number;
  handleWidth?: number;
  minGap?: number;
  kind?: PositionKind;
}

const DEFAULT_HANDLE_SIZE = 22;
const DEFAULT_MIN_GAP = 4;

/**
 * Extra left offset per HTML tag for blocks that have inner indentation
 * (list items have bullet/number, blockquotes have a left border, etc.)
 */
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

/**
 * Tags / data-types that should always pin the handle to the block's
 * top-left corner (no first-line text detection).
 */
const TOP_ANCHOR_TAGS = new Set(['PRE', 'TABLE', 'BLOCKQUOTE']);
const TOP_ANCHOR_TYPES = new Set(['codeBlock', 'callout', 'tableWrapper']);

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

function shouldUseTopAnchor(block: HTMLElement, kind?: PositionKind): boolean {
  if (kind === 'table') return true;
  if (TOP_ANCHOR_TAGS.has(block.tagName)) return true;
  const dataType = block.dataset.type;
  if (dataType && TOP_ANCHOR_TYPES.has(dataType)) return true;
  // highlight-block containers
  if (block.classList.contains('highlight-block-view') || block.hasAttribute('data-highlight-block')) {
    return true;
  }
  return false;
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
  const extra = getExtraLeftOffset(block);

  // Horizontal: always to the left of the block, accounting for extra offset
  const left = Math.max(
    0,
    blockRect.left - wrapperRect.left + wrapper.scrollLeft - handleWidth - minGap - extra,
  );

  // Vertical: decide strategy based on block type
  let top: number;

  if (shouldUseTopAnchor(block, options.kind)) {
    // Pin to top-left corner of the block
    const topOffset = 4; // small breathing room from the very top edge
    top = blockRect.top - wrapperRect.top + wrapper.scrollTop + topOffset;
  } else {
    // For regular text blocks, align with the first line center
    const lineRect = getFirstLineRect(block);
    const lineCenterY = lineRect.top + lineRect.height / 2;
    top = lineCenterY - wrapperRect.top + wrapper.scrollTop - handleHeight / 2;

    // Clamp: never go above block top, never go below block bottom
    const blockTop = blockRect.top - wrapperRect.top + wrapper.scrollTop;
    const blockBottom = blockRect.bottom - wrapperRect.top + wrapper.scrollTop - handleHeight;
    top = Math.max(blockTop, Math.min(top, blockBottom));
  }

  return { top, left };
}

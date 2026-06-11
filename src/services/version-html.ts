/**
 * Version content to rendered HTML for the history/diff viewer.
 * This reuses the same block rendering path as public document rendering.
 */
import { renderBlockToHtml } from "./generate-block-html";
import type { Block, DiffChange } from "./document";
import { compareSortKeys } from "./sync/fractional-key";

function flattenContentBlocks(tree: Block): Block[] {
  const flat: Block[] = [];

  function walk(block: Block) {
    flat.push(block);
    if (block.children) {
      for (const child of block.children) walk(child);
    }
  }

  walk(tree);

  return flat
    .filter((block) => block.type !== "root")
    .sort((a, b) => compareSortKeys(a.sortKey || "", b.sortKey || ""));
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ensureBlockIdAttribute(html: string, blockId: string): string {
  if (!html.trim() || /\sdata-block-id=/.test(html)) return html;

  return html.replace(
    /^(\s*<[^!\s/][^\s/>]*)([^>]*>)/,
    `$1 data-block-id="${escapeHtmlAttribute(blockId)}"$2`,
  );
}

/** Render a version block tree to HTML with data-block-id retained for diff marks. */
export function versionTreeToHtml(tree: Block): string {
  return versionTreeToBlockHtmls(tree)
    .map((block) => block.html)
    .join("");
}

/**
 * Render a block tree into per-block HTML fragments.
 * Useful when a caller needs to annotate or compare at block granularity.
 */
export function versionTreeToBlockHtmls(
  tree: Block,
): Array<{ blockId: string; html: string }> {
  return flattenContentBlocks(tree)
    .map((block) => {
      const html = ensureBlockIdAttribute(renderBlockToHtml(block), block.blockId);
      return { blockId: block.blockId, html };
    })
    .filter((block) => block.html);
}

function changeTypeToClass(type: DiffChange["type"]): string {
  switch (type) {
    case "added":
      return "diff-block-added";
    case "deleted":
      return "diff-block-deleted";
    case "modified":
      return "diff-block-modified";
    case "moved":
      return "diff-block-moved";
    case "reordered":
      return "diff-block-reordered";
    case "indent-changed":
      return "diff-block-indent-changed";
    default:
      return "";
  }
}

/** Add block-level diff classes to elements carrying data-block-id. */
export function annotateBlockChanges(
  html: string,
  changes: DiffChange[],
): string {
  if (!changes.length) return html;

  const changeMap = new Map<string, DiffChange["type"]>();
  for (const change of changes) {
    changeMap.set(change.blockId, change.type);
  }

  return html.replace(
    /(<[^>]*?)data-block-id="([^"]+)"([^>]*?)>/g,
    (_match, prefix: string, blockId: string, suffix: string) => {
      const cls = changeTypeToClass(changeMap.get(blockId) as DiffChange["type"]);
      const tag = `${prefix}data-block-id="${blockId}"${suffix}>`;
      if (!cls) return tag;

      if (/\sclass=/.test(tag)) {
        return tag.replace(/\sclass=(["'])(.*?)\1/, ` class=$1$2 ${cls}$1`);
      }

      return `${prefix}data-block-id="${blockId}" class="${cls}"${suffix}>`;
    },
  );
}

/**
 * Wrap one block with a change class.
 * Kept for callers that render block-by-block diff views.
 */
export function wrapBlockWithChangeClass(
  html: string,
  blockId: string,
  changes: DiffChange[],
): string {
  const change = changes.find((item) => item.blockId === blockId);
  if (!change) return html;

  const cls = changeTypeToClass(change.type);
  if (!cls) return html;

  return `<div class="${cls}">${html}</div>`;
}

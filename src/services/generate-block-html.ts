/**
 * Server/client block tree to HTML rendering.
 * Keeps legacy payload.html, backend-rendered html, and Tiptap JSON on one path.
 */
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import {
  escapeCodeHtml,
  extractCodeText,
  normalizeCodeBlockAttrs,
} from "@/components/markdown-editor/code/codeBlockOptions";
import { serializationExtensions } from "./tiptap-extensions";
import { type TiptapDoc, type TiptapNode } from "./tiptap-converter";
import { resolveApiUrl } from "./api-client";

interface Block {
  blockId: string;
  type: string;
  payload: Record<string, unknown>;
  html?: string | null;
  sortKey?: string;
  children?: Block[];
}

function rewriteImageSrc(html: string): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi,
    (_match, prefix: string, src: string, suffix: string) => {
      if (/^(https?:|data:|blob:)/i.test(src)) return `${prefix}${src}${suffix}`;
      return `${prefix}${resolveApiUrl(src)}${suffix}`;
    },
  );
}

function renderCodeBlockPlaceholder(block: Block): string {
  const node = block.payload as unknown as TiptapNode;
  const attrs = normalizeCodeBlockAttrs(node.attrs);
  const code = extractCodeText(node);
  const attrJson = escapeCodeHtml(JSON.stringify(attrs));

  return [
    `<div class="code-block-view code-block-placeholder"`,
    ` data-code-block-placeholder="true"`,
    ` data-block-id="${escapeCodeHtml(block.blockId)}"`,
    ` data-language="${escapeCodeHtml(attrs.language)}"`,
    ` data-title="${escapeCodeHtml(attrs.title)}"`,
    ` data-code-block-code="${escapeCodeHtml(code)}"`,
    ` data-code-block-attrs="${attrJson}">`,
    `</div>`,
  ].join("");
}

export function renderBlockToHtml(block: Block): string {
  if (block.type === "codeBlock") return renderCodeBlockPlaceholder(block);

  const blockHtml = typeof block.html === "string" ? block.html : "";
  if (blockHtml.trim()) return rewriteImageSrc(blockHtml);

  const legacyHtml =
    typeof block.payload?.html === "string" ? block.payload.html : "";
  if (legacyHtml.trim()) return rewriteImageSrc(legacyHtml);

  try {
    const node = block.payload as unknown as TiptapNode;
    const doc: TiptapDoc = { type: "doc", content: [node] };
    return rewriteImageSrc(
      renderToHTMLString({
        extensions: serializationExtensions,
        content: doc,
      }),
    );
  } catch (error) {
    console.warn("[generate-block-html] block render failed, skipped:", block.blockId, error);
    return "";
  }
}

/**
 * Render a block tree into HTML fragments.
 */
export function renderBlockTreeToHtml(tree: Block): string {
  const flat: Block[] = [];

  function walk(block: Block) {
    flat.push(block);
    if (block.children) {
      for (const child of block.children) {
        walk(child);
      }
    }
  }

  walk(tree);

  const contentBlocks = flat
    .filter((b) => b.type !== "root")
    .sort((a, b) => (a.sortKey || "").localeCompare(b.sortKey || ""));

  if (contentBlocks.length === 0) return "";

  return contentBlocks.map(renderBlockToHtml).join("");
}

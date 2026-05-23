/**
 * 服务端 Block tree → HTML 渲染
 * 使用 Tiptap 官方静态渲染器，避免运行时依赖 jsdom
 */
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import { serializationExtensions } from "./tiptap-extensions";
import {
  detectPayloadFormat,
  type TiptapDoc,
  type TiptapNode,
} from "./tiptap-converter";

interface Block {
  blockId: string;
  type: string;
  payload: Record<string, unknown>;
  sortKey?: string;
  children?: Block[];
}

/**
 * 从 block tree 生成 HTML，兼容旧格式（payload.html）和新格式（Tiptap JSON）
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

  const isLegacy = contentBlocks.every(
    (b) => detectPayloadFormat(b.payload) === "html",
  );

  if (isLegacy) {
    return contentBlocks
      .map((b) => (b.payload?.html as string) || "")
      .filter(Boolean)
      .join("");
  }

  return contentBlocks
    .map((b) => {
      try {
        const node = b.payload as unknown as TiptapNode;
        const doc: TiptapDoc = { type: "doc", content: [node] };
        return renderToHTMLString({
          extensions: serializationExtensions,
          content: doc,
        });
      } catch (e) {
        console.warn(
          "[generate-block-html] block 渲染失败，已跳过:",
          b.blockId,
          e,
        );
        return "";
      }
    })
    .join("");
}

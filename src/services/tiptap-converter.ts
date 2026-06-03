import { ensureDocumentIdentity, readIdentityFromAttrs } from "./sync/identity";

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface TiptapDoc {
  type: "doc";
  content: TiptapNode[];
}

export interface BlockPayload {
  type: string;
  payload: Record<string, unknown>;
  blockId?: string;
}

export type PayloadFormat = "json" | "html";

function stripTransientSyncAttrs(
  attrs: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!attrs) return attrs;
  const nextAttrs = { ...attrs };
  delete nextAttrs.clientBatchId;
  delete nextAttrs.syncCreateId;
  delete nextAttrs["data-sync-create-id"];
  return nextAttrs;
}

export function detectPayloadFormat(
  payload: Record<string, unknown>,
): PayloadFormat {
  if (payload.html && typeof payload.html === "string") return "html";
  return "json";
}

export function isLegacyDocument(
  blocks: Array<{ type: string; payload: Record<string, unknown> }>,
): boolean {
  const contentBlocks = blocks.filter((b) => b.type !== "root");
  if (contentBlocks.length === 0) return false;
  return contentBlocks.every((b) => detectPayloadFormat(b.payload) === "html");
}

const TIPTAP_TO_BLOCK_TYPE: Record<string, string> = {
  heading: "heading",
  paragraph: "paragraph",
  codeBlock: "codeBlock",
  bulletList: "bulletList",
  orderedList: "orderedList",
  taskList: "taskList",
  blockquote: "blockquote",
  table: "table",
  horizontalRule: "hr",
  highlightBlock: "highlightBlock",
  imageBlock: "imageBlock",
};

const BLOCK_TO_TIPTAP_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(TIPTAP_TO_BLOCK_TYPE).map(([k, v]) => [v, k]),
);
BLOCK_TO_TIPTAP_TYPE.hr = "horizontalRule";

function toBlockType(tiptapType: string): string {
  return TIPTAP_TO_BLOCK_TYPE[tiptapType] || "paragraph";
}

function toTiptapType(blockType: string): string {
  return BLOCK_TO_TIPTAP_TYPE[blockType] || "paragraph";
}

export function tiptapJsonToBlocks(
  doc: TiptapDoc,
  existingBlockIds?: string[],
): BlockPayload[] {
  if (!doc.content) return [];

  return doc.content.map((node, i) => {
    const blockType = toBlockType(node.type);
    const identity = readIdentityFromAttrs(node.attrs);
    const blockId = identity.blockId ?? existingBlockIds?.[i];

    const payload: Record<string, unknown> = { ...node };

    if (blockId) {
      return { blockId, type: blockType, payload };
    }
    return { type: blockType, payload };
  });
}

export function blocksToTiptapJson(
  blocks: Array<{
    blockId: string;
    type: string;
    payload: Record<string, unknown>;
    sortKey?: string;
  }>,
): TiptapDoc {
  const contentBlocks = blocks
    .filter((b) => b.type !== "root")
    .sort((a, b) => (a.sortKey || "").localeCompare(b.sortKey || ""));

  const content: TiptapNode[] = contentBlocks.map((block) => {
    if (block.payload.type && typeof block.payload.type === "string") {
      const payloadNode = block.payload as unknown as TiptapNode;
      const attrs = {
        ...(stripTransientSyncAttrs(payloadNode.attrs) ?? {}),
        blockId: block.blockId,
        ...(block.sortKey ? { sortKey: block.sortKey } : {}),
      };
      return { ...payloadNode, attrs };
    }

    const tiptapType = toTiptapType(block.type);
    return {
      type: tiptapType,
      ...block.payload,
      attrs: {
        ...(stripTransientSyncAttrs(
          (block.payload.attrs as Record<string, unknown> | undefined) || {},
        ) ?? {}),
        blockId: block.blockId,
        ...(block.sortKey ? { sortKey: block.sortKey } : {}),
      },
    } as unknown as TiptapNode;
  });

  return ensureDocumentIdentity({ type: "doc", content });
}

export function extractPlainText(node: TiptapNode): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  return node.content.map(extractPlainText).join("");
}

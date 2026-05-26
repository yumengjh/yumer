import type { BlockIdentity, IdentityDoc, IdentityNode, NodeAttrs } from "./types";

export const BLOCK_IDENTITY_NODE_TYPES = [
  "paragraph",
  "heading",
  "codeBlock",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "horizontalRule",
  "listItem",
  "taskItem",
  "tableCell",
  "tableHeader",
  "highlightBlock",
  "imageBlock",
] as const;

const IDENTITY_BLOCK_NODE_TYPES = new Set<string>(BLOCK_IDENTITY_NODE_TYPES);

function readStringAttr(attrs: NodeAttrs, key: string): string | undefined {
  if (!attrs) return undefined;
  const value = attrs[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `cid_${crypto.randomUUID()}`;
  }
  return `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function readIdentityFromAttrs(attrs: NodeAttrs): BlockIdentity {
  const blockId = readStringAttr(attrs, "blockId") ?? readStringAttr(attrs, "data-block-id");
  const clientId = readStringAttr(attrs, "clientId") ?? readStringAttr(attrs, "data-client-id");
  return { blockId, clientId };
}

export function ensureBlockIdentity(node: IdentityNode): IdentityNode {
  if (!IDENTITY_BLOCK_NODE_TYPES.has(node.type)) {
    return node;
  }

  const identity = readIdentityFromAttrs(node.attrs);
  const attrs = { ...(node.attrs ?? {}) };
  let changed = false;

  if (identity.blockId && attrs.blockId !== identity.blockId) {
    attrs.blockId = identity.blockId;
    changed = true;
  }
  if (identity.clientId) {
    if (attrs.clientId !== identity.clientId) {
      attrs.clientId = identity.clientId;
      changed = true;
    }
  } else {
    attrs.clientId = createClientId();
    changed = true;
  }

  if (!changed) return node;
  return { ...node, attrs };
}

export function ensureDocumentIdentity(doc: IdentityDoc): IdentityDoc {
  if (doc.type !== "doc" || !Array.isArray(doc.content)) return doc;

  const seenClientIds = new Set<string>();
  const seenBlockIds = new Set<string>();
  let changed = false;
  const content = doc.content.map((node) => {
    let nextNode = ensureBlockIdentity(node);

    if (IDENTITY_BLOCK_NODE_TYPES.has(nextNode.type)) {
      const attrs = { ...(nextNode.attrs ?? {}) };
      let nodeChanged = false;

      const clientId = typeof attrs.clientId === "string" ? attrs.clientId : undefined;
      if (clientId) {
        if (seenClientIds.has(clientId)) {
          attrs.clientId = createClientId();
          nodeChanged = true;
        }
        seenClientIds.add(String(attrs.clientId));
      } else {
        const createdClientId = createClientId();
        attrs.clientId = createdClientId;
        seenClientIds.add(createdClientId);
        nodeChanged = true;
      }

      const blockId = typeof attrs.blockId === "string" ? attrs.blockId : undefined;
      if (blockId) {
        if (seenBlockIds.has(blockId)) {
          // 同一文档内 blockId 必须唯一；重复 blockId 的后续块视为新建块
          delete attrs.blockId;
          delete attrs["data-block-id"];
          nodeChanged = true;
        } else {
          seenBlockIds.add(blockId);
          attrs["data-block-id"] = blockId;
        }
      }

      if (nodeChanged) {
        nextNode = { ...nextNode, attrs };
      }
    }

    if (nextNode !== node) {
      changed = true;
    }
    return nextNode;
  });

  if (!changed) return doc;

  return {
    ...doc,
    content,
  };
}

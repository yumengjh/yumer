import type { TiptapDoc, TiptapNode } from "@/services/tiptap-converter";
import { extractPlainText } from "@/services/tiptap-converter";
import { ensureDocumentIdentity, readIdentityFromAttrs } from "./identity";
import { createSortKeyBetween, createSortKeysBetween } from "./order";
import type { SyncEntry } from "./types";

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
};

function toBlockType(tiptapType: string): string {
  return TIPTAP_TO_BLOCK_TYPE[tiptapType] || "paragraph";
}

export function normalizeEditorDoc(doc: TiptapDoc): TiptapDoc {
  const normalized = ensureDocumentIdentity(doc);
  return {
    type: "doc",
    content: Array.isArray(normalized.content)
      ? (normalized.content as TiptapNode[])
      : [],
  };
}

function fallbackSortKey(index: number): string {
  return String((index + 1) * 1000).padStart(6, "0");
}

function getSortKey(node: TiptapNode, fallbackIndex: number): string {
  const attrValue = node.attrs?.sortKey;
  return typeof attrValue === "string" && attrValue.trim() !== ""
    ? attrValue
    : fallbackSortKey(fallbackIndex);
}

function normalizePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePayload(item));
  }
  if (!value || typeof value !== "object") return value;

  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    const next = normalizePayload(raw[key]);
    if (next === undefined) continue;
    out[key] = next;
  }

  if (out.attrs && typeof out.attrs === "object" && !Array.isArray(out.attrs)) {
    const attrs = { ...(out.attrs as Record<string, unknown>) };
    delete attrs.blockId;
    delete attrs.clientId;
    delete attrs.sortKey;
    delete attrs.syncCreateId;
    delete attrs.clientBatchId;
    delete attrs["data-block-id"];
    delete attrs["data-client-id"];
    delete attrs["data-sort-key"];
    delete attrs["data-sync-create-id"];
    out.attrs = attrs;
  }

  return out;
}

function payloadFingerprint(node: TiptapNode): string {
  return JSON.stringify(normalizePayload(node));
}

type IndexedNode = {
  clientId: string;
  blockId: string | null;
  node: TiptapNode;
  index: number;
  sortKey: string;
};

function indexTopLevel(doc: TiptapDoc): Record<string, IndexedNode> {
  const indexed: Record<string, IndexedNode> = {};
  const nodes = Array.isArray(doc.content) ? doc.content : [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const identity = readIdentityFromAttrs(node.attrs);
    if (!identity.clientId) continue;
    indexed[identity.clientId] = {
      clientId: identity.clientId,
      blockId: identity.blockId ?? null,
      node,
      index: i,
      sortKey: getSortKey(node, i),
    };
  }
  return indexed;
}

function sortKeyForPosition(nextNodes: IndexedNode[], index: number): string {
  const previousExisting = [...nextNodes.slice(0, index)]
    .reverse()
    .find((item) => item.blockId || item.sortKey);
  const nextExisting = nextNodes.slice(index + 1).find((item) => item.blockId || item.sortKey);

  return createSortKeyBetween(
    previousExisting?.sortKey ?? null,
    nextExisting?.sortKey ?? null,
  );
}

function createSyncCreateId(clientId: string): string {
  return `sync-create:${clientId}`;
}

function withCreateIdentity(node: TiptapNode, clientId: string): Record<string, unknown> {
  const syncCreateId = createSyncCreateId(clientId);
  return {
    ...node,
    attrs: {
      ...(node.attrs ?? {}),
      clientId,
      syncCreateId,
      "data-sync-create-id": syncCreateId,
      blockId: null,
      "data-block-id": undefined,
    },
  } as Record<string, unknown>;
}

function allocateCreateSortKeys(
  orderedNextNodes: IndexedNode[],
  prevIndexed: Record<string, IndexedNode>,
): Map<string, string> {
  const sortKeys = new Map<string, string>();
  let index = 0;

  while (index < orderedNextNodes.length) {
    const node = orderedNextNodes[index];
    if (prevIndexed[node.clientId]) {
      index += 1;
      continue;
    }

    const runStart = index;
    const run: IndexedNode[] = [];
    while (index < orderedNextNodes.length && !prevIndexed[orderedNextNodes[index].clientId]) {
      run.push(orderedNextNodes[index]);
      index += 1;
    }

    const previousExisting = [...orderedNextNodes.slice(0, runStart)]
      .reverse()
      .find((item) => item.blockId || prevIndexed[item.clientId] || item.sortKey);
    const nextExisting = orderedNextNodes
      .slice(index)
      .find((item) => item.blockId || prevIndexed[item.clientId] || item.sortKey);
    const allocated = createSortKeysBetween(
      previousExisting?.sortKey ?? null,
      nextExisting?.sortKey ?? null,
      run.length,
    );

    run.forEach((item, offset) => {
      sortKeys.set(item.clientId, allocated[offset]);
    });
  }

  return sortKeys;
}

export function deriveSyncEntries(prevDoc: TiptapDoc | null, nextDoc: TiptapDoc): SyncEntry[] {
  const nextIndexed = indexTopLevel(nextDoc);
  const prevIndexed = prevDoc ? indexTopLevel(prevDoc) : {};
  const entries: SyncEntry[] = [];
  const orderedNextNodes = Object.values(nextIndexed).sort((a, b) => a.index - b.index);
  const createSortKeys = allocateCreateSortKeys(orderedNextNodes, prevIndexed);

  for (const nextNode of orderedNextNodes) {
    const prevNode = prevIndexed[nextNode.clientId];
    if (!prevNode) {
      const syncCreateId = createSyncCreateId(nextNode.clientId);
      entries.push({
        clientId: nextNode.clientId,
        blockId: null,
        opType: "create",
        syncCreateId,
        blockType: toBlockType(nextNode.node.type),
        payload: withCreateIdentity(nextNode.node, nextNode.clientId),
        sortKey: createSortKeys.get(nextNode.clientId) ?? sortKeyForPosition(orderedNextNodes, nextNode.index),
      });
      continue;
    }

    const nextSortKey = sortKeyForPosition(orderedNextNodes, nextNode.index);
    if (prevNode.index !== nextNode.index && nextSortKey !== prevNode.sortKey) {
      entries.push({
        clientId: nextNode.clientId,
        blockId: prevNode.blockId,
        opType: "move",
        sortKey: nextSortKey,
      });
    }

    const changedPayload = payloadFingerprint(prevNode.node) !== payloadFingerprint(nextNode.node);
    if (changedPayload) {
      entries.push({
        clientId: nextNode.clientId,
        blockId: prevNode.blockId,
        opType: "update",
        payload: nextNode.node as unknown as Record<string, unknown>,
        plainText: extractPlainText(nextNode.node),
      });
    }
  }

  for (const prevNode of Object.values(prevIndexed)) {
    if (!nextIndexed[prevNode.clientId]) {
      entries.push({
        clientId: prevNode.clientId,
        blockId: prevNode.blockId,
        opType: "delete",
      });
    }
  }

  return entries;
}

export function applyCreateAck(
  doc: TiptapDoc,
  mappings: Array<{ clientId: string; blockId: string; sortKey?: string }>,
): TiptapDoc {
  if (!Array.isArray(doc.content) || mappings.length === 0) return doc;
  const ackByClientId = new Map<string, { blockId: string; sortKey?: string }>();
  for (const item of mappings) {
    ackByClientId.set(item.clientId, { blockId: item.blockId, sortKey: item.sortKey });
  }

  let changed = false;
  const content = doc.content.map((node) => {
    const identity = readIdentityFromAttrs(node.attrs);
    if (!identity.clientId) return node;
    const ack = ackByClientId.get(identity.clientId);
    if (!ack) return node;
    const nextAttrs = { ...(node.attrs ?? {}) };
    let nodeChanged = false;
    if (identity.blockId !== ack.blockId) {
      nextAttrs.blockId = ack.blockId;
      nextAttrs["data-block-id"] = ack.blockId;
      nodeChanged = true;
    }
    if (ack.sortKey && node.attrs?.sortKey !== ack.sortKey) {
      nextAttrs.sortKey = ack.sortKey;
      nextAttrs["data-sort-key"] = ack.sortKey;
      nodeChanged = true;
    }
    if (!nodeChanged) return node;
    changed = true;
    return {
      ...node,
      attrs: nextAttrs,
    };
  });

  return changed ? { ...doc, content } : doc;
}

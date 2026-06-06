import type { TiptapDoc, TiptapNode } from "@/services/tiptap-converter";
import { extractPlainText } from "@/services/tiptap-converter";
import { readIdentityFromAttrs } from "@/services/sync/identity";

export type DraftCheckpointBlock = {
  clientId: string;
  blockId?: string | null;
  syncCreateId?: string | null;
  type: string;
  parentId?: string | null;
  orderKey: string;
  payload: Record<string, unknown>;
  plainText?: string;
};

export type DraftCheckpointRequest = {
  mode: "checkpoint";
  coverage: "full";
  clientCheckpointId: string;
  clientId: string;
  baseVersion: number;
  draftRevision: number;
  sessionId: string;
  sessionEpoch: number;
  contentHash: string;
  generatedAt: number;
  actorId?: string;
  documentClock?: number;
  parentCheckpointId?: string | null;
  rootBlockId: string;
  blocks: DraftCheckpointBlock[];
};

export type DraftCheckpointMapping = {
  clientId: string;
  blockId: string;
  orderKey: string;
  sortKey?: string;
};

export type BuildDraftCheckpointInput = {
  docId: string;
  rootBlockId: string;
  content: TiptapDoc;
  baseVersion: number;
  draftRevision: number;
  sessionId: string;
  sessionEpoch: number;
  clientId: string;
  now?: number;
  clientCheckpointId?: string;
  actorId?: string;
  documentClock?: number;
  parentCheckpointId?: string | null;
};

function createCheckpointId(): string {
  return `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function syncCreateIdFor(clientId: string): string {
  return `sync-create:${clientId}`;
}

function createCanonicalOrderKey(index: number): string {
  return String((index + 1) * 1000).padStart(6, "0");
}

function stripTransientAttrs(node: TiptapNode): Record<string, unknown> {
  const attrs = { ...((node.attrs as Record<string, unknown> | undefined) ?? {}) };
  delete attrs.syncCreateId;
  delete attrs.clientBatchId;
  delete attrs["data-sync-create-id"];
  return { ...node, attrs } as unknown as Record<string, unknown>;
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const encoded = new TextEncoder().encode(value);
    const digest = await subtle.digest("SHA-256", encoded);
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `sha256:${hex}`;
  }

  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `sha256:fallback-${hash.toString(16)}`;
}

export async function buildDraftCheckpoint(
  input: BuildDraftCheckpointInput,
): Promise<DraftCheckpointRequest> {
  const nodes = Array.isArray(input.content.content) ? input.content.content : [];
  const blocks: DraftCheckpointBlock[] = nodes.flatMap((node, index) => {
    const identity = readIdentityFromAttrs(node.attrs);
    const clientId = identity.clientId;
    if (!clientId) return [];

    const orderKey = createCanonicalOrderKey(index);
    const blockId = identity.blockId ?? null;
    const payload = stripTransientAttrs({
      ...node,
      attrs: {
        ...((node.attrs as Record<string, unknown> | undefined) ?? {}),
        clientId,
        blockId,
        sortKey: orderKey,
      },
    });

    return [
      {
        clientId,
        blockId,
        syncCreateId: syncCreateIdFor(clientId),
        type: node.type,
        parentId: input.rootBlockId,
        orderKey,
        payload,
        plainText: extractPlainText(node),
      },
    ];
  });

  const contentHash = await sha256(
    JSON.stringify({ docId: input.docId, rootBlockId: input.rootBlockId, blocks }),
  );

  return {
    mode: "checkpoint",
    coverage: "full",
    clientCheckpointId: input.clientCheckpointId ?? createCheckpointId(),
    clientId: input.clientId,
    baseVersion: input.baseVersion,
    draftRevision: input.draftRevision,
    sessionId: input.sessionId,
    sessionEpoch: input.sessionEpoch,
    contentHash,
    generatedAt: input.now ?? Date.now(),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(typeof input.documentClock === "number"
      ? { documentClock: input.documentClock }
      : {}),
    ...(input.parentCheckpointId !== undefined
      ? { parentCheckpointId: input.parentCheckpointId }
      : {}),
    rootBlockId: input.rootBlockId,
    blocks,
  };
}

export function applyCheckpointAck(
  doc: TiptapDoc,
  mappings: DraftCheckpointMapping[],
): TiptapDoc {
  if (!Array.isArray(doc.content) || mappings.length === 0) return doc;

  const byClientId = new Map(mappings.map((mapping) => [mapping.clientId, mapping]));
  let changed = false;
  const content = doc.content.map((node) => {
    const identity = readIdentityFromAttrs(node.attrs);
    if (!identity.clientId) return node;
    const mapping = byClientId.get(identity.clientId);
    if (!mapping) return node;

    const sortKey = mapping.sortKey ?? mapping.orderKey;
    const attrs: Record<string, unknown> = {
      ...(node.attrs ?? {}),
      blockId: mapping.blockId,
      "data-block-id": mapping.blockId,
      sortKey,
      "data-sort-key": sortKey,
    };
    delete attrs.syncCreateId;
    delete attrs.clientBatchId;
    delete attrs["data-sync-create-id"];
    changed = true;
    return { ...node, attrs };
  });

  return changed ? { ...doc, content } : doc;
}

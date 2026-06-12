import {
  buildBlockDelta,
  canonicalStringify,
  hashPayloadCanonical,
  stripPayloadForSync,
} from "./delta-encoding";

export type SyncBlockBase = {
  ver: number;
  hash: string;
  canonical: string;
};

/** 与编辑器 update 节点同构：顶层带 type，便于 codeBlock 等 attrs 走 canonical 规范化。 */
export function toSyncPayload(input: {
  type: string;
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  if (typeof input.payload.type === "string") {
    return input.payload;
  }
  return {
    ...input.payload,
    type: input.type,
  };
}

export class SyncBaseStore {
  private readonly bases = new Map<string, SyncBlockBase>();
  private readonly forceFullBlockIds = new Set<string>();

  async seedFromPayload(input: {
    blockId: string;
    ver: number;
    payload: Record<string, unknown>;
    hash?: string;
  }): Promise<void> {
    const stripped = stripPayloadForSync(input.payload);
    const canonical = canonicalStringify(stripped);
    this.bases.set(input.blockId, {
      ver: input.ver,
      hash: input.hash ?? (await hashPayloadCanonical(stripped)),
      canonical,
    });
  }

  get(blockId: string): SyncBlockBase | undefined {
    return this.bases.get(blockId);
  }

  async recordAck(input: {
    blockId: string;
    ver: number;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.seedFromPayload(input);
    this.forceFullBlockIds.delete(input.blockId);
  }

  clearBase(blockId: string): void {
    this.bases.delete(blockId);
  }

  forceFullResync(blockId: string): void {
    this.clearBase(blockId);
    this.forceFullBlockIds.add(blockId);
  }

  shouldForceFull(blockId: string): boolean {
    return this.forceFullBlockIds.has(blockId);
  }

  clear(): void {
    this.bases.clear();
    this.forceFullBlockIds.clear();
  }
}

const stores = new Map<string, SyncBaseStore>();

export function getSyncBaseStore(docId: string): SyncBaseStore {
  let store = stores.get(docId);
  if (!store) {
    store = new SyncBaseStore();
    stores.set(docId, store);
  }
  return store;
}

export async function seedSyncBaseStoreFromBlocks(
  docId: string,
  blocks: Array<{
    blockId: string;
    type: string;
    ver?: number;
    hash?: string;
    payload: Record<string, unknown>;
  }>,
): Promise<void> {
  const store = getSyncBaseStore(docId);
  await Promise.all(
    blocks
      .filter((block) => block.blockId && typeof block.ver === "number")
      .map((block) =>
        store.seedFromPayload({
          blockId: block.blockId,
          ver: block.ver!,
          payload: toSyncPayload({ type: block.type, payload: block.payload }),
          hash: block.hash,
        }),
      ),
  );
}

export { buildBlockDelta };

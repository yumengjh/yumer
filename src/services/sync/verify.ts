import type { TiptapDoc, TiptapNode } from "@/services/tiptap-converter";
import { hashPayloadCanonical } from "./delta";
import { compareSortKeys, isValidSortKey } from "./fractional-key";
import { readIdentityFromAttrs } from "./identity";
import { createSortKeysBetween } from "./order";
import type { SyncEntry } from "./types";

export type ServerBlockDigest = {
  blockId: string;
  sortKey: string;
  hash: string;
};

export type VerifyRepairPlan = {
  /** 内容不一致：需要整块 update（全量 payload，不走 delta） */
  updates: SyncEntry[];
  /** 本地节点有 blockId 但服务端草稿中不存在：标记为已删除，交给 diff 按新块重建 */
  missingBlockIds: string[];
  /** 本地节点既无 blockId 也没有待同步 entry：补发 create */
  creates: SyncEntry[];
  /** 服务端存在但本地没有的块 */
  deletes: SyncEntry[];
  /** 顺序不一致：按本地视觉顺序重新分配 sortKey */
  moves: SyncEntry[];
  /** 顺序一致但本地记录的 sortKey 与服务端不同：本地采纳服务端 sortKey */
  sortKeyAdoptions: Array<{ clientId: string; blockId: string; sortKey: string }>;
  mismatchCount: number;
};

function readSortKey(node: TiptapNode): string | null {
  const value = node.attrs?.sortKey ?? node.attrs?.["data-sort-key"];
  return typeof value === "string" && isValidSortKey(value) ? value : null;
}

/**
 * idle 校验：对比本地快照与服务端草稿的块集合、内容摘要和顺序，生成增量修复操作。
 * 只修复差异，不会重写一致的块。
 */
export async function planVerifyRepairs(input: {
  snapshot: TiptapDoc;
  serverBlocks: ServerBlockDigest[];
  pendingEntries: Record<string, SyncEntry>;
}): Promise<VerifyRepairPlan> {
  const plan: VerifyRepairPlan = {
    updates: [],
    missingBlockIds: [],
    creates: [],
    deletes: [],
    moves: [],
    sortKeyAdoptions: [],
    mismatchCount: 0,
  };
  const serverById = new Map(input.serverBlocks.map((block) => [block.blockId, block]));
  const pendingBlockIds = new Set<string>();
  for (const entry of Object.values(input.pendingEntries)) {
    if (entry.blockId) pendingBlockIds.add(entry.blockId);
  }

  const nodes = Array.isArray(input.snapshot.content) ? input.snapshot.content : [];
  const localBlockIds = new Set<string>();
  // 参与顺序比较的块：本地视觉序 + 服务端 sortKey
  const ordered: Array<{ clientId: string; blockId: string; serverSortKey: string }> = [];

  for (const node of nodes) {
    const identity = readIdentityFromAttrs(node.attrs);
    if (!identity.clientId) continue;
    if (!identity.blockId) {
      if (!input.pendingEntries[identity.clientId]) {
        plan.creates.push({
          clientId: identity.clientId,
          blockId: null,
          opType: "create",
          payload: node as unknown as Record<string, unknown>,
        });
        plan.mismatchCount += 1;
      }
      continue;
    }

    localBlockIds.add(identity.blockId);
    if (pendingBlockIds.has(identity.blockId) || input.pendingEntries[identity.clientId]) {
      // 仍有待同步操作的块以队列为准，下一轮再校验
      continue;
    }

    const server = serverById.get(identity.blockId);
    if (!server) {
      plan.missingBlockIds.push(identity.blockId);
      plan.mismatchCount += 1;
      continue;
    }

    const localHash = await hashPayloadCanonical(node);
    if (localHash !== server.hash) {
      plan.updates.push({
        clientId: identity.clientId,
        blockId: identity.blockId,
        opType: "update",
        payload: node as unknown as Record<string, unknown>,
      });
      plan.mismatchCount += 1;
    }
    ordered.push({
      clientId: identity.clientId,
      blockId: identity.blockId,
      serverSortKey: server.sortKey,
    });
    const localSortKey = readSortKey(node);
    if (localSortKey !== server.sortKey) {
      plan.sortKeyAdoptions.push({
        clientId: identity.clientId,
        blockId: identity.blockId,
        sortKey: server.sortKey,
      });
    }
  }

  for (const server of input.serverBlocks) {
    if (localBlockIds.has(server.blockId) || pendingBlockIds.has(server.blockId)) continue;
    plan.deletes.push({
      clientId: `verify-delete:${server.blockId}`,
      blockId: server.blockId,
      opType: "delete",
    });
    plan.mismatchCount += 1;
  }

  // 顺序修复：保留服务端 sortKey 中最长的严格递增子序列，其余块在锚点之间重新分配
  const keys = ordered.map((item) => item.serverSortKey);
  const keep = longestIncreasingKeyIndexes(keys);
  let index = 0;
  let anchorKey: string | null = null;
  while (index < ordered.length) {
    if (keep.has(index)) {
      anchorKey = keys[index];
      index += 1;
      continue;
    }
    const runStart = index;
    while (index < ordered.length && !keep.has(index)) index += 1;
    const nextAnchor = index < ordered.length ? keys[index] : null;
    const allocated = createSortKeysBetween(anchorKey, nextAnchor, index - runStart);
    for (let offset = 0; offset < allocated.length; offset += 1) {
      const item = ordered[runStart + offset];
      plan.moves.push({
        clientId: item.clientId,
        blockId: item.blockId,
        opType: "move",
        sortKey: allocated[offset],
      });
    }
    plan.mismatchCount += index - runStart;
  }

  return plan;
}

function longestIncreasingKeyIndexes(keys: string[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(keys.length).fill(-1);
  for (let index = 0; index < keys.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compareSortKeys(keys[tails[middle]], keys[index]) < 0) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  }
  const result = new Set<number>();
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (cursor >= 0) {
    result.add(cursor);
    cursor = previous[cursor];
  }
  return result;
}

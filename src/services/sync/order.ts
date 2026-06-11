import type { TiptapDoc } from "@/services/tiptap-converter";
import { readIdentityFromAttrs } from "@/services/sync/identity";
import {
  compareSortKeys,
  generateKeyBetween,
  generateNKeysBetween,
  integerToSortKey,
  isValidSortKey,
} from "@/services/sync/fractional-key";

export {
  compareSortKeys,
  integerToSortKey,
  isValidSortKey,
} from "@/services/sync/fractional-key";

export type OrderedBlockRef = {
  clientId: string;
  blockId: string | null;
  index: number;
};

function sanitizeSortKey(value: string | null | undefined): string | null {
  return isValidSortKey(value) ? value : null;
}

/**
 * 生成位于 previous 与 next 之间的 fractional sortKey。
 * 防御性处理：非法 key 视为缺失；previous >= next（corruption）时退化为
 * 「排在 previous 之后」，顺序修复交由 corruption repair 流程。
 */
export function createSortKeyBetween(
  previous: string | null,
  next: string | null,
): string {
  const left = sanitizeSortKey(previous);
  let right = sanitizeSortKey(next);
  if (left != null && right != null && compareSortKeys(left, right) >= 0) {
    right = null;
  }
  return generateKeyBetween(left, right);
}

/** 批量生成 count 个位于 (previous, next) 之间的严格递增 sortKey。 */
export function createSortKeysBetween(
  previous: string | null,
  next: string | null,
  count: number,
): string[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const left = sanitizeSortKey(previous);
  let right = sanitizeSortKey(next);
  if (left != null && right != null && compareSortKeys(left, right) >= 0) {
    right = null;
  }
  return generateNKeysBetween(left, right, count);
}

/** 按位置生成 canonical sortKey（确定性，保序）。 */
export function createCanonicalSortKey(index: number): string {
  return integerToSortKey(index + 1);
}

export function readTopLevelOrder(doc: TiptapDoc): OrderedBlockRef[] {
  const nodes = Array.isArray(doc.content) ? doc.content : [];
  return nodes.flatMap((node, index) => {
    const identity = readIdentityFromAttrs(node.attrs);
    if (!identity.clientId) return [];
    return [{ clientId: identity.clientId, blockId: identity.blockId ?? null, index }];
  });
}

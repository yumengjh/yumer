import { expect } from "vitest";
import {
  compareSortKeys,
  createCanonicalSortKey,
  createSortKeyBetween,
  createSortKeysBetween,
} from "../order";

export { compareSortKeys, createCanonicalSortKey, createSortKeyBetween, createSortKeysBetween };

/** 测试用 canonical fractional key（index 从 0 起） */
export const SK0 = createCanonicalSortKey(0);
export const SK1 = createCanonicalSortKey(1);
export const SK2 = createCanonicalSortKey(2);
export const SK3 = createCanonicalSortKey(3);
export const SK4 = createCanonicalSortKey(4);
/** 空文档首个 create 的 sortKey（generateNKeysBetween(null,null,1)） */
export const SK_EMPTY = createSortKeysBetween(null, null, 1)[0];

export function assertSortKeyBetween(
  key: string | undefined,
  left: string,
  right: string,
): void {
  expect(key).toBeDefined();
  expect(compareSortKeys(left, key!)).toBeLessThan(0);
  expect(compareSortKeys(key!, right)).toBeLessThan(0);
}

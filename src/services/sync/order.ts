import type { TiptapDoc } from "@/services/tiptap-converter";
import { readIdentityFromAttrs } from "@/services/sync/identity";

export type OrderedBlockRef = {
  clientId: string;
  blockId: string | null;
  index: number;
};

function parseSortKey(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSortKey(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(6, "0");
}

export function createSortKeyBetween(previous: string | null, next: string | null): string {
  const previousValue = parseSortKey(previous);
  const nextValue = parseSortKey(next);

  if (previousValue == null && nextValue == null) return "001000";
  if (previousValue == null && nextValue != null) return formatSortKey(nextValue / 2);
  if (previousValue != null && nextValue == null) return formatSortKey(previousValue + 1000);

  const left = previousValue ?? 0;
  const right = nextValue ?? left + 1000;
  if (right - left <= 1) return formatSortKey(left + 1);
  return formatSortKey((left + right) / 2);
}

export function createSortKeysBetween(
  previous: string | null,
  next: string | null,
  count: number,
): string[] {
  if (!Number.isInteger(count) || count <= 0) return [];

  const previousValue = parseSortKey(previous);
  const nextValue = parseSortKey(next);

  if (previousValue == null && nextValue == null) {
    return Array.from({ length: count }, (_, index) => formatSortKey((index + 1) * 1000));
  }

  if (previousValue != null && nextValue == null) {
    return Array.from({ length: count }, (_, index) => formatSortKey(previousValue + (index + 1) * 1000));
  }

  const left = previousValue ?? 0;
  const right = nextValue ?? left + (count + 1) * 1000;
  const gap = right - left;

  if (gap > count) {
    const step = Math.max(1, Math.floor(gap / (count + 1)));
    return Array.from({ length: count }, (_, index) => formatSortKey(left + step * (index + 1)));
  }

  return Array.from({ length: count }, (_, index) => formatSortKey(left + index + 1));
}

export function readTopLevelOrder(doc: TiptapDoc): OrderedBlockRef[] {
  const nodes = Array.isArray(doc.content) ? doc.content : [];
  return nodes.flatMap((node, index) => {
    const identity = readIdentityFromAttrs(node.attrs);
    if (!identity.clientId) return [];
    return [{ clientId: identity.clientId, blockId: identity.blockId ?? null, index }];
  });
}

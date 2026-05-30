import { createSortKeyBetween } from "@/services/sync/order";

export type SortKeyCarrier = {
  attrs?: Record<string, unknown> | null;
};

function readSortKey(node: SortKeyCarrier | null | undefined): string | null {
  const value = node?.attrs?.sortKey ?? node?.attrs?.["data-sort-key"];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function withExplicitMoveSortKeyAttrs(
  attrs: Record<string, unknown> | null | undefined,
  sortKey: string,
): Record<string, unknown> {
  return {
    ...(attrs ?? {}),
    sortKey,
    "data-sort-key": sortKey,
  };
}

export function planExplicitMoveSortKey(
  nodes: SortKeyCarrier[],
  sourceIndex: number,
  targetGapIndex: number,
): string | null {
  if (sourceIndex < 0 || sourceIndex >= nodes.length) return null;
  if (targetGapIndex === sourceIndex || targetGapIndex === sourceIndex + 1) {
    return null;
  }

  const withoutSource = nodes.filter((_, index) => index !== sourceIndex);
  const insertionIndex =
    sourceIndex < targetGapIndex ? targetGapIndex - 1 : targetGapIndex;
  const boundedInsertionIndex = Math.max(
    0,
    Math.min(insertionIndex, withoutSource.length),
  );
  const previousSortKey = readSortKey(withoutSource[boundedInsertionIndex - 1]);
  const nextSortKey = readSortKey(withoutSource[boundedInsertionIndex]);

  return createSortKeyBetween(previousSortKey, nextSortKey);
}

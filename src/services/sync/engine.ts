import type { TiptapDoc, TiptapNode } from "@/services/tiptap-converter";
import { ensureDocumentIdentity, readIdentityFromAttrs } from "./identity";
import {
  compareSortKeys,
  createCanonicalSortKey,
  createSortKeyBetween,
  createSortKeysBetween,
  isValidSortKey,
} from "./order";
import type {
  SortKeyCorruptionReport,
  SyncDiffHint,
  SyncDiffMetrics,
  SyncEntry,
} from "./types";

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
  return createCanonicalSortKey(index);
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

export type IndexedSyncNode = {
  clientId: string;
  matchKey: string;
  blockId: string | null;
  node: TiptapNode;
  index: number;
  sortKey: string;
  payloadFingerprint: string | null;
};

export interface SyncSnapshotIndex {
  doc: TiptapDoc;
  blocks: IndexedSyncNode[];
  byClientId: Map<string, IndexedSyncNode>;
  byBlockId: Map<string, IndexedSyncNode>;
  byMatchKey: Map<string, IndexedSyncNode>;
  orderKey: string;
  sortKeyCorruptionReport: SortKeyCorruptionReport | null;
}

export interface DeriveSyncEntriesOptions {
  previousIndex?: SyncSnapshotIndex | null;
  hint?: SyncDiffHint | null;
  /** batch-ack-rescan 等路径：只同步身份/正文，不在 ACK 当下重推 move */
  suppressMoveDerivation?: boolean;
  /** blockId -> 已被服务端拒绝的 sortKey 集合，避免无限重试 */
  suppressedMoveSortKeys?: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface DeriveSyncEntriesResult {
  entries: SyncEntry[];
  nextIndex: SyncSnapshotIndex;
  normalizedNext: TiptapDoc;
  metrics: SyncDiffMetrics;
}

function getSyncMatchKey(identity: {
  blockId?: string;
  clientId?: string;
}): string | null {
  return identity.blockId ?? identity.clientId ?? null;
}

function indexTopLevel(doc: TiptapDoc): Record<string, IndexedSyncNode> {
  const indexed: Record<string, IndexedSyncNode> = {};
  const nodes = Array.isArray(doc.content) ? doc.content : [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const identity = readIdentityFromAttrs(node.attrs);
    const matchKey = getSyncMatchKey(identity);
    const clientId = identity.clientId ?? null;
    if (!matchKey || !clientId) continue;
    indexed[matchKey] = {
      clientId,
      matchKey,
      blockId: identity.blockId ?? null,
      node,
      index: i,
      sortKey: getSortKey(node, i),
      payloadFingerprint: null,
    };
  }
  return indexed;
}

function createSyncSnapshotIndexFromNormalized(
  doc: TiptapDoc,
  options: { computePayloadFingerprints?: boolean } = {},
): SyncSnapshotIndex {
  const indexed = indexTopLevel(doc);
  const blocks = Object.values(indexed)
    .sort((a, b) => a.index - b.index)
    .map((block) =>
      options.computePayloadFingerprints
        ? { ...block, payloadFingerprint: payloadFingerprint(block.node) }
        : block,
    );
  const byClientId = new Map<string, IndexedSyncNode>();
  const byBlockId = new Map<string, IndexedSyncNode>();
  const byMatchKey = new Map<string, IndexedSyncNode>();

  for (const block of blocks) {
    byClientId.set(block.clientId, block);
    if (block.blockId) {
      byBlockId.set(block.blockId, block);
    }
    byMatchKey.set(block.matchKey, block);
  }

  const report = analyzeSortKeyIntegrity(doc);
  return {
    doc,
    blocks,
    byClientId,
    byBlockId,
    byMatchKey,
    orderKey: blocks.map((block) => block.matchKey).join("|"),
    sortKeyCorruptionReport: hasCorruptedSortKeys(report) ? report : null,
  };
}

export function createSyncSnapshotIndex(
  doc: TiptapDoc,
  options: { computePayloadFingerprints?: boolean } = {},
): SyncSnapshotIndex {
  return createSyncSnapshotIndexFromNormalized(normalizeEditorDoc(doc), options);
}

export function analyzeSortKeyIntegrity(
  doc: TiptapDoc | null,
): SortKeyCorruptionReport {
  const duplicates = new Map<string, string[]>();
  const nonMonotonic: SortKeyCorruptionReport["nonMonotonic"] = [];
  const nodes = Array.isArray(doc?.content) ? doc.content : [];
  let previous: { identityKey: string; sortKey: string } | null = null;

  for (const node of nodes) {
    const identity = readIdentityFromAttrs(node.attrs);
    const identityKey = getSyncMatchKey(identity);
    if (!identityKey) continue;
    const sortKey =
      typeof node.attrs?.sortKey === "string" &&
      node.attrs.sortKey.trim() !== ""
        ? node.attrs.sortKey
        : null;
    if (!sortKey) continue;

    const clients = duplicates.get(sortKey) ?? [];
    clients.push(identityKey);
    duplicates.set(sortKey, clients);

    if (previous && compareSortKeys(previous.sortKey, sortKey) >= 0) {
      nonMonotonic.push({
        previousClientId: previous.identityKey,
        previousSortKey: previous.sortKey,
        clientId: identityKey,
        sortKey,
      });
    }
    previous = { identityKey, sortKey };
  }

  return {
    duplicates: [...duplicates.entries()]
      .filter(([, clientIds]) => clientIds.length > 1)
      .map(([sortKey, clientIds]) => ({ sortKey, clientIds })),
    nonMonotonic,
  };
}

export function hasCorruptedSortKeys(report: SortKeyCorruptionReport): boolean {
  return report.duplicates.length > 0 || report.nonMonotonic.length > 0;
}

export type SortKeyRepair = {
  clientId: string;
  blockId: string | null;
  sortKey: string;
};

/**
 * 主动修复计划：按视觉顺序扫描顶层块，保留首个严格递增的合法 key 序列，
 * 为其余（缺失/非法/重复/乱序）的块在相邻锚点之间重新分配 fractional key。
 */
export function planSortKeyRepairs(doc: TiptapDoc | null): SortKeyRepair[] {
  const nodes = Array.isArray(doc?.content) ? doc.content : [];
  type RepairItem = {
    clientId: string;
    blockId: string | null;
    key: string | null;
  };
  const items: RepairItem[] = [];
  for (const node of nodes) {
    const identity = readIdentityFromAttrs(node.attrs);
    if (!identity.clientId) continue;
    const raw = node.attrs?.sortKey;
    items.push({
      clientId: identity.clientId,
      blockId: identity.blockId ?? null,
      key: isValidSortKey(raw) ? raw : null,
    });
  }

  const needsRepair: boolean[] = new Array(items.length).fill(false);
  const seenKeys = new Set<string>();
  let previousKey: string | null = null;
  for (let index = 0; index < items.length; index += 1) {
    const key = items[index].key;
    const broken =
      key == null ||
      seenKeys.has(key) ||
      (previousKey != null && compareSortKeys(key, previousKey) <= 0);
    needsRepair[index] = broken;
    if (!broken && key != null) {
      seenKeys.add(key);
      previousKey = key;
    }
  }

  if (!needsRepair.some(Boolean)) return [];

  const repairs: SortKeyRepair[] = [];
  let anchorKey: string | null = null;
  let index = 0;
  while (index < items.length) {
    if (!needsRepair[index]) {
      anchorKey = items[index].key;
      index += 1;
      continue;
    }
    const runStart = index;
    while (index < items.length && needsRepair[index]) index += 1;
    const nextAnchorKey = index < items.length ? items[index].key : null;
    const allocated = createSortKeysBetween(
      anchorKey,
      nextAnchorKey,
      index - runStart,
    );
    for (let offset = 0; offset < allocated.length; offset += 1) {
      const item = items[runStart + offset];
      repairs.push({
        clientId: item.clientId,
        blockId: item.blockId,
        sortKey: allocated[offset],
      });
    }
  }

  return repairs;
}

/**
 * 视觉位置变更但 attrs sortKey 仍随节点携带时，按新位置重算 sortKey。
 * 作为 derive 换位检测的二次兜底。
 */
export function planRepositionSortKeyRepairs(
  prevDoc: TiptapDoc,
  nextDoc: TiptapDoc,
): SortKeyRepair[] {
  const prevIndexed = indexTopLevel(normalizeEditorDoc(prevDoc));
  const nextNodes = Object.values(
    indexTopLevel(normalizeEditorDoc(nextDoc)),
  ).sort((left, right) => left.index - right.index);
  const repairs: SortKeyRepair[] = [];

  for (const nextNode of nextNodes) {
    const prevNode = prevIndexed[nextNode.matchKey];
    if (!prevNode?.blockId) continue;
    if (prevNode.index === nextNode.index) continue;
    if (nextNode.sortKey !== prevNode.sortKey) continue;
    if (!isVisuallyNonMonotonicAt(nextNodes, nextNode.index)) continue;

    const desired = sortKeyForPosition(nextNodes, nextNode.index);
    if (nextNode.sortKey !== desired) {
      repairs.push({
        clientId: nextNode.clientId,
        blockId: nextNode.blockId,
        sortKey: desired,
      });
    }
  }

  return repairs;
}

/** 顶层视觉序上 sortKey 是否重复、非单调或缺失。 */
export function hasVisualOrderDrift(doc: TiptapDoc | null): boolean {
  return hasCorruptedSortKeys(analyzeSortKeyIntegrity(doc));
}

function readTopLevelSortKey(node: TiptapNode): string | null {
  const raw = node.attrs?.sortKey ?? node.attrs?.["data-sort-key"];
  return typeof raw === "string" && isValidSortKey(raw) ? raw : null;
}

/** 顶层 doc.content 顺序是否与 sortKey 升序一致（单序源不变量）。 */
export function isTopLevelOrderAlignedWithSortKey(doc: TiptapDoc | null): boolean {
  return !hasVisualOrderDrift(doc);
}

/** 按 sortKey 升序重排顶层块；无 sortKey 的块保持相对顺序并置于末尾。 */
export function reorderTopLevelNodesBySortKey(doc: TiptapDoc): TiptapDoc {
  if (!Array.isArray(doc.content) || doc.content.length <= 1) return doc;

  type IndexedNode = { node: TiptapNode; index: number; sortKey: string | null };
  const indexed: IndexedNode[] = doc.content.map((node, index) => ({
    node,
    index,
    sortKey: readTopLevelSortKey(node),
  }));

  const withKey = indexed.filter((item) => item.sortKey);
  const withoutKey = indexed.filter((item) => !item.sortKey);
  const sortedWithKey = [...withKey].sort((left, right) => {
    const compared = compareSortKeys(left.sortKey!, right.sortKey!);
    return compared !== 0 ? compared : left.index - right.index;
  });
  const reordered = [...sortedWithKey, ...withoutKey].map((item) => item.node);
  const changed = reordered.some((node, index) => node !== doc.content[index]);
  return changed ? { ...doc, content: reordered } : doc;
}

/** sortKey 为权威：若视觉序与 sortKey 不一致则重排 content 数组。 */
export function alignDocToSortKeyOrder(doc: TiptapDoc): TiptapDoc {
  if (isTopLevelOrderAlignedWithSortKey(doc)) return doc;
  return reorderTopLevelNodesBySortKey(doc);
}

/** 按视觉顺序为顶层块分配严格递增 sortKey（视觉序为权威时的 derive 前对齐）。 */
export function alignSortKeysToVisualOrder(doc: TiptapDoc): TiptapDoc {
  const repairs = planSortKeyRepairs(doc);
  return repairs.length > 0 ? applySortKeyRepairs(doc, repairs) : doc;
}

/** 把修复后的 sortKey 写回文档顶层节点 attrs。 */
export function applySortKeyRepairs(
  doc: TiptapDoc,
  repairs: SortKeyRepair[],
): TiptapDoc {
  if (!Array.isArray(doc.content) || repairs.length === 0) return doc;
  const byClientId = new Map(
    repairs.map((repair) => [repair.clientId, repair.sortKey]),
  );
  let changed = false;
  const content = doc.content.map((node) => {
    const identity = readIdentityFromAttrs(node.attrs);
    const sortKey = identity.clientId
      ? byClientId.get(identity.clientId)
      : undefined;
    if (!sortKey || node.attrs?.sortKey === sortKey) return node;
    changed = true;
    return {
      ...node,
      attrs: {
        ...(node.attrs ?? {}),
        sortKey,
        "data-sort-key": sortKey,
      },
    };
  });
  return changed ? { ...doc, content } : doc;
}

function readPersistedSortKey(node: IndexedSyncNode | undefined): string | null {
  if (!node?.blockId) return null;
  const raw = node.node.attrs?.sortKey;
  return typeof raw === "string" && isValidSortKey(raw) ? raw : null;
}

function isVisuallyNonMonotonicAt(
  nodes: IndexedSyncNode[],
  index: number,
): boolean {
  const key = readPersistedSortKey(nodes[index]);
  if (!key) return false;
  const prevKey = index > 0 ? readPersistedSortKey(nodes[index - 1]) : null;
  const nextKey =
    index < nodes.length - 1 ? readPersistedSortKey(nodes[index + 1]) : null;
  if (prevKey && compareSortKeys(prevKey, key) >= 0) {
    return true;
  }
  if (nextKey && compareSortKeys(key, nextKey) >= 0) {
    return true;
  }
  return false;
}

function sortKeyForPosition(nextNodes: IndexedSyncNode[], index: number): string {
  const previousExisting = [...nextNodes.slice(0, index)]
    .reverse()
    .find((item) => item.blockId || item.sortKey);
  const nextExisting = nextNodes
    .slice(index + 1)
    .find((item) => item.blockId || item.sortKey);

  return createSortKeyBetween(
    previousExisting?.sortKey ?? null,
    nextExisting?.sortKey ?? null,
  );
}

function createSyncCreateId(clientId: string): string {
  return `sync-create:${clientId}`;
}

function longestIncreasingSubsequence(values: number[]): number[] {
  if (values.length === 0) return [];

  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    let left = 0;
    let right = tails.length;

    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (values[tails[middle]] < value) {
        left = middle + 1;
      } else {
        right = middle;
      }
    }

    if (left > 0) {
      previous[index] = tails[left - 1];
    }

    tails[left] = index;
  }

  const indices = new Array<number>(tails.length);
  let cursor = tails[tails.length - 1];
  for (let index = tails.length - 1; index >= 0; index -= 1) {
    indices[index] = cursor;
    cursor = previous[cursor];
  }

  return indices;
}

function withCreateIdentity(
  node: TiptapNode,
  clientId: string,
): Record<string, unknown> {
  const nextAttrs: Record<string, unknown> = {
    ...(node.attrs ?? {}),
    clientId,
    blockId: null,
    "data-block-id": undefined,
  };
  delete nextAttrs.syncCreateId;
  delete nextAttrs.clientBatchId;
  delete nextAttrs["data-sync-create-id"];
  return {
    ...node,
    attrs: nextAttrs,
  } as Record<string, unknown>;
}

function allocateCreateSortKeys(
  orderedNextNodes: IndexedSyncNode[],
  prevIndexed: Record<string, IndexedSyncNode>,
): Map<string, string> {
  const sortKeys = new Map<string, string>();
  let index = 0;

  while (index < orderedNextNodes.length) {
    const node = orderedNextNodes[index];
    if (prevIndexed[node.matchKey]?.blockId) {
      index += 1;
      continue;
    }

    const runStart = index;
    const run: IndexedSyncNode[] = [];
    while (
      index < orderedNextNodes.length &&
      !prevIndexed[orderedNextNodes[index].matchKey]?.blockId
    ) {
      run.push(orderedNextNodes[index]);
      index += 1;
    }

    const previousExisting = [...orderedNextNodes.slice(0, runStart)]
      .reverse()
      .find(
        (item) =>
          item.blockId || prevIndexed[item.matchKey]?.blockId || item.sortKey,
      );
    const nextExisting = orderedNextNodes
      .slice(index)
      .find(
        (item) =>
          item.blockId || prevIndexed[item.matchKey]?.blockId || item.sortKey,
      );
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

function planDesiredSortKeys(
  orderedNextNodes: IndexedSyncNode[],
  prevIndexed: Record<string, IndexedSyncNode>,
): Map<string, string> {
  const desiredSortKeys = new Map<string, string>();
  const existingNodes = orderedNextNodes.filter((node) =>
    Boolean(prevIndexed[node.matchKey]?.blockId),
  );
  const existingKeys = existingNodes.map(
    (node) => prevIndexed[node.matchKey].sortKey,
  );
  // LIS 需要数值输入：把字符串 key 映射为排序后的 rank（重复 key 同 rank）。
  const rankByKey = new Map<string, number>();
  for (const key of [...existingKeys].sort(compareSortKeys)) {
    if (!rankByKey.has(key)) rankByKey.set(key, rankByKey.size);
  }
  const existingValues = existingKeys.map((key) => rankByKey.get(key) ?? 0);
  const stableAnchorIds = new Set(
    longestIncreasingSubsequence(existingValues).map(
      (index) => existingNodes[index].matchKey,
    ),
  );

  let index = 0;
  while (index < orderedNextNodes.length) {
    const current = orderedNextNodes[index];
    const previousNode = prevIndexed[current.matchKey];

    if (previousNode?.blockId && stableAnchorIds.has(current.matchKey)) {
      desiredSortKeys.set(current.clientId, previousNode.sortKey);
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < orderedNextNodes.length) {
      const candidate = orderedNextNodes[index];
      const candidatePrevious = prevIndexed[candidate.matchKey];
      if (candidatePrevious?.blockId && stableAnchorIds.has(candidate.matchKey)) {
        break;
      }
      index += 1;
    }

    const run = orderedNextNodes.slice(runStart, index);
    const previousDesiredKey =
      runStart > 0
        ? (desiredSortKeys.get(orderedNextNodes[runStart - 1].clientId) ?? null)
        : null;
    const nextAnchorKey =
      index < orderedNextNodes.length
        ? (prevIndexed[orderedNextNodes[index].matchKey]?.sortKey ?? null)
        : null;
    const allocatedKeys = createSortKeysBetween(
      previousDesiredKey,
      nextAnchorKey,
      run.length,
    );

    run.forEach((node, offset) => {
      desiredSortKeys.set(node.clientId, allocatedKeys[offset]);
    });
  }

  return desiredSortKeys;
}

function indexRecordFromSnapshot(
  index: SyncSnapshotIndex | null,
): Record<string, IndexedSyncNode> {
  if (!index) return {};
  const record: Record<string, IndexedSyncNode> = {};
  for (const block of index.blocks) {
    record[block.matchKey] = block;
  }
  return record;
}

function createDiffMetrics(
  mode: SyncDiffMetrics["mode"],
  topLevelCount: number,
  dirtyCandidateCount: number,
): SyncDiffMetrics {
  return {
    mode,
    topLevelCount,
    dirtyCandidateCount,
    fingerprintCount: 0,
    sortPlanRan: false,
    derivedEntryCount: 0,
    durationMs: 0,
  };
}

function hasHintCandidates(hint: SyncDiffHint | null | undefined): boolean {
  return Boolean(
    hint &&
      (hint.structureChanged ||
        hint.identityChanged ||
        hint.changedClientIds.length > 0 ||
        hint.changedBlockIds.length > 0),
  );
}

function collectDirtyMatchKeys(
  hint: SyncDiffHint | null | undefined,
  previousIndex: SyncSnapshotIndex | null,
  nextIndex: SyncSnapshotIndex,
): Set<string> {
  const dirty = new Set<string>();
  if (!hint) return dirty;

  for (const clientId of hint.changedClientIds) {
    const previous = previousIndex?.byClientId.get(clientId);
    const next = nextIndex.byClientId.get(clientId);
    if (previous) dirty.add(previous.matchKey);
    if (next) dirty.add(next.matchKey);
    if (!previous && !next) dirty.add(clientId);
  }

  for (const blockId of hint.changedBlockIds) {
    const previous = previousIndex?.byBlockId.get(blockId);
    const next = nextIndex.byBlockId.get(blockId);
    if (previous) dirty.add(previous.matchKey);
    if (next) dirty.add(next.matchKey);
    if (!previous && !next) dirty.add(blockId);
  }

  return dirty;
}

function computePayloadFingerprint(
  node: TiptapNode,
  metrics: SyncDiffMetrics,
): string {
  metrics.fingerprintCount += 1;
  return payloadFingerprint(node);
}

function getPreviousPayloadFingerprint(
  node: IndexedSyncNode,
  metrics: SyncDiffMetrics,
): string {
  if (node.payloadFingerprint) return node.payloadFingerprint;
  return computePayloadFingerprint(node.node, metrics);
}

function buildFinalNextIndex(input: {
  baseIndex: SyncSnapshotIndex;
  previousIndex: SyncSnapshotIndex | null;
  nextFingerprints: Map<string, string>;
  forceComputeAll: boolean;
  metrics: SyncDiffMetrics;
}): SyncSnapshotIndex {
  const blocks = input.baseIndex.blocks.map((block) => {
    const computed = input.nextFingerprints.get(block.matchKey);
    if (computed) {
      return { ...block, payloadFingerprint: computed };
    }

    const carried =
      input.previousIndex?.byMatchKey.get(block.matchKey)?.payloadFingerprint ??
      null;
    if (carried) {
      return { ...block, payloadFingerprint: carried };
    }

    if (input.forceComputeAll) {
      return {
        ...block,
        payloadFingerprint: computePayloadFingerprint(block.node, input.metrics),
      };
    }

    return block;
  });

  const byClientId = new Map<string, IndexedSyncNode>();
  const byBlockId = new Map<string, IndexedSyncNode>();
  const byMatchKey = new Map<string, IndexedSyncNode>();
  for (const block of blocks) {
    byClientId.set(block.clientId, block);
    if (block.blockId) byBlockId.set(block.blockId, block);
    byMatchKey.set(block.matchKey, block);
  }

  return {
    ...input.baseIndex,
    blocks,
    byClientId,
    byBlockId,
    byMatchKey,
  };
}

function chooseDiffMode(input: {
  hint: SyncDiffHint | null | undefined;
  previousIndex: SyncSnapshotIndex | null;
  nextIndex: SyncSnapshotIndex;
}): SyncDiffMetrics["mode"] {
  if (!input.previousIndex || !hasHintCandidates(input.hint)) {
    return "fallback-full";
  }
  if (input.hint?.identityChanged) {
    return "fallback-full";
  }
  if (input.hint?.structureChanged) {
    return "structure-hint";
  }
  if (input.previousIndex.orderKey !== input.nextIndex.orderKey) {
    return "structure-hint";
  }
  if (
    hasVisualOrderDrift(input.previousIndex.doc) ||
    hasVisualOrderDrift(input.nextIndex.doc)
  ) {
    return "structure-hint";
  }
  return "content-hint";
}

function shouldComparePayload(input: {
  mode: SyncDiffMetrics["mode"];
  dirtyMatchKeys: Set<string>;
  matchKey: string;
}): boolean {
  if (input.mode === "fallback-full") return true;
  return input.dirtyMatchKeys.has(input.matchKey);
}

export function deriveSyncEntriesWithMetrics(
  prevDoc: TiptapDoc | null,
  nextDoc: TiptapDoc,
  options: DeriveSyncEntriesOptions = {},
): DeriveSyncEntriesResult {
  const start = Date.now();
  const normalizedNext = normalizeEditorDoc(nextDoc);
  const normalizedPrev = prevDoc ? normalizeEditorDoc(prevDoc) : null;
  const previousIndex =
    options.previousIndex ??
    (normalizedPrev
      ? createSyncSnapshotIndexFromNormalized(normalizedPrev)
      : null);
  const nextPreviewIndex = createSyncSnapshotIndexFromNormalized(normalizedNext);
  const mode = chooseDiffMode({
    hint: options.hint,
    previousIndex,
    nextIndex: nextPreviewIndex,
  });
  const dirtyMatchKeys = collectDirtyMatchKeys(
    options.hint,
    previousIndex,
    nextPreviewIndex,
  );
  const metrics = createDiffMetrics(
    mode,
    nextPreviewIndex.blocks.length,
    dirtyMatchKeys.size,
  );
  const nextIndexed = indexRecordFromSnapshot(nextPreviewIndex);
  const prevIndexed = indexRecordFromSnapshot(previousIndex);
  const entries: SyncEntry[] = [];
  const orderedNextNodes = nextPreviewIndex.blocks;
  const shouldRunSortPlan = mode !== "content-hint";
  const createSortKeys = shouldRunSortPlan
    ? allocateCreateSortKeys(orderedNextNodes, prevIndexed)
    : new Map<string, string>();
  const previousSortKeysAreCorrupted = hasCorruptedSortKeys(
    analyzeSortKeyIntegrity(normalizedPrev),
  );
  let desiredSortKeys = new Map<string, string>();
  if (shouldRunSortPlan) {
    if (previousSortKeysAreCorrupted) {
      for (const repair of planSortKeyRepairs(normalizedNext)) {
        desiredSortKeys.set(repair.clientId, repair.sortKey);
      }
    } else {
      desiredSortKeys = planDesiredSortKeys(orderedNextNodes, prevIndexed);
    }
  }
  metrics.sortPlanRan = shouldRunSortPlan && desiredSortKeys.size > 0;
  const nextFingerprints = new Map<string, string>();

  for (const nextNode of orderedNextNodes) {
    const prevNode = prevIndexed[nextNode.matchKey];
    if (!prevNode?.blockId) {
      if (mode === "content-hint" && !dirtyMatchKeys.has(nextNode.matchKey)) {
        continue;
      }
      const syncCreateId = createSyncCreateId(nextNode.clientId);
      entries.push({
        clientId: nextNode.clientId,
        blockId: null,
        opType: "create",
        syncCreateId,
        blockType: toBlockType(nextNode.node.type),
        payload: withCreateIdentity(nextNode.node, nextNode.clientId),
        sortKey:
          createSortKeys.get(nextNode.clientId) ??
          desiredSortKeys.get(nextNode.clientId) ??
          prevNode?.sortKey ??
          nextNode.sortKey ??
          sortKeyForPosition(orderedNextNodes, nextNode.index),
      });
      nextFingerprints.set(
        nextNode.matchKey,
        computePayloadFingerprint(nextNode.node, metrics),
      );
      continue;
    }

    let nextSortKey =
      desiredSortKeys.get(nextNode.clientId) ??
      (shouldRunSortPlan
        ? sortKeyForPosition(orderedNextNodes, nextNode.index)
        : prevNode.sortKey);
    // 块已换位且 sortKey 未更新，并在新位置造成视觉非单调时，按位置重算 sortKey。
    if (
      shouldRunSortPlan &&
      prevNode.index !== nextNode.index &&
      nextNode.sortKey === prevNode.sortKey &&
      isVisuallyNonMonotonicAt(orderedNextNodes, nextNode.index)
    ) {
      nextSortKey = sortKeyForPosition(orderedNextNodes, nextNode.index);
    }
    if (
      shouldRunSortPlan &&
      !options.suppressMoveDerivation &&
      nextSortKey !== prevNode.sortKey
    ) {
      const blockId = prevNode.blockId;
      const rejected =
        blockId && options.suppressedMoveSortKeys?.get(blockId);
      if (!rejected?.has(nextSortKey)) {
        entries.push({
          clientId: nextNode.clientId,
          blockId,
          opType: "move",
          sortKey: nextSortKey,
        });
      }
    }

    const shouldCompare = shouldComparePayload({
      mode,
      dirtyMatchKeys,
      matchKey: nextNode.matchKey,
    });
    if (!shouldCompare) continue;

    const nextFingerprint = computePayloadFingerprint(nextNode.node, metrics);
    nextFingerprints.set(nextNode.matchKey, nextFingerprint);
    const changedPayload =
      getPreviousPayloadFingerprint(prevNode, metrics) !== nextFingerprint;
    if (changedPayload) {
      entries.push({
        clientId: nextNode.clientId,
        blockId: prevNode.blockId,
        opType: "update",
        payload: nextNode.node as unknown as Record<string, unknown>,
      });
    }
  }

  if (mode !== "content-hint") {
    for (const prevNode of Object.values(prevIndexed)) {
      if (!nextIndexed[prevNode.matchKey]) {
        entries.push({
          clientId: prevNode.clientId,
          blockId: prevNode.blockId,
          opType: "delete",
        });
      }
    }
  }

  metrics.derivedEntryCount = entries.length;
  const nextIndex = buildFinalNextIndex({
    baseIndex: nextPreviewIndex,
    previousIndex,
    nextFingerprints,
    forceComputeAll: mode === "fallback-full",
    metrics,
  });
  metrics.durationMs = Date.now() - start;

  return {
    entries,
    nextIndex,
    normalizedNext,
    metrics,
  };
}

export function deriveSyncEntries(
  prevDoc: TiptapDoc | null,
  nextDoc: TiptapDoc,
): SyncEntry[] {
  return deriveSyncEntriesWithMetrics(prevDoc, nextDoc).entries;
}

export function applyCreateAck(
  doc: TiptapDoc,
  mappings: Array<{ clientId: string; blockId: string; sortKey?: string }>,
): TiptapDoc {
  return applyServerAck(doc, mappings);
}

export function applyServerAck(
  doc: TiptapDoc,
  mappings: Array<{ clientId?: string; blockId: string; sortKey?: string }>,
): TiptapDoc {
  if (!Array.isArray(doc.content) || mappings.length === 0) return doc;
  const ackByClientId = new Map<
    string,
    { blockId: string; sortKey?: string }
  >();
  const ackByBlockId = new Map<string, { blockId: string; sortKey?: string }>();
  for (const item of mappings) {
    if (item.clientId) {
      ackByClientId.set(item.clientId, {
        blockId: item.blockId,
        sortKey: item.sortKey,
      });
    }
    ackByBlockId.set(item.blockId, {
      blockId: item.blockId,
      sortKey: item.sortKey,
    });
  }

  const patchNode = (
    node: TiptapDoc["content"][number],
  ): TiptapDoc["content"][number] => {
    const identity = readIdentityFromAttrs(node.attrs);
    const ack =
      (identity.clientId ? ackByClientId.get(identity.clientId) : undefined) ??
      (identity.blockId ? ackByBlockId.get(identity.blockId) : undefined);
    const nextAttrs = { ...(node.attrs ?? {}) };
    let nodeChanged = false;
    if (ack) {
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
      if (nextAttrs.syncCreateId !== undefined) {
        delete nextAttrs.syncCreateId;
        nodeChanged = true;
      }
      if (nextAttrs.clientBatchId !== undefined) {
        delete nextAttrs.clientBatchId;
        nodeChanged = true;
      }
      if (nextAttrs["data-sync-create-id"] !== undefined) {
        delete nextAttrs["data-sync-create-id"];
        nodeChanged = true;
      }
    }

    let nextContent = node.content;
    if (Array.isArray(node.content) && node.content.length > 0) {
      let childChanged = false;
      nextContent = node.content.map((child) => {
        const patchedChild = patchNode(child);
        if (patchedChild !== child) {
          childChanged = true;
        }
        return patchedChild;
      });
      nodeChanged = nodeChanged || childChanged;
    }

    if (!nodeChanged) return node;
    return {
      ...node,
      ...(nodeChanged ? { attrs: nextAttrs } : {}),
      ...(nextContent ? { content: nextContent } : {}),
    };
  };

  const content = doc.content.map((node) => patchNode(node));
  const changed = content.some((node, index) => node !== doc.content[index]);

  return changed ? { ...doc, content } : doc;
}

export function applyServerDeleteAck(
  doc: TiptapDoc,
  deletions: Array<{ blockId?: string | null; clientId?: string | null }>,
): TiptapDoc {
  if (!Array.isArray(doc.content) || deletions.length === 0) return doc;

  const blockIds = new Set<string>();
  const clientIds = new Set<string>();
  for (const item of deletions) {
    if (item.blockId) blockIds.add(item.blockId);
    if (item.clientId) clientIds.add(item.clientId);
  }
  if (blockIds.size === 0 && clientIds.size === 0) return doc;

  const shouldRemoveNode = (
    node: TiptapDoc["content"][number],
  ): boolean => {
    const identity = readIdentityFromAttrs(node.attrs);
    if (identity.blockId && blockIds.has(identity.blockId)) return true;
    if (identity.clientId && clientIds.has(identity.clientId)) return true;
    return false;
  };

  const content = doc.content.filter((node) => !shouldRemoveNode(node));
  return content.length === doc.content.length ? doc : { ...doc, content };
}

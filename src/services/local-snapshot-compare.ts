import type { TiptapDoc, TiptapNode } from "@/services/tiptap-converter";
import { deepFilterKeys } from "@/services/local-snapshot-filter";

export type LocalSnapshotBlockChangeKind =
  | "added"
  | "deleted"
  | "modified"
  | "moved"
  | "metadata-only";

export type LocalSnapshotBlockChange = {
  kind: LocalSnapshotBlockChangeKind;
  blockKey: string;
  label: string;
  beforeIndex: number | null;
  afterIndex: number | null;
  before: TiptapNode | null;
  after: TiptapNode | null;
};

export type LocalSnapshotBlockCompareSummary = {
  totalBefore: number;
  totalAfter: number;
  unchanged: number;
  added: number;
  deleted: number;
  modified: number;
  moved: number;
  metadataOnly: number;
};

export type LocalSnapshotBlockCompareResult = {
  matches: boolean;
  summary: LocalSnapshotBlockCompareSummary;
  changes: LocalSnapshotBlockChange[];
};

type IndexedBlock = {
  key: string;
  index: number;
  node: TiptapNode;
  filteredText: string;
  rawText: string;
};

type CompareOptions = {
  ignoredKeys?: Set<string>;
};

const IDENTITY_KEYS = ["blockId", "clientId", "syncCreateId", "data-sync-create-id", "id"];

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    return `{${Object.keys(raw)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(raw[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readBlockIdentity(node: TiptapNode): string | null {
  const attrs = node.attrs ?? {};
  for (const key of IDENTITY_KEYS) {
    const value = attrs[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function collectText(node: TiptapNode): string {
  if (typeof node.text === "string") return node.text;
  if (!node.content?.length) return "";
  return node.content.map(collectText).filter(Boolean).join(" ");
}

function blockLabel(node: TiptapNode | null, fallbackKey: string): string {
  if (!node) return fallbackKey;
  const text = collectText(node).trim().replace(/\s+/g, " ");
  if (text) return `${node.type}: ${text.slice(0, 80)}`;
  return node.type || fallbackKey;
}

function indexBlocks(doc: TiptapDoc | null, ignoredKeys: Set<string>): IndexedBlock[] {
  const seen = new Map<string, number>();
  return (doc?.content ?? []).map((node, index) => {
    const identity = readBlockIdentity(node) ?? `index:${index}`;
    const count = seen.get(identity) ?? 0;
    seen.set(identity, count + 1);
    const key = count === 0 ? identity : `${identity}#${count + 1}`;
    return {
      key,
      index,
      node,
      filteredText: stableStringify(deepFilterKeys(node, ignoredKeys)),
      rawText: stableStringify(node),
    };
  });
}

function emptySummary(totalBefore: number, totalAfter: number): LocalSnapshotBlockCompareSummary {
  return {
    totalBefore,
    totalAfter,
    unchanged: 0,
    added: 0,
    deleted: 0,
    modified: 0,
    moved: 0,
    metadataOnly: 0,
  };
}

export function compareLocalSnapshotBlocks(
  beforeDoc: TiptapDoc | null,
  afterDoc: TiptapDoc | null,
  options: CompareOptions = {},
): LocalSnapshotBlockCompareResult {
  const ignoredKeys = options.ignoredKeys ?? new Set<string>();
  const beforeBlocks = indexBlocks(beforeDoc, ignoredKeys);
  const afterBlocks = indexBlocks(afterDoc, ignoredKeys);
  const beforeByKey = new Map(beforeBlocks.map((block) => [block.key, block]));
  const afterByKey = new Map(afterBlocks.map((block) => [block.key, block]));
  const summary = emptySummary(beforeBlocks.length, afterBlocks.length);
  const changes: LocalSnapshotBlockChange[] = [];

  for (const after of afterBlocks) {
    const before = beforeByKey.get(after.key);
    if (!before) {
      summary.added += 1;
      changes.push({
        kind: "added",
        blockKey: after.key,
        label: blockLabel(after.node, after.key),
        beforeIndex: null,
        afterIndex: after.index,
        before: null,
        after: after.node,
      });
      continue;
    }

    if (before.filteredText !== after.filteredText) {
      summary.modified += 1;
      changes.push({
        kind: "modified",
        blockKey: after.key,
        label: blockLabel(after.node, after.key),
        beforeIndex: before.index,
        afterIndex: after.index,
        before: before.node,
        after: after.node,
      });
      continue;
    }

    if (before.rawText !== after.rawText) {
      summary.metadataOnly += 1;
      changes.push({
        kind: "metadata-only",
        blockKey: after.key,
        label: blockLabel(after.node, after.key),
        beforeIndex: before.index,
        afterIndex: after.index,
        before: before.node,
        after: after.node,
      });
      continue;
    }

    if (before.index !== after.index) {
      summary.moved += 1;
      changes.push({
        kind: "moved",
        blockKey: after.key,
        label: blockLabel(after.node, after.key),
        beforeIndex: before.index,
        afterIndex: after.index,
        before: before.node,
        after: after.node,
      });
      continue;
    }

    summary.unchanged += 1;
  }

  for (const before of beforeBlocks) {
    if (afterByKey.has(before.key)) continue;
    summary.deleted += 1;
    changes.push({
      kind: "deleted",
      blockKey: before.key,
      label: blockLabel(before.node, before.key),
      beforeIndex: before.index,
      afterIndex: null,
      before: before.node,
      after: null,
    });
  }

  return {
    matches: changes.length === 0,
    summary,
    changes,
  };
}

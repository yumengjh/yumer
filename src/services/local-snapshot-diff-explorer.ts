import { deepFilterKeys } from "@/services/local-snapshot-filter";
import type { LocalSnapshotBlockChange } from "@/services/local-snapshot-compare";
import { buildJsonStructureDiff, type JsonStructureDiffHunk } from "@/services/json-structure-diff";

export type LocalSnapshotDiffCategory =
  | "content"
  | "sort"
  | "style"
  | "structure"
  | "auto-meta"
  | "other-meta";

export type LocalSnapshotDiffEntry = {
  change: LocalSnapshotBlockChange;
  hunks: JsonStructureDiffHunk[];
  categories: Set<LocalSnapshotDiffCategory>;
  searchableText: string;
};

export type LocalSnapshotDiffFilter = {
  query: string;
  visibleCategories: Set<LocalSnapshotDiffCategory>;
};

export const AUTO_GENERATED_SYNC_META_KEYS = new Set([
  "clientBatchId",
  "syncCreateId",
  "data-sync-create-id",
]);

export const DEFAULT_VISIBLE_DIFF_CATEGORIES: Set<LocalSnapshotDiffCategory> = new Set([
  "content",
  "sort",
  "style",
  "structure",
]);

const STYLE_PATH_PARTS = [
  "marks",
  "textAlign",
  "color",
  "backgroundColor",
  "fontSize",
  "lineHeight",
  "indent",
  "class",
  "style",
  "highlight",
  "bold",
  "italic",
  "underline",
  "strike",
];

function formatJsonLines(value: unknown): string[] {
  try {
    return JSON.stringify(value, null, 2).split("\n");
  } catch {
    return [String(value)];
  }
}

function buildWholeBlockHunk(
  change: LocalSnapshotBlockChange,
  ignoredKeys: Set<string>,
): JsonStructureDiffHunk[] {
  if (change.kind === "added") {
    return [
      {
        path: "$",
        lines: formatJsonLines(deepFilterKeys(change.after, ignoredKeys)).map((text) => ({
          kind: "added",
          text,
        })),
      },
    ];
  }

  if (change.kind === "deleted") {
    return [
      {
        path: "$",
        lines: formatJsonLines(deepFilterKeys(change.before, ignoredKeys)).map((text) => ({
          kind: "removed",
          text,
        })),
      },
    ];
  }

  return [];
}

export function buildLocalSnapshotBlockHunks(
  change: LocalSnapshotBlockChange,
  ignoredKeys: Set<string> = new Set(),
): JsonStructureDiffHunk[] {
  const visibleIgnoredKeys = change.kind === "metadata-only" ? new Set<string>() : ignoredKeys;
  const wholeBlockHunks = buildWholeBlockHunk(change, visibleIgnoredKeys);
  if (wholeBlockHunks.length > 0) return wholeBlockHunks;

  if (change.kind === "moved") {
    return [
      {
        path: "$position",
        lines: [
          { kind: "removed", text: `#${(change.beforeIndex ?? 0) + 1}` },
          { kind: "added", text: `#${(change.afterIndex ?? 0) + 1}` },
        ],
      },
    ];
  }

  return buildJsonStructureDiff(change.before, change.after, {
    ignoredKeys: visibleIgnoredKeys,
    maxHunks: 80,
  }).hunks;
}

function pathLeaf(path: string): string {
  const bracketless = path.replace(/\[\d+\]/g, "");
  const parts = bracketless.split(".").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function classifyDiffHunk(
  hunk: JsonStructureDiffHunk,
  change: LocalSnapshotBlockChange,
): LocalSnapshotDiffCategory {
  if (change.kind === "added" || change.kind === "deleted") return "structure";
  if (change.kind === "moved" || hunk.path.includes("sortKey") || hunk.path === "$position") {
    return "sort";
  }

  const leaf = pathLeaf(hunk.path);
  if (AUTO_GENERATED_SYNC_META_KEYS.has(leaf)) return "auto-meta";

  if (hunk.path.includes("content") || hunk.path.endsWith("text") || hunk.path === "type") {
    return "content";
  }

  if (STYLE_PATH_PARTS.some((part) => hunk.path.includes(part))) return "style";
  if (hunk.path.startsWith("attrs.")) return "other-meta";
  return "other-meta";
}

function searchableTextFor(change: LocalSnapshotBlockChange, hunks: JsonStructureDiffHunk[]): string {
  return [
    change.kind,
    change.blockKey,
    change.label,
    String(change.beforeIndex ?? ""),
    String(change.afterIndex ?? ""),
    ...hunks.flatMap((hunk) => [hunk.path, ...hunk.lines.map((line) => line.text)]),
  ]
    .join("\n")
    .toLowerCase();
}

export function buildLocalSnapshotDiffEntries(
  changes: LocalSnapshotBlockChange[],
  ignoredKeys: Set<string> = new Set(),
): LocalSnapshotDiffEntry[] {
  return changes.map((change) => {
    const hunks = buildLocalSnapshotBlockHunks(change, ignoredKeys);
    const categories = new Set<LocalSnapshotDiffCategory>();
    if (hunks.length === 0) {
      categories.add(change.kind === "metadata-only" ? "auto-meta" : "structure");
    }
    for (const hunk of hunks) {
      categories.add(classifyDiffHunk(hunk, change));
    }
    return {
      change,
      hunks,
      categories,
      searchableText: searchableTextFor(change, hunks),
    };
  });
}

export function filterLocalSnapshotDiffEntries(
  entries: LocalSnapshotDiffEntry[],
  filter: LocalSnapshotDiffFilter,
): LocalSnapshotDiffEntry[] {
  const query = filter.query.trim().toLowerCase();
  return entries.filter((entry) => {
    const categoryVisible = Array.from(entry.categories).some((category) =>
      filter.visibleCategories.has(category),
    );
    if (!categoryVisible) return false;
    if (!query) return true;
    return entry.searchableText.includes(query);
  });
}

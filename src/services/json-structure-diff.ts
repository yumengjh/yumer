export type JsonStructureDiffLineKind = "added" | "removed";

export type JsonStructureDiffLine = {
  kind: JsonStructureDiffLineKind;
  text: string;
};

export type JsonStructureDiffHunk = {
  path: string;
  lines: JsonStructureDiffLine[];
};

export type JsonStructureDiffResult = {
  hunks: JsonStructureDiffHunk[];
  totalChanges: number;
  truncated: boolean;
};

type JsonStructureDiffOptions = {
  ignoredKeys?: Set<string>;
  maxHunks?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function makeChildPath(parentPath: string, key: string | number): string {
  if (typeof key === "number") return `${parentPath}[${key}]`;
  return parentPath ? `${parentPath}.${key}` : key;
}

export function buildJsonStructureDiff(
  before: unknown,
  after: unknown,
  options: JsonStructureDiffOptions = {},
): JsonStructureDiffResult {
  const maxHunks = options.maxHunks ?? 80;
  const ignoredKeys = options.ignoredKeys ?? new Set<string>();
  const hunks: JsonStructureDiffHunk[] = [];
  let totalChanges = 0;

  const pushHunk = (path: string, lines: JsonStructureDiffLine[]) => {
    totalChanges += 1;
    if (hunks.length >= maxHunks) return;
    hunks.push({ path: path || "$", lines });
  };

  const walk = (left: unknown, right: unknown, path: string, keyName?: string) => {
    if (keyName && ignoredKeys.has(keyName)) return;
    if (stableStringify(left) === stableStringify(right)) return;

    if (Array.isArray(left) && Array.isArray(right)) {
      const max = Math.max(left.length, right.length);
      for (let index = 0; index < max; index += 1) {
        if (index >= left.length) {
          pushHunk(makeChildPath(path, index), [{ kind: "added", text: stableStringify(right[index]) }]);
          continue;
        }
        if (index >= right.length) {
          pushHunk(makeChildPath(path, index), [{ kind: "removed", text: stableStringify(left[index]) }]);
          continue;
        }
        walk(left[index], right[index], makeChildPath(path, index));
      }
      return;
    }

    if (isRecord(left) && isRecord(right)) {
      const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort((a, b) =>
        a.localeCompare(b),
      );
      for (const key of keys) {
        const childPath = makeChildPath(path, key);
        if (!(key in left)) {
          if (!ignoredKeys.has(key)) {
            pushHunk(childPath, [{ kind: "added", text: stableStringify(right[key]) }]);
          }
          continue;
        }
        if (!(key in right)) {
          if (!ignoredKeys.has(key)) {
            pushHunk(childPath, [{ kind: "removed", text: stableStringify(left[key]) }]);
          }
          continue;
        }
        walk(left[key], right[key], childPath, key);
      }
      return;
    }

    pushHunk(path, [
      { kind: "removed", text: stableStringify(left) },
      { kind: "added", text: stableStringify(right) },
    ]);
  };

  walk(before, after, "");

  return {
    hunks,
    totalChanges,
    truncated: totalChanges > hunks.length,
  };
}

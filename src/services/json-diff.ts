export type DiffLineKind = "same" | "added" | "removed";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
};

function splitLines(text: string): string[] {
  return text.split("\n");
}

/**
 * Compute a line-level diff between two strings using LCS (Longest Common Subsequence).
 * Returns an array of DiffLine entries describing how to turn `oldText` into `newText`.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ kind: "same", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ kind: "added", text: newLines[j - 1] });
      j--;
    } else {
      result.push({ kind: "removed", text: oldLines[i - 1] });
      i--;
    }
  }

  result.reverse();
  return result;
}

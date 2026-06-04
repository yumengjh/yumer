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

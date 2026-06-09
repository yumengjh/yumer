import type { BlockToolbarTarget } from "./blockTarget";

export function shouldRetainHoveredTarget(
  current: BlockToolbarTarget | null,
  next: BlockToolbarTarget | null,
): boolean {
  if (!current || !next) return false;
  if (next.kind === "table") return false;
  if (current.anchorElement === next.anchorElement) return false;
  return current.anchorElement.contains(next.anchorElement);
}

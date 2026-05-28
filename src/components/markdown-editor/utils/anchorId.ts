const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ANCHOR_LENGTH = 6;

export interface HeadingAnchorCandidate {
  pos: number;
  anchorId: string | null;
}

export interface HeadingAnchorPatch {
  pos: number;
  anchorId: string;
}

type RandomByteSource = (length: number) => Uint8Array;

function defaultRandomByteSource(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function generateAnchorId(getBytes: RandomByteSource = defaultRandomByteSource): string {
  const bytes = getBytes(ANCHOR_LENGTH);
  let result = "";
  for (let i = 0; i < ANCHOR_LENGTH; i++) {
    result += LETTERS[bytes[i] % LETTERS.length];
  }
  return result;
}

export function buildAnchorUrl(currentHref: string, anchorId: string): string {
  const url = new URL(currentHref);
  url.hash = anchorId;
  return url.toString();
}

export function createHeadingAnchorPatchPlan(
  headings: HeadingAnchorCandidate[],
  generate: () => string = generateAnchorId,
): HeadingAnchorPatch[] {
  const preserved = new Set<string>();
  const duplicatePositions = new Set<number>();
  const patches: HeadingAnchorPatch[] = [];

  for (const heading of headings) {
    const currentAnchorId = heading.anchorId?.trim() || null;
    if (!currentAnchorId) continue;
    if (preserved.has(currentAnchorId)) {
      duplicatePositions.add(heading.pos);
      continue;
    }
    preserved.add(currentAnchorId);
  }

  const used = new Set<string>(preserved);
  const nextUniqueAnchorId = (): string => {
    let anchorId = generate();
    while (used.has(anchorId)) {
      anchorId = generate();
    }
    used.add(anchorId);
    return anchorId;
  };

  for (const heading of headings) {
    const currentAnchorId = heading.anchorId?.trim() || null;
    if (currentAnchorId && !duplicatePositions.has(heading.pos)) {
      continue;
    }

    patches.push({
      pos: heading.pos,
      anchorId: nextUniqueAnchorId(),
    });
  }

  return patches;
}

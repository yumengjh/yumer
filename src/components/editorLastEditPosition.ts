export function resolveRestoreBlockId(input: {
  blockIds: string[];
  targetBlockId: string | null;
  previousBlockId: string | null;
  nextBlockId: string | null;
}): string | null {
  const { blockIds, targetBlockId, previousBlockId, nextBlockId } = input;
  if (!targetBlockId || blockIds.length === 0) return null;
  if (blockIds.includes(targetBlockId)) return targetBlockId;
  if (nextBlockId && blockIds.includes(nextBlockId)) return nextBlockId;
  if (previousBlockId && blockIds.includes(previousBlockId)) return previousBlockId;

  return null;
}

export function shouldPersistLastEditPosition(input: {
  hasQueuedPosition: boolean;
  loadingDoc: boolean;
  inFlight: boolean;
  queuedBlockId: string | null;
  lastPersistedBlockId: string | null;
  force: boolean;
}): boolean {
  if (!input.hasQueuedPosition) return false;
  if (input.loadingDoc || input.inFlight) return false;
  if (!input.queuedBlockId) return false;
  return true;
}

export function resolvePendingRestoreTarget(input: {
  docId: string | null;
  loadingDoc: boolean;
  pendingScrollBlockId: string | null;
  currentBlockIds: string[];
  lastEditPosition: {
    blockId: string;
    previousBlockId?: string | null;
    nextBlockId?: string | null;
  } | null;
  restoredDocId: string | null;
  pendingRestoreBlockId: string | null;
}): string | null {
  if (!input.docId || input.loadingDoc || input.pendingScrollBlockId) return null;
  if (input.restoredDocId === input.docId) return null;
  if (input.pendingRestoreBlockId) return null;

  return resolveRestoreBlockId({
    blockIds: input.currentBlockIds,
    targetBlockId: input.lastEditPosition?.blockId ?? null,
    previousBlockId: input.lastEditPosition?.previousBlockId ?? null,
    nextBlockId: input.lastEditPosition?.nextBlockId ?? null,
  });
}

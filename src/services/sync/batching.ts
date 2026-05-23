import type { SyncEntry, SyncOpType } from "./types";

export type SyncBatchLimits = {
  total: number;
  byOperation: Record<SyncOpType, number>;
};

export const SYNC_BATCH_LIMITS: SyncBatchLimits = {
  total: 100,
  byOperation: {
    create: 100,
    update: 100,
    delete: 100,
  },
};

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function validateSyncBatchLimits(limits: SyncBatchLimits): void {
  assertPositiveInteger(limits.total, "limits.total");
  assertPositiveInteger(limits.byOperation.create, "limits.byOperation.create");
  assertPositiveInteger(limits.byOperation.update, "limits.byOperation.update");
  assertPositiveInteger(limits.byOperation.delete, "limits.byOperation.delete");
}

export function selectSyncBatchOperations(
  dirtyOrder: string[],
  entries: Record<string, SyncEntry>,
  limits: SyncBatchLimits = SYNC_BATCH_LIMITS,
): SyncEntry[] {
  validateSyncBatchLimits(limits);

  const selected: SyncEntry[] = [];
  const selectedByOperation: Record<SyncOpType, number> = {
    create: 0,
    update: 0,
    delete: 0,
  };

  for (const id of dirtyOrder) {
    if (selected.length >= limits.total) break;

    const entry = entries[id];
    if (!entry) continue;

    if (selectedByOperation[entry.opType] >= limits.byOperation[entry.opType]) {
      continue;
    }

    selected.push(entry);
    selectedByOperation[entry.opType] += 1;
  }

  return selected;
}

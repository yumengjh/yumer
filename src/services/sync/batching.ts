import type { SyncEntry, SyncOpType } from "./types";

export type SyncBatchLimits = {
  total: number;
  byOperation: Record<SyncOpType, number>;
};

export const SYNC_BATCH_LIMITS: SyncBatchLimits = {
  total: 500,
  byOperation: {
    create: 100,
    update: 100,
    delete: 500,
    move: 100,
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
  assertPositiveInteger(limits.byOperation.move, "limits.byOperation.move");
}

/** move 优先于 update/create，避免顺序校正被内容批次挤到下一轮。 */
export function prioritizeMoveDirtyOrder(
  dirtyOrder: string[],
  entries: Record<string, SyncEntry>,
): string[] {
  const moves: string[] = [];
  const others: string[] = [];
  for (const id of dirtyOrder) {
    if (entries[id]?.opType === "move") {
      moves.push(id);
    } else {
      others.push(id);
    }
  }
  return [...moves, ...others];
}

export function selectSyncBatchOperations(
  dirtyOrder: string[],
  entries: Record<string, SyncEntry>,
  limits: SyncBatchLimits = SYNC_BATCH_LIMITS,
): SyncEntry[] {
  const normalizedLimits: SyncBatchLimits = {
    ...limits,
    byOperation: {
      ...SYNC_BATCH_LIMITS.byOperation,
      ...limits.byOperation,
    },
  };
  validateSyncBatchLimits(normalizedLimits);

  const selected: SyncEntry[] = [];
  const selectedByOperation: Record<SyncOpType, number> = {
    create: 0,
    update: 0,
    delete: 0,
    move: 0,
  };

  const orderedIds = prioritizeMoveDirtyOrder(dirtyOrder, entries);
  for (const id of orderedIds) {
    if (selected.length >= normalizedLimits.total) break;

    const entry = entries[id];
    if (!entry) continue;

    if (selectedByOperation[entry.opType] >= normalizedLimits.byOperation[entry.opType]) {
      continue;
    }

    selected.push(entry);
    selectedByOperation[entry.opType] += 1;
  }

  return selected;
}

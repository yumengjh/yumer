import { describe, expect, it } from "vitest";
import {
  SYNC_BATCH_LIMITS,
  prioritizeMoveDirtyOrder,
  selectSyncBatchOperations,
  type SyncBatchLimits,
} from "../batching";
import type { SyncEntry } from "../types";

function entry(clientId: string, opType: SyncEntry["opType"]): SyncEntry {
  return {
    clientId,
    blockId: opType === "create" ? null : `block_${clientId}`,
    opType,
  };
}

describe("sync batching", () => {
  it("respects total and per-operation limits while preserving order", () => {
    const entries: Record<string, SyncEntry> = {
      create_1: entry("create_1", "create"),
      update_1: entry("update_1", "update"),
      update_2: entry("update_2", "update"),
      delete_1: entry("delete_1", "delete"),
      create_2: entry("create_2", "create"),
    };
    const limits: SyncBatchLimits = {
      total: 3,
      byOperation: {
        create: 2,
        update: 1,
        delete: 2,
        move: 2,
      },
    };

    expect(selectSyncBatchOperations(Object.keys(entries), entries, limits).map((item) => item.clientId)).toEqual([
      "create_1",
      "update_1",
      "delete_1",
    ]);
  });

  it("prioritizes move operations ahead of updates in the same dirty queue", () => {
    const entries: Record<string, SyncEntry> = {
      update_1: entry("update_1", "update"),
      move_1: entry("move_1", "move"),
      update_2: entry("update_2", "update"),
    };
    const limits: SyncBatchLimits = {
      total: 2,
      byOperation: {
        create: 2,
        update: 2,
        delete: 2,
        move: 2,
      },
    };

    expect(
      selectSyncBatchOperations(
        ["update_1", "move_1", "update_2"],
        entries,
        limits,
      ).map((item) => item.clientId),
    ).toEqual(["move_1", "update_1"]);
    expect(
      prioritizeMoveDirtyOrder(["update_1", "move_1", "update_2"], entries),
    ).toEqual(["move_1", "update_1", "update_2"]);
  });

  it("rejects non-positive limits", () => {
    const limits: SyncBatchLimits = {
      total: 0,
      byOperation: {
        create: 1,
        update: 1,
        delete: 1,
        move: 1,
      },
    };

    expect(() =>
      selectSyncBatchOperations(["client_1"], { client_1: entry("client_1", "update") }, limits),
    ).toThrow("limits.total must be a positive integer");
  });

  it("selects a larger default delete batch for large document clears", () => {
    const entries: Record<string, SyncEntry> = {};
    const dirtyOrder: string[] = [];
    for (let i = 0; i < 250; i += 1) {
      const clientId = `delete_${i}`;
      dirtyOrder.push(clientId);
      entries[clientId] = entry(clientId, "delete");
    }

    expect(SYNC_BATCH_LIMITS.byOperation.delete).toBe(500);
    expect(selectSyncBatchOperations(dirtyOrder, entries)).toHaveLength(250);
  });
});

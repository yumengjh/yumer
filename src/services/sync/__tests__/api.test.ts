import { describe, expect, it } from "vitest";
import { buildSyncBatchOperations } from "../api";
import type { SyncEntry } from "../types";

describe("sync api payload builder", () => {
  it("deduplicates repeated create sortKeys before sending a batch", () => {
    const operations: SyncEntry[] = ["1", "2", "3"].map((suffix) => ({
      clientId: `client_${suffix}`,
      blockId: null,
      opType: "create",
      syncCreateId: `sync-create:client_${suffix}`,
      blockType: "paragraph",
      sortKey: "001998",
      payload: {
        type: "paragraph",
        attrs: {
          clientId: `client_${suffix}`,
          sortKey: "001998",
        },
      },
    }));

    const bodyOperations = buildSyncBatchOperations({
      docId: "doc_1",
      rootBlockId: "root_1",
      operations,
    });

    const createSortKeys = bodyOperations.map((operation) =>
      operation.type === "create" ? operation.data.sortKey : null,
    );
    const payloadSortKeys = bodyOperations.map((operation) =>
      operation.type === "create"
        ? (operation.data.payload.attrs as Record<string, unknown>).sortKey
        : null,
    );

    expect(createSortKeys).toEqual(["001998", "002998", "003998"]);
    expect(payloadSortKeys).toEqual(createSortKeys);
  });
});

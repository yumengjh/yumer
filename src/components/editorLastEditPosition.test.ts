import { describe, expect, it } from "vitest";
import {
  resolvePendingRestoreTarget,
  resolveRestoreBlockId,
  shouldPersistLastEditPosition,
} from "./editorLastEditPosition";

describe("resolveRestoreBlockId", () => {
  it("keeps the exact block when it still exists", () => {
    expect(
      resolveRestoreBlockId({
        blockIds: ["block_a", "block_b", "block_c"],
        targetBlockId: "block_b",
        previousBlockId: "block_a",
        nextBlockId: "block_c",
      }),
    ).toBe("block_b");
  });

  it("falls forward to the next block when the saved block was deleted", () => {
    expect(
      resolveRestoreBlockId({
        blockIds: ["block_a", "block_c", "block_d"],
        targetBlockId: "block_b",
        previousBlockId: "block_a",
        nextBlockId: "block_c",
      }),
    ).toBe("block_c");
  });

  it("falls back to the previous block when there is no following block", () => {
    expect(
      resolveRestoreBlockId({
        blockIds: ["block_a", "block_b"],
        targetBlockId: "block_c",
        previousBlockId: "block_b",
        nextBlockId: null,
      }),
    ).toBe("block_b");
  });

  it("returns null when there is no saved block or no remaining content blocks", () => {
    expect(
      resolveRestoreBlockId({
        blockIds: [],
        targetBlockId: null,
        previousBlockId: null,
        nextBlockId: null,
      }),
    ).toBeNull();
  });
});

describe("shouldPersistLastEditPosition", () => {
  it("waits for content sync before automatic metadata writes", () => {
    expect(
      shouldPersistLastEditPosition({
        hasQueuedPosition: true,
        loadingDoc: false,
        inFlight: false,
        autoRecord: true,
        contentSyncStatus: "dirty",
        queuedBlockId: "block_b",
        lastPersistedBlockId: "block_a",
        force: false,
      }),
    ).toBe(false);
  });

  it("blocks writes when a write is in flight", () => {
    expect(
      shouldPersistLastEditPosition({
        hasQueuedPosition: true,
        loadingDoc: false,
        inFlight: false,
        autoRecord: true,
        contentSyncStatus: "idle",
        queuedBlockId: "block_b",
        lastPersistedBlockId: "block_b",
        force: false,
      }),
    ).toBe(true);

    expect(
      shouldPersistLastEditPosition({
        hasQueuedPosition: true,
        loadingDoc: false,
        inFlight: true,
        autoRecord: true,
        contentSyncStatus: "idle",
        queuedBlockId: "block_c",
        lastPersistedBlockId: "block_b",
        force: false,
      }),
    ).toBe(false);
  });

  it("blocks writes until the document is loaded", () => {
    expect(
      shouldPersistLastEditPosition({
        hasQueuedPosition: true,
        loadingDoc: true,
        inFlight: false,
        autoRecord: true,
        contentSyncStatus: "idle",
        queuedBlockId: "block_c",
        lastPersistedBlockId: "block_b",
        force: false,
      }),
    ).toBe(false);
  });

  it("allows manual force-save even when the block matches the last persisted block", () => {
    expect(
      shouldPersistLastEditPosition({
        hasQueuedPosition: true,
        loadingDoc: false,
        inFlight: false,
        autoRecord: false,
        contentSyncStatus: "idle",
        queuedBlockId: "block_c",
        lastPersistedBlockId: "block_c",
        force: true,
      }),
    ).toBe(true);
  });

  it("blocks automatic writes when disabled locally", () => {
    expect(
      shouldPersistLastEditPosition({
        hasQueuedPosition: true,
        loadingDoc: false,
        inFlight: false,
        autoRecord: false,
        contentSyncStatus: "idle",
        queuedBlockId: "block_c",
        lastPersistedBlockId: "block_b",
        force: false,
      }),
    ).toBe(false);
  });
});

describe("resolvePendingRestoreTarget", () => {
  it("queues a restore target after load when the document has not restored yet", () => {
    expect(
      resolvePendingRestoreTarget({
        docId: "doc_1",
        loadingDoc: false,
        pendingScrollBlockId: null,
        currentBlockIds: ["block_a", "block_b"],
        lastEditPosition: {
          blockId: "block_b",
          previousBlockId: "block_a",
          nextBlockId: null,
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
        restoredDocId: null,
        pendingRestoreBlockId: null,
      }),
    ).toBe("block_b");
  });

  it("does not queue restore when search scroll is pending or the document is already restored", () => {
    expect(
      resolvePendingRestoreTarget({
        docId: "doc_1",
        loadingDoc: false,
        pendingScrollBlockId: "search_target",
        currentBlockIds: ["block_a", "block_b"],
        lastEditPosition: {
          blockId: "block_b",
          previousBlockId: "block_a",
          nextBlockId: null,
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
        restoredDocId: null,
        pendingRestoreBlockId: null,
      }),
    ).toBeNull();

    expect(
      resolvePendingRestoreTarget({
        docId: "doc_1",
        loadingDoc: false,
        pendingScrollBlockId: null,
        currentBlockIds: ["block_a", "block_b"],
        lastEditPosition: {
          blockId: "block_b",
          previousBlockId: "block_a",
          nextBlockId: null,
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
        restoredDocId: "doc_1",
        pendingRestoreBlockId: null,
      }),
    ).toBeNull();
  });

  it("keeps the pending restore alive until scroll success instead of consuming it early", () => {
    expect(
      resolvePendingRestoreTarget({
        docId: "doc_1",
        loadingDoc: false,
        pendingScrollBlockId: null,
        currentBlockIds: ["block_a", "block_b"],
        lastEditPosition: {
          blockId: "block_b",
          previousBlockId: "block_a",
          nextBlockId: null,
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
        restoredDocId: null,
        pendingRestoreBlockId: "block_b",
      }),
    ).toBeNull();
  });
});

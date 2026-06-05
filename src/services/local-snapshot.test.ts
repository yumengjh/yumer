// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { TiptapDoc } from "@/services/tiptap-converter";
import {
  buildLocalDocSnapshot,
  clearLocalSnapshotRecoveryMarker,
  compareSnapshotToContent,
  createMemoryLocalSnapshotStore,
  createDebouncedLocalSnapshotWriter,
  readLocalSnapshotRecoveryMarker,
  shouldRestoreLocalSnapshotAfterLoad,
  writeLocalSnapshotRecoveryBackup,
} from "@/services/local-snapshot";

const docA: TiptapDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { clientId: "client_a" },
      content: [{ type: "text", text: "first version" }],
    },
  ],
};

const docB: TiptapDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { clientId: "client_a" },
      content: [{ type: "text", text: "second version" }],
    },
  ],
};

describe("local document snapshot", () => {
  it("stores the latest full document snapshot by replacing the previous one", async () => {
    const store = createMemoryLocalSnapshotStore();

    await store.write(buildLocalDocSnapshot("doc_1", docA, 1000));
    await store.write(buildLocalDocSnapshot("doc_1", docB, 2000));

    const stored = await store.read("doc_1");
    expect(stored?.savedAt).toBe(2000);
    expect(stored?.content).toEqual(docB);
    expect(stored?.content).not.toEqual(docA);
  });

  it("compares a stored full snapshot with the currently loaded editor content", () => {
    const snapshot = buildLocalDocSnapshot("doc_1", docA, 1000);

    expect(compareSnapshotToContent(snapshot, docA).matches).toBe(true);
    expect(compareSnapshotToContent(snapshot, docB).matches).toBe(false);
  });

  it("restores a recent local snapshot when it differs from the loaded server content", () => {
    const newerSnapshot = buildLocalDocSnapshot("doc_1", docB, 2_000);
    const olderThanServerSnapshot = buildLocalDocSnapshot("doc_1", docB, 500);
    const newerMarker = {
      docId: "doc_1",
      savedAt: newerSnapshot.savedAt,
      hash: newerSnapshot.hash,
      markedAt: 2_000,
      reason: "dirty" as const,
    };
    const olderMarker = {
      docId: "doc_1",
      savedAt: olderThanServerSnapshot.savedAt,
      hash: olderThanServerSnapshot.hash,
      markedAt: 500,
      reason: "flushing" as const,
    };

    expect(
      shouldRestoreLocalSnapshotAfterLoad({
        snapshot: newerSnapshot,
        recoveryMarker: newerMarker,
        serverContent: docA,
        serverUpdatedAt: 1_000,
        now: 2_500,
      }),
    ).toBe(true);
    expect(
      shouldRestoreLocalSnapshotAfterLoad({
        snapshot: olderThanServerSnapshot,
        recoveryMarker: olderMarker,
        serverContent: docA,
        serverUpdatedAt: 1_000,
        now: 2_500,
      }),
    ).toBe(true);
    expect(
      shouldRestoreLocalSnapshotAfterLoad({
        snapshot: newerSnapshot,
        recoveryMarker: newerMarker,
        serverContent: docB,
        serverUpdatedAt: 1_000,
        now: 2_500,
      }),
    ).toBe(false);
  });

  it("does not restore stale local snapshots", () => {
    const snapshot = buildLocalDocSnapshot("doc_1", docB, 1_000);
    const recoveryMarker = {
      docId: "doc_1",
      savedAt: snapshot.savedAt,
      hash: snapshot.hash,
      markedAt: 1_000,
      reason: "dirty" as const,
    };

    expect(
      shouldRestoreLocalSnapshotAfterLoad({
        snapshot,
        recoveryMarker,
        serverContent: docA,
        serverUpdatedAt: 0,
        maxAgeMs: 500,
        now: 2_000,
      }),
    ).toBe(false);
  });

  it("does not restore without an explicit unsynced recovery marker", () => {
    const snapshot = buildLocalDocSnapshot("doc_1", docB, 1_000);

    expect(
      shouldRestoreLocalSnapshotAfterLoad({
        snapshot,
        recoveryMarker: null,
        serverContent: docA,
        serverUpdatedAt: 0,
        now: 1_500,
      }),
    ).toBe(false);
  });

  it("persists and clears the unsynced recovery marker with its snapshot", async () => {
    localStorage.clear();
    const snapshot = buildLocalDocSnapshot("doc_1", docB, 1_000);

    writeLocalSnapshotRecoveryBackup(snapshot, "flushing");

    expect(readLocalSnapshotRecoveryMarker("doc_1")).toMatchObject({
      docId: "doc_1",
      savedAt: snapshot.savedAt,
      hash: snapshot.hash,
      reason: "flushing",
    });

    const storedSnapshot = JSON.parse(
      localStorage.getItem("yuediter:local-snapshot:doc_1") ?? "null",
    ) as { hash?: string } | null;
    expect(storedSnapshot?.hash).toBe(snapshot.hash);

    clearLocalSnapshotRecoveryMarker("doc_1");
    expect(readLocalSnapshotRecoveryMarker("doc_1")).toBeNull();
  });

  it("ignores volatile sync metadata when comparing a stored snapshot", () => {
    const before: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            blockId: "b_1",
            clientId: "client_before",
            "data-block-id": "b_1",
            clientBatchId: "batch_before",
            syncCreateId: "sync-create:before",
            "data-sync-create-id": "sync-create:before",
            sortKey: "001000",
            "data-sort-key": "001000",
          },
          content: [{ type: "text", text: "same text" }],
        },
      ],
    };
    const after: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            blockId: "b_1",
            clientId: "client_after",
            clientBatchId: "batch_after",
            syncCreateId: "sync-create:after",
            sortKey: "001000",
          },
          content: [{ type: "text", text: "same text" }],
        },
      ],
    };

    const snapshot = buildLocalDocSnapshot("doc_1", before, 1000);

    expect(compareSnapshotToContent(snapshot, after).matches).toBe(true);
  });

  it("debounces repeated snapshot writes and only persists the latest one", async () => {
    vi.useFakeTimers();
    const writes: Array<string> = [];
    const writer = createDebouncedLocalSnapshotWriter(
      async (snapshot) => {
        writes.push(snapshot.content.content[0]?.content?.[0]?.text ?? "");
      },
      500,
    );

    writer.schedule(buildLocalDocSnapshot("doc_1", docA, 1000));
    writer.schedule(buildLocalDocSnapshot("doc_1", docB, 1500));

    await vi.advanceTimersByTimeAsync(499);
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual(["second version"]);

    vi.useRealTimers();
  });
});

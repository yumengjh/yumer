import { describe, expect, it, vi } from "vitest";
import type { TiptapDoc } from "@/services/tiptap-converter";
import {
  buildLocalDocSnapshot,
  compareSnapshotToContent,
  createMemoryLocalSnapshotStore,
  createDebouncedLocalSnapshotWriter,
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

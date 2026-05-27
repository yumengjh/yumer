import { describe, expect, it } from "vitest";
import { createInitialSyncState } from "../reducer";
import { advanceSyncSnapshot } from "../snapshot";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("sync snapshot advancement", () => {
  it("initializes the snapshot without enqueueing a change", () => {
    const state = createInitialSyncState("doc_1", "root_1", 1);
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1" },
          content: [{ type: "text", text: "loaded" }],
        },
      ],
    };

    const next = advanceSyncSnapshot(state, null, doc);

    expect(next.state.dirtyOrder).toEqual([]);
    expect(next.snapshot.content?.[0].attrs?.clientId).toBe("client_1");
  });

  it("synchronously enqueues differences between the previous and current editor snapshot", () => {
    const state = createInitialSyncState("doc_1", "root_1", 1);
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1" },
          content: [{ type: "text", text: "old text" }],
        },
      ],
    };
    const current: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1" },
          content: [{ type: "text", text: "new text just typed" }],
        },
      ],
    };

    const next = advanceSyncSnapshot(state, previous, current);

    expect(next.state.dirtyOrder).toEqual(["client_1"]);
    expect(next.state.syncState).toBe("dirty");
    expect((next.state.entries.client_1.payload as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(
      "new text just typed",
    );
    expect(next.snapshot.content?.[0].content?.[0].text).toBe("new text just typed");
  });

  it("persists generated sortKeys into the local snapshot for sequential blank-line creation", () => {
    let state = createInitialSyncState("doc_1", "root_1", 1);

    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1", sortKey: "001000" },
          content: [{ type: "text", text: "1" }],
        },
      ],
    };

    const currentStep1: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1", sortKey: "001000" },
          content: [{ type: "text", text: "1" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "blank_1" },
        },
      ],
    };

    const step1 = advanceSyncSnapshot(state, previous, currentStep1);
    state = step1.state;

    expect(step1.snapshot.content?.[1].attrs?.sortKey).toBe("002000");

    const currentStep2: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_1", clientId: "client_1", sortKey: "001000" },
          content: [{ type: "text", text: "1" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "blank_1" },
        },
        {
          type: "paragraph",
          attrs: { clientId: "block_2" },
          content: [{ type: "text", text: "2" }],
        },
      ],
    };

    const step2 = advanceSyncSnapshot(state, step1.snapshot, currentStep2);

    expect(step2.snapshot.content?.[1].attrs?.sortKey).toBe("002000");
    expect(step2.snapshot.content?.[2].attrs?.sortKey).toBe("003000");
    expect(step2.state.entries.blank_1.sortKey).toBe("002000");
    expect(step2.state.entries.block_2.sortKey).toBe("003000");
  });
});

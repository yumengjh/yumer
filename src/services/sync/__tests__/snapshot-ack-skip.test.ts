import { describe, expect, it } from "vitest";
import { createInitialSyncState } from "../reducer";
import {
  advanceSyncSnapshotIndexed,
  docSyncPayloadsEqual,
} from "../snapshot";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("docSyncPayloadsEqual", () => {
  it("treats identity-only attr differences as equal", () => {
    const left: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { blockId: "b1", clientId: "c1", sortKey: "a0", language: "typescript" },
          content: [{ type: "text", text: "hello" }],
        },
      ],
    };
    const right: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: {
            blockId: "b1",
            clientId: "c1",
            sortKey: "a0",
            clientBatchId: "batch_1",
            language: "typescript",
          },
          content: [{ type: "text", text: "hello" }],
        },
      ],
    };

    expect(docSyncPayloadsEqual(left, right)).toBe(true);
  });

  it("treats a pure reorder or sortKey change as different (drag move must not be skipped)", () => {
    const first = { type: "paragraph", attrs: { blockId: "b1", clientId: "c1", sortKey: "a0" }, content: [{ type: "text", text: "one" }] };
    const second = { type: "paragraph", attrs: { blockId: "b2", clientId: "c2", sortKey: "a1" }, content: [{ type: "text", text: "two" }] };
    const before: TiptapDoc = { type: "doc", content: [first, second] };
    const reordered: TiptapDoc = {
      type: "doc",
      content: [{ ...second, attrs: { ...second.attrs, sortKey: "Zz" } }, first],
    };
    const sortKeyOnly: TiptapDoc = {
      type: "doc",
      content: [first, { ...second, attrs: { ...second.attrs, sortKey: "a2" } }],
    };

    expect(docSyncPayloadsEqual(before, reordered)).toBe(false);
    expect(docSyncPayloadsEqual(before, sortKeyOnly)).toBe(false);
  });
});

describe("advanceSyncSnapshotIndexed ack rescan skip", () => {
  it("does not enqueue updates when batch-ack-rescan sees the same canonical payloads", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { blockId: "b1", clientId: "c1", language: "typescript" },
          content: [{ type: "text", text: "hello" }],
        },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: {
            blockId: "b1",
            clientId: "c1",
            sortKey: "a0",
            language: "typescript",
          },
          content: [{ type: "text", text: "hello" }],
        },
      ],
    };

    const state = createInitialSyncState("doc_1", "root_1", 1, 0, null);
    const advanced = advanceSyncSnapshotIndexed(
      state,
      previous,
      null,
      next,
      null,
      {
        captureSource: "batch-ack-rescan",
        suppressMoveDerivation: true,
        enqueueSortKeyRepairs: false,
      },
    );

    expect(advanced.state.dirtyOrder).toEqual([]);
    expect(advanced.metrics.derivedEntryCount).toBe(0);
  });
});

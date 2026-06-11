import { describe, expect, it } from "vitest";
import type { TiptapDoc } from "@/services/tiptap-converter";
import { applyCheckpointAck, buildDraftCheckpoint } from "../checkpoint";
import {
  createSortKeyBetween,
  SK0,
  SK1,
  SK2,
} from "./test-sort-key";

describe("checkpoint sync", () => {
  it("builds a full checkpoint from top-level TipTap blocks", async () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "cid_1", blockId: "block_1", sortKey: SK0 },
          content: [{ type: "text", text: "hello" }],
        },
        {
          type: "heading",
          attrs: { clientId: "cid_2", sortKey: SK1 },
          content: [{ type: "text", text: "world" }],
        },
      ],
    };

    const checkpoint = await buildDraftCheckpoint({
      docId: "doc_1",
      rootBlockId: "root_1",
      content: doc,
      baseVersion: 3,
      draftRevision: 4,
      sessionId: "sync_1",
      sessionEpoch: 2,
      clientId: "frontend-client",
      now: 1710000000000,
      clientCheckpointId: "checkpoint_1",
    });

    expect(checkpoint).toMatchObject({
      mode: "checkpoint",
      coverage: "full",
      clientCheckpointId: "checkpoint_1",
      clientId: "frontend-client",
      baseVersion: 3,
      draftRevision: 4,
      sessionId: "sync_1",
      sessionEpoch: 2,
      rootBlockId: "root_1",
    });
    expect(checkpoint.contentHash).toMatch(/^sha256:/);
    expect(
      checkpoint.blocks.map((block) => [
        block.clientId,
        block.blockId,
        block.type,
        block.orderKey,
      ]),
    ).toEqual([
      ["cid_1", "block_1", "paragraph", SK0],
      ["cid_2", null, "heading", SK1],
    ]);
    expect(checkpoint.blocks[1].syncCreateId).toBe("sync-create:cid_2");
    expect(
      (checkpoint.blocks[0].payload.attrs as Record<string, unknown>).clientBatchId,
    ).toBeUndefined();
  });

  it("patches checkpoint mappings back into a document by clientId", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { clientId: "cid_1", sortKey: SK0 } }],
    };
    const remapped = createSortKeyBetween(SK0, SK1);

    const patched = applyCheckpointAck(doc, [
      {
        clientId: "cid_1",
        blockId: "block_1",
        orderKey: remapped,
        sortKey: remapped,
      },
    ]);

    expect(patched.content?.[0].attrs).toMatchObject({
      clientId: "cid_1",
      blockId: "block_1",
      "data-block-id": "block_1",
      sortKey: remapped,
      "data-sort-key": remapped,
    });
  });

  it("canonicalizes orderKey by visual order instead of preserving corrupted attrs", async () => {
    const checkpoint = await buildDraftCheckpoint({
      docId: "doc_1",
      rootBlockId: "root_1",
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { clientId: "cid_a", sortKey: "999999" } },
          { type: "paragraph", attrs: { clientId: "cid_b", sortKey: "999999" } },
          { type: "paragraph", attrs: { clientId: "cid_c", sortKey: "000001" } },
        ],
      },
      baseVersion: 1,
      draftRevision: 1,
      sessionId: "sync_1",
      sessionEpoch: 1,
      clientId: "frontend-client",
      clientCheckpointId: "checkpoint_rekey",
    });

    expect(checkpoint.blocks.map((block) => block.orderKey)).toEqual([
      SK0,
      SK1,
      SK2,
    ]);
    expect(
      checkpoint.blocks.map(
        (block) => (block.payload.attrs as Record<string, unknown>).sortKey,
      ),
    ).toEqual([SK0, SK1, SK2]);
  });
});

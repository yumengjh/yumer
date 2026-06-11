import { describe, expect, it } from "vitest";
import {
  collectRootManifestNodes,
  computeRootManifestDigest,
} from "../manifest-digest";
import { createCanonicalSortKey } from "../order";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("manifest digest", () => {
  it("orders persisted root children by sortKey then blockId", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            clientId: "c_b",
            blockId: "block_b",
            sortKey: createCanonicalSortKey(1),
          },
        },
        {
          type: "paragraph",
          attrs: {
            clientId: "c_a",
            blockId: "block_a",
            sortKey: createCanonicalSortKey(0),
          },
        },
        {
          type: "paragraph",
          attrs: { clientId: "c_pending" },
        },
      ],
    };

    expect(collectRootManifestNodes(doc).map((node) => node.blockId)).toEqual([
      "block_a",
      "block_b",
    ]);
  });

  it("changes digest when sortKey values differ but block order stays the same", async () => {
    const base: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            clientId: "c_1",
            blockId: "block_1",
            sortKey: createCanonicalSortKey(0),
          },
        },
        {
          type: "paragraph",
          attrs: {
            clientId: "c_2",
            blockId: "block_2",
            sortKey: createCanonicalSortKey(1),
          },
        },
      ],
    };
    const shifted: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            clientId: "c_1",
            blockId: "block_1",
            sortKey: createCanonicalSortKey(5),
          },
        },
        {
          type: "paragraph",
          attrs: {
            clientId: "c_2",
            blockId: "block_2",
            sortKey: createCanonicalSortKey(6),
          },
        },
      ],
    };

    const first = await computeRootManifestDigest(base);
    const second = await computeRootManifestDigest(shifted);
    expect(first).not.toBe(second);
  });

  it("produces a stable sha256 digest for the same manifest", async () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            clientId: "c_1",
            blockId: "block_1",
            sortKey: createCanonicalSortKey(0),
          },
        },
        {
          type: "paragraph",
          attrs: {
            clientId: "c_2",
            blockId: "block_2",
            sortKey: createCanonicalSortKey(1),
          },
        },
      ],
    };

    const first = await computeRootManifestDigest(doc);
    const second = await computeRootManifestDigest(doc);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});

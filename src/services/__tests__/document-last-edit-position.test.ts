import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiGet, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

vi.mock("../api-client", () => ({
  apiGet,
  apiPost: vi.fn(),
  apiPatch,
  apiDelete: vi.fn(),
}));

import {
  loadDocumentContentV2,
  updateDocumentLastEditPosition,
} from "../document";

describe("document last edit position", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
  });

  it("loads last edit position from the root block payload metadata", async () => {
    apiGet.mockResolvedValue({
      docId: "doc_1",
      source: "draft",
      head: 7,
      publishedHead: 6,
      editorState: {
        lastEditPosition: {
          blockId: "block_b",
          previousBlockId: "block_a",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      },
      draft: { exists: true },
      lock: { locked: false, lockOwnerUserId: null, lockExpiresAt: null },
      tree: {
        blockId: "root_1",
        docId: "doc_1",
        type: "root",
        payload: {},
        sortKey: "0",
        indent: 0,
        collapsed: false,
        children: [
          {
            blockId: "block_a",
            docId: "doc_1",
            type: "paragraph",
            payload: {
              type: "paragraph",
              content: [{ type: "text", text: "A" }],
            },
            sortKey: "001000",
            indent: 0,
            collapsed: false,
          },
          {
            blockId: "block_b",
            docId: "doc_1",
            type: "paragraph",
            payload: {
              type: "paragraph",
              content: [{ type: "text", text: "B" }],
            },
            sortKey: "002000",
            indent: 0,
            collapsed: false,
          },
        ],
      },
    });

    const response = await loadDocumentContentV2("doc_1");

    expect(response.blockIds).toEqual(["block_a", "block_b"]);
    expect(response.lastEditPosition).toEqual({
      blockId: "block_b",
      previousBlockId: "block_a",
      nextBlockId: null,
      updatedAt: "2026-05-28T12:00:00.000Z",
    });
  });

  it("persists last edit position through the document editor-state endpoint", async () => {
    apiPatch.mockResolvedValue({
      docId: "doc_1",
      editorState: {
        lastEditPosition: {
          blockId: "block_b",
          previousBlockId: "block_a",
          nextBlockId: "block_c",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      },
    });

    const response = await updateDocumentLastEditPosition({
      docId: "doc_1",
      lastEditPosition: {
        blockId: "block_b",
        previousBlockId: "block_a",
        nextBlockId: "block_c",
        updatedAt: "2026-05-28T12:00:00.000Z",
      },
    });

    expect(apiPatch).toHaveBeenCalledWith("/documents/doc_1/editor-state", {
      editorState: {
        lastEditPosition: {
          blockId: "block_b",
          previousBlockId: "block_a",
          nextBlockId: "block_c",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      },
    });
    expect(response).toEqual({
      docId: "doc_1",
      editorState: {
        lastEditPosition: {
          blockId: "block_b",
          previousBlockId: "block_a",
          nextBlockId: "block_c",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      },
    });
  });
});

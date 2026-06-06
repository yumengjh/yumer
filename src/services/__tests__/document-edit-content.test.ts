import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiGet, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock("../api-client", () => ({
  apiGet,
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete,
}));

import {
  discardDraft,
  getEditContent,
  loadDocumentContentV2,
} from "../document";

describe("document edit content api", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiDelete.mockReset();
  });

  it("loads editor state from /documents/:docId/edit-content", async () => {
    apiGet.mockResolvedValue({
      docId: "doc_1",
      source: "draft",
      head: 3,
      publishedHead: 2,
      syncSession: {
        sessionId: "session_1",
        sessionEpoch: 1,
        leaseExpiresAt: "2026-06-04T23:30:00.000Z",
      },
      draft: { exists: true, draftId: "draft_1" },
      lock: { locked: false, lockOwnerUserId: null, lockExpiresAt: null },
      tree: { blockId: "root_1", type: "root", children: [] },
      pagination: { totalBlocks: 1, returnedBlocks: 1, hasMore: false },
    });

    const response = await getEditContent("doc_1");

    expect(apiGet).toHaveBeenCalledWith("/documents/doc_1/edit-content");
    expect(response.source).toBe("draft");
    expect(response.draft.exists).toBe(true);
    expect(response.syncSession).toEqual({
      sessionId: "session_1",
      sessionEpoch: 1,
      leaseExpiresAt: "2026-06-04T23:30:00.000Z",
    });
  });

  it("returns a blank TipTap document when edit content has no content blocks", async () => {
    apiGet.mockResolvedValue({
      docId: "doc_empty",
      source: "head",
      head: 1,
      publishedHead: 1,
      syncSession: {
        sessionId: "session_blank",
        sessionEpoch: 3,
        leaseExpiresAt: "2026-06-04T23:45:00.000Z",
      },
      draft: { exists: false, draftId: null },
      lock: { locked: false, lockOwnerUserId: null, lockExpiresAt: null },
      tree: { blockId: "root_1", type: "root", children: [] },
      pagination: { totalBlocks: 1, returnedBlocks: 1, hasMore: false },
    });

    const response = await loadDocumentContentV2("doc_empty");

    expect(response.content).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: expect.stringMatching(/^cid_/) },
        },
      ],
    });
    expect(response.syncSession).toEqual({
      sessionId: "session_blank",
      sessionEpoch: 3,
      leaseExpiresAt: "2026-06-04T23:45:00.000Z",
    });
  });

  it("returns an identity-stable blank TipTap document when edit content has no tree", async () => {
    apiGet.mockResolvedValue({
      docId: "doc_no_tree",
      source: "head",
      head: 1,
      publishedHead: 1,
      syncSession: null,
      draft: { exists: false, draftId: null },
      lock: { locked: false, lockOwnerUserId: null, lockExpiresAt: null },
      tree: null,
    });

    const response = await loadDocumentContentV2("doc_no_tree");

    expect(response.content).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: expect.stringMatching(/^cid_/) },
        },
      ],
    });
  });

  it("deletes /documents/:docId/draft with optional sync session metadata", async () => {
    apiDelete.mockResolvedValue(undefined);

    await discardDraft("doc_1", {
      sessionId: "session_1",
      sessionEpoch: 2,
    });

    expect(apiDelete).toHaveBeenCalledWith("/documents/doc_1/draft", {
      sessionId: "session_1",
      sessionEpoch: 2,
    });
  });
});

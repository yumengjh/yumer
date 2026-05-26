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

import { discardDraft, getEditContent } from "../document";

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
      draft: { exists: true, draftId: "draft_1" },
      lock: { locked: false, lockOwnerUserId: null, lockExpiresAt: null },
      tree: { blockId: "root_1", type: "root", children: [] },
      pagination: { totalBlocks: 1, returnedBlocks: 1, hasMore: false },
    });

    const response = await getEditContent("doc_1");

    expect(apiGet).toHaveBeenCalledWith("/documents/doc_1/edit-content");
    expect(response.source).toBe("draft");
    expect(response.draft.exists).toBe(true);
  });

  it("deletes /documents/:docId/draft when discarding a draft", async () => {
    apiDelete.mockResolvedValue(undefined);

    await discardDraft("doc_1");

    expect(apiDelete).toHaveBeenCalledWith("/documents/doc_1/draft");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiPost } = vi.hoisted(() => ({
  apiPost: vi.fn(),
}));

vi.mock("../api-client", () => ({
  apiGet: vi.fn(),
  apiPost,
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

import { commitVersion } from "../document";

describe("document commit api", () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  it("returns the committed version payload from /documents/:docId/commit", async () => {
    apiPost.mockResolvedValue({
      docId: "doc_1",
      version: 24,
      committed: true,
      draftRemoved: true,
    });

    const response = await commitVersion("doc_1", "手动保存");

    expect(apiPost).toHaveBeenCalledWith("/documents/doc_1/commit", { message: "手动保存" });
    expect(response.version).toBe(24);
    expect(response.committed).toBe(true);
  });
});

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/services/api-client";
import { downloadDocumentExport } from "./document-export";

vi.mock("@/services/api-client", () => ({
  apiFetch: vi.fn(),
}));

describe("document export service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the document title when the content disposition header is not exposed", async () => {
    let downloadedFilename = "";
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:export"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      downloadedFilename = this.download;
    });
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => null,
      },
      blob: async () => new Blob(["hello"], { type: "text/markdown" }),
    } as Response);

    const result = await downloadDocumentExport("doc_1", "md", "中文文档");

    expect(result.filename).toBe("中文文档.md");
    expect(downloadedFilename).toBe("中文文档.md");
  });
});

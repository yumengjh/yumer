// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadImage } from "./images";

const fetchMock = vi.fn();

describe("image service", () => {
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("keeps image urls exactly as returned by the backend", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          imageId: "asset_1",
          url: "http://localhost:5200/api/v1/images/asset_1/file",
          publicUrl: "http://localhost:5200/api/v1/public/images/asset_1/file",
          filename: "photo.png",
          mimeType: "image/png",
          size: 10,
          width: 640,
          height: 360,
          createdAt: "2026-05-25T00:00:00.000Z",
        },
      }),
    });

    const file = new File(["image"], "photo.png", { type: "image/png" });
    const image = await uploadImage("workspace_1", file);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-zzz.yumgjs.com/api/v1/images/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(image.url).toBe("http://localhost:5200/api/v1/images/asset_1/file");
    expect(image.publicUrl).toBe("http://localhost:5200/api/v1/public/images/asset_1/file");
  });
});

import { describe, expect, it, vi, afterEach } from "vitest";
import { revalidatePublicDocument } from "../public-doc-revalidation";

describe("revalidatePublicDocument", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts the slug and session-provided secret to the protected frontend endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          revalidated: ["public-doc:10-abcd1234", "/doc/10-abcd1234"],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await revalidatePublicDocument("10-abcd1234", "top-secret");

    expect(fetchMock).toHaveBeenCalledWith("/api/revalidate-doc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-revalidate-secret": "top-secret",
      },
      body: JSON.stringify({ slug: "10-abcd1234" }),
    });
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        success: true,
        revalidated: ["public-doc:10-abcd1234", "/doc/10-abcd1234"],
      },
    });
  });

  it("returns frontend error payloads for failed revalidation responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
          status: 401,
        }),
      ),
    );

    await expect(revalidatePublicDocument("10-abcd1234", "bad-secret")).resolves.toEqual({
      ok: false,
      status: 401,
      body: { success: false, error: "Unauthorized" },
    });
  });
});

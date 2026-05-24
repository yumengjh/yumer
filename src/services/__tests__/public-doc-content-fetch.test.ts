import { describe, expect, it, vi } from "vitest";
import { fetchPublicDocContent } from "../public-doc-content-fetch";

describe("fetchPublicDocContent", () => {
  it("falls back to the plain content endpoint when mode=all is rejected", async () => {
    const fetchOptions = { next: { revalidate: 3600 } } satisfies RequestInit;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

    const response = await fetchPublicDocContent(
      "http://api.test/documents/doc_1/content?mode=all",
      "http://api.test/documents/doc_1/content",
      fetchOptions,
      fetchMock as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://api.test/documents/doc_1/content?mode=all",
      fetchOptions,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://api.test/documents/doc_1/content",
      fetchOptions,
    );
    expect(response.status).toBe(200);
  });

  it("keeps the preferred mixed endpoint when it succeeds", async () => {
    const fetchOptions = { cache: "no-store" } satisfies RequestInit;
    const preferredResponse = new Response(JSON.stringify({ success: true }), {
      status: 200,
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(preferredResponse);

    const response = await fetchPublicDocContent(
      "http://api.test/documents/doc_1/content?mode=all",
      "http://api.test/documents/doc_1/content",
      fetchOptions,
      fetchMock as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/documents/doc_1/content?mode=all",
      fetchOptions,
    );
    expect(response).toBe(preferredResponse);
  });
});

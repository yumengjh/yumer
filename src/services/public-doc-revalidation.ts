export interface ManualPublicDocRevalidationResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function revalidatePublicDocument(
  slug: string,
  secret: string,
): Promise<ManualPublicDocRevalidationResult> {
  const response = await fetch("/api/revalidate-doc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-revalidate-secret": secret,
    },
    body: JSON.stringify({ slug }),
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await readResponseBody(response),
  };
}

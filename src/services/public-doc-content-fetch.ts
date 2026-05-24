export async function fetchPublicDocContent(
  preferredUrl: string,
  fallbackUrl: string,
  fetchOptions: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const preferredResponse = await fetchImpl(preferredUrl, fetchOptions);
  if (preferredResponse.ok) {
    return preferredResponse;
  }

  return fetchImpl(fallbackUrl, fetchOptions);
}

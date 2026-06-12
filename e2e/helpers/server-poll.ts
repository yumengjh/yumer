import {
  fetchEditContentSnapshot,
  flattenBlockTexts,
  type E2EAuthSession,
} from "./api";

export function hasStaleWeakBlocks(texts: string[]): boolean {
  return texts.some((text) => /^weak-\d+/.test(text));
}

export async function waitForServerWithoutStaleBlocks(
  session: E2EAuthSession,
  docId: string,
  matcher: (texts: string[]) => boolean,
  errorLabel: string,
  timeoutMs = 60_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await fetchEditContentSnapshot(session, docId);
    const texts = flattenBlockTexts(snapshot.tree);
    if (!matcher(texts)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const snapshot = await fetchEditContentSnapshot(session, docId);
  const texts = flattenBlockTexts(snapshot.tree);
  throw new Error(`${errorLabel}: ${texts.slice(0, 8).join(", ")}`);
}

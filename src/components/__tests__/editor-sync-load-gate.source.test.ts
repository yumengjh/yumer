import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("editor sync load gate source", () => {
  it("does not feed placeholder content into the sync hook before document content is loaded", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/EditorPage.tsx"),
      "utf8",
    );

    expect(pageSource).toContain(
      "const [loadedContentDocId, setLoadedContentDocId] = useState<string | null>(null);",
    );
    expect(pageSource).toContain("loadedContentDocId === currentDoc.docId");
    expect(pageSource).toContain("content: syncEngineEnabled ? syncContent : null,");

    const startLoadAt = pageSource.indexOf("setLoadingDoc(true);");
    const resetReadyAt = pageSource.indexOf("setLoadedContentDocId(null);", startLoadAt);
    const loadContentAt = pageSource.indexOf("const loaded = await loadContent(docId);", resetReadyAt);
    const markLoadedAt = pageSource.indexOf("loadedDocIdRef.current = docId;", loadContentAt);
    const markReadyAt = pageSource.indexOf("setLoadedContentDocId(docId);", loadContentAt);

    expect(startLoadAt).toBeGreaterThanOrEqual(0);
    expect(resetReadyAt).toBeGreaterThan(startLoadAt);
    expect(loadContentAt).toBeGreaterThan(resetReadyAt);
    expect(markLoadedAt).toBeGreaterThan(loadContentAt);
    expect(markReadyAt).toBeGreaterThan(loadContentAt);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("manual save baseVersion rebase source", () => {
  it("rebinds editor sync baseVersion after commit and seeds the current snapshot", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/EditorPage.tsx"),
      "utf8",
    );
    const contextSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/contexts/DocumentContext.tsx"),
      "utf8",
    );
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    expect(contextSource).toContain("applyCommittedVersion: (version: number) => void;");
    expect(pageSource).toContain('const commitResult = await commitVersion(currentDoc.docId, "手动保存")');
    expect(pageSource).toContain("applyCommittedVersion(commitResult.version)");
    expect(hookSource).toContain("const latestContentRef = useRef<TiptapDoc | null>(content);");
    expect(hookSource).toContain("snapshotRef.current = latestContentRef.current;");
  });
});

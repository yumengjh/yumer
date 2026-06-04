import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("sync session plumbing source", () => {
  it("stores the current sync session in document context and exposes it to editor flows", () => {
    const contextSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/contexts/DocumentContext.tsx"),
      "utf8",
    );
    const editorSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/EditorPage.tsx"),
      "utf8",
    );
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );
    const reducerSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/services/sync/reducer.ts"),
      "utf8",
    );

    expect(contextSource).toContain("currentSyncSession: SyncSessionMeta | null;");
    expect(contextSource).toContain("setCurrentSyncSession(syncSession ?? null);");
    expect(editorSource).toContain("currentSyncSession,");
    expect(editorSource).toContain("syncSession: syncEngineEnabled ? currentSyncSession : null,");
    const commitCallAt = editorSource.indexOf("const commitResult = await commitVersion(");
    expect(commitCallAt).toBeGreaterThanOrEqual(0);
    expect(editorSource.indexOf("sessionId: currentSyncSession.sessionId", commitCallAt)).toBeGreaterThan(
      commitCallAt,
    );
    expect(editorSource).toContain("discardDraftRequest(currentDoc.docId, currentSyncSession ?? undefined)");
    expect(hookSource).toContain("syncSession?: SyncSessionMeta | null;");
    expect(reducerSource).toContain("sessionId: syncSession?.sessionId ?? null,");
    expect(reducerSource).toContain("sessionEpoch: syncSession?.sessionEpoch ?? null,");
    expect(hookSource).toContain("sessionId: rebased.sessionId ?? undefined,");
    expect(hookSource).toContain("sessionEpoch: rebased.sessionEpoch ?? undefined,");
  });
});

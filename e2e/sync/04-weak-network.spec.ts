import {
  fetchEditContentSnapshot,
  flattenBlockTexts,
} from "../helpers/api";
import {
  hasStaleWeakBlocks,
} from "../helpers/server-poll";
import {
  createParagraphBlocks,
  getEditorPlainText,
  reloadEditor,
  selectAllAndDelete,
  typeInEditor,
  waitForEditorReady,
} from "../helpers/editor";
import { delaySyncBatchRequests } from "../helpers/network";
import {
  assertNoDuplicateCreateStorm,
  assertNoResurrectedBlocks,
  assertNoSyncIncidents,
  waitForDraftSynced,
  waitForManifestReconcile,
} from "../helpers/sync";
import { expect, test } from "../fixtures/sync-fixture";

test.describe("同步 E2E — 弱网与竞态", () => {
  test("batch 延迟时快速创建并全选删除，刷新后不应残留已删块", async ({
    page,
    authSession,
    syncDocument,
  }) => {
    await waitForEditorReady(page);

    await delaySyncBatchRequests(page, 400, async () => {
      await createParagraphBlocks(page, 20, "weak");
      await selectAllAndDelete(page);
    });

    await waitForDraftSynced(page, { timeoutMs: 120_000 });
    await waitForManifestReconcile(page);

    const replacement = `weak-recovery-${Date.now()}`;
    await typeInEditor(page, replacement);
    await waitForDraftSynced(page, { timeoutMs: 90_000 });

    await reloadEditor(page);
    const reloadedText = await getEditorPlainText(page);
    expect(reloadedText).toContain(replacement);
    expect(reloadedText).not.toMatch(/weak-\d+/);

    const serverSnapshot = await fetchEditContentSnapshot(authSession, syncDocument.docId);
    const serverTexts = flattenBlockTexts(serverSnapshot.tree);
    expect(serverTexts.join("\n")).toContain(replacement);
    expect(hasStaleWeakBlocks(serverTexts)).toBe(false);

    await assertNoSyncIncidents(page);
    await assertNoResurrectedBlocks(page);
    await assertNoDuplicateCreateStorm(page, 200);
  });

  test("先清空文档再输入新段落，刷新后只保留新段落", async ({ page, authSession, syncDocument }) => {
    await waitForEditorReady(page);

    await createParagraphBlocks(page, 15, "old");
    await waitForDraftSynced(page, { timeoutMs: 60_000 });

    await selectAllAndDelete(page);
    const freshParagraph = `fresh-${Date.now()}`;
    await typeInEditor(page, freshParagraph);
    await waitForDraftSynced(page, { timeoutMs: 90_000 });

    await reloadEditor(page);
    const reloadedText = await getEditorPlainText(page);
    expect(reloadedText).toContain(freshParagraph);
    expect(reloadedText).not.toContain("old-0");

    const serverSnapshot = await fetchEditContentSnapshot(authSession, syncDocument.docId);
    const serverTexts = flattenBlockTexts(serverSnapshot.tree);
    expect(serverTexts.join("\n")).toContain(freshParagraph);
    expect(serverTexts.some((text) => /^old-\d+/.test(text))).toBe(false);

    await assertNoSyncIncidents(page);
    await assertNoResurrectedBlocks(page);
  });
});

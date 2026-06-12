import {
  countBlocksWithText,
  fetchEditContentSnapshot,
  flattenBlockTexts,
} from "../helpers/api";
import {
  createParagraphBlocks,
  getEditorPlainText,
  reloadEditor,
  selectAllAndDelete,
  typeInEditor,
  waitForEditorReady,
} from "../helpers/editor";
import {
  assertNoDuplicateCreateStorm,
  assertNoResurrectedBlocks,
  assertNoSyncIncidents,
  waitForDraftSynced,
  waitForManifestReconcile,
} from "../helpers/sync";
import { expect, test } from "../fixtures/sync-fixture";

test.describe("同步 E2E — 全选删除", () => {
  test("创建 30 块后全选删除，再输入新段落，刷新后应只剩新内容", async ({
    page,
    authSession,
    syncDocument,
  }) => {
    await waitForEditorReady(page);

    await createParagraphBlocks(page, 30, "delete-me");
    await waitForDraftSynced(page, { timeoutMs: 90_000 });

    await selectAllAndDelete(page);
    const replacement = `after-delete-${Date.now()}`;
    await typeInEditor(page, replacement);
    await waitForDraftSynced(page, { timeoutMs: 90_000 });
    await waitForManifestReconcile(page);

    const editorText = await getEditorPlainText(page);
    expect(editorText).toContain(replacement);
    expect(editorText).not.toContain("delete-me-0");

    await reloadEditor(page);
    const reloadedText = await getEditorPlainText(page);
    expect(reloadedText).toContain(replacement);
    expect(reloadedText).not.toContain("delete-me-0");

    const serverSnapshot = await fetchEditContentSnapshot(authSession, syncDocument.docId);
    const serverTexts = flattenBlockTexts(serverSnapshot.tree);
    expect(serverTexts.join("\n")).toContain(replacement);
    expect(serverTexts.some((text) => text.startsWith("delete-me-"))).toBe(false);
    expect(countBlocksWithText(serverSnapshot.tree)).toBeLessThanOrEqual(3);

    await assertNoSyncIncidents(page);
    await assertNoResurrectedBlocks(page);
    await assertNoDuplicateCreateStorm(page, 150);
  });

  test("创建 100 块后立即全选删除，idle 后刷新应为空文档", async ({
    page,
    authSession,
    syncDocument,
  }) => {
    await waitForEditorReady(page);

    await createParagraphBlocks(page, 100, "storm");
    await selectAllAndDelete(page);
    await waitForDraftSynced(page, { timeoutMs: 120_000 });
    await waitForManifestReconcile(page);

    await reloadEditor(page);
    const reloadedText = (await getEditorPlainText(page)).trim();
    expect(reloadedText.length).toBeLessThanOrEqual(2);

    const serverSnapshot = await fetchEditContentSnapshot(authSession, syncDocument.docId);
    const serverTexts = flattenBlockTexts(serverSnapshot.tree).filter(Boolean);
    expect(serverTexts.some((text) => text.startsWith("storm-"))).toBe(false);

    await assertNoSyncIncidents(page);
    await assertNoResurrectedBlocks(page);
    await assertNoDuplicateCreateStorm(page, 200);
  });
});

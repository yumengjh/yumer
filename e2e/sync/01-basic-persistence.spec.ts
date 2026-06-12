import {
  countBlocksWithText,
  fetchEditContentSnapshot,
  flattenBlockTexts,
} from "../helpers/api";
import {
  getEditorPlainText,
  reloadEditor,
  typeInEditor,
  waitForEditorReady,
  waitForEditorText,
} from "../helpers/editor";
import {
  assertNoResurrectedBlocks,
  assertNoSyncIncidents,
  waitForAtLeastOneSuccessfulBatch,
  waitForDraftSynced,
  waitForSyncIdle,
} from "../helpers/sync";
import { expect, test } from "../fixtures/sync-fixture";

test.describe("同步 E2E — 基础持久化", () => {
  test("输入文本后刷新，内容应与服务端 draft 一致", async ({ page, authSession, syncDocument }) => {
    await waitForEditorReady(page);
    const marker = `sync-persist-${Date.now()}`;

    await typeInEditor(page, marker);
    await waitForAtLeastOneSuccessfulBatch(page);
    await waitForDraftSynced(page);

    const beforeReload = await getEditorPlainText(page);
    expect(beforeReload).toContain(marker);

    await reloadEditor(page);
    await waitForSyncIdle(page, { timeoutMs: 120_000 });
    await waitForEditorText(page, marker, 120_000);
    const afterReload = await getEditorPlainText(page);
    expect(afterReload).toContain(marker);

    const serverSnapshot = await fetchEditContentSnapshot(authSession, syncDocument.docId);
    const serverTexts = flattenBlockTexts(serverSnapshot.tree);
    expect(serverTexts.join("\n")).toContain(marker);

    await assertNoSyncIncidents(page);
    await assertNoResurrectedBlocks(page);
  });
});

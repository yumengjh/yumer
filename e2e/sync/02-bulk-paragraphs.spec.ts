import {
  countBlocksWithText,
  fetchEditContentSnapshot,
  flattenBlockTexts,
} from "../helpers/api";
import {
  countTopLevelBlocks,
  createParagraphBlocks,
  getEditorPlainText,
  reloadEditor,
  waitForEditorReady,
  waitForEditorText,
} from "../helpers/editor";
import {
  assertNoDuplicateCreateStorm,
  assertNoResurrectedBlocks,
  assertNoSyncIncidents,
  waitForDraftSynced,
  waitForSyncIdle,
} from "../helpers/sync";
import { expect, test } from "../fixtures/sync-fixture";

test.describe("同步 E2E — 批量段落", () => {
  test("粘贴 50 个段落后刷新，块数与文本应保持一致", async ({ page, authSession, syncDocument }) => {
    await waitForEditorReady(page);
    const blockCount = 50;

    await createParagraphBlocks(page, blockCount, "bulk");
    await waitForDraftSynced(page, { timeoutMs: 90_000 });

    const editorText = await getEditorPlainText(page);
    expect(editorText).toContain("bulk-0");
    expect(editorText).toContain(`bulk-${blockCount - 1}`);

    const topLevelBlocks = await countTopLevelBlocks(page);
    expect(topLevelBlocks).toBeGreaterThanOrEqual(blockCount);

    await reloadEditor(page);
    await waitForSyncIdle(page, { timeoutMs: 120_000 });
    await waitForEditorText(page, "bulk-0", 120_000);
    const reloadedText = await getEditorPlainText(page);
    expect(reloadedText).toContain("bulk-0");
    expect(reloadedText).toContain(`bulk-${blockCount - 1}`);

    const serverSnapshot = await fetchEditContentSnapshot(authSession, syncDocument.docId);
    const serverBlockCount = countBlocksWithText(serverSnapshot.tree);
    expect(serverBlockCount).toBeGreaterThanOrEqual(blockCount);

    const serverTexts = flattenBlockTexts(serverSnapshot.tree);
    expect(serverTexts.some((text) => text.startsWith("bulk-0"))).toBe(true);
    expect(serverTexts.some((text) => text.startsWith(`bulk-${blockCount - 1}`))).toBe(true);

    await assertNoSyncIncidents(page);
    await assertNoResurrectedBlocks(page);
    await assertNoDuplicateCreateStorm(page, 120);
  });
});

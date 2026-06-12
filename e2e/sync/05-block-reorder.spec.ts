import {
  fetchEditContentSnapshot,
  flattenTopLevelBlockTexts,
  type E2EAuthSession,
} from "../helpers/api";
import {
  createParagraphBlocks,
  dragBlockToGap,
  getTopLevelBlockTexts,
  reloadEditor,
  waitForEditorReady,
  countTopLevelBlocks,
} from "../helpers/editor";
import {
  assertNoSyncIncidents,
  waitForDraftSynced,
  waitForSyncIdle,
} from "../helpers/sync";
import { expect, test } from "../fixtures/sync-fixture";

function normalizeBlockTexts(texts: string[]): string[] {
  return texts.map((text) => text.trim()).filter((text) => text.length > 0);
}

async function waitForEditorMatchesServerDraft(
  page: import("@playwright/test").Page,
  session: E2EAuthSession,
  docId: string,
  timeoutMs = 180_000,
): Promise<string[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const editorOrder = normalizeBlockTexts(await getTopLevelBlockTexts(page));
    const serverSnapshot = await fetchEditContentSnapshot(session, docId);
    const serverOrder = normalizeBlockTexts(
      flattenTopLevelBlockTexts(serverSnapshot.tree),
    );
    if (
      editorOrder.length > 0 &&
      serverOrder.length === editorOrder.length &&
      JSON.stringify(editorOrder) === JSON.stringify(serverOrder)
    ) {
      return editorOrder;
    }
    await waitForDraftSynced(page, { timeoutMs: 20_000 }).catch(() => {});
    await page.waitForTimeout(600);
  }

  const editorOrder = normalizeBlockTexts(await getTopLevelBlockTexts(page));
  const serverSnapshot = await fetchEditContentSnapshot(session, docId);
  const serverOrder = normalizeBlockTexts(
    flattenTopLevelBlockTexts(serverSnapshot.tree),
  );
  throw new Error(
    [
      "编辑器顺序与服务端 draft 未对齐",
      `编辑器: ${editorOrder.join(" | ")}`,
      `服务端: ${serverOrder.join(" | ")}`,
    ].join("\n"),
  );
}

test.describe("同步 E2E — 块拖拽排序", () => {
  test("连续拖拽后刷新，编辑器顺序应与服务端 draft 一致", async ({
    page,
    authSession,
    syncDocument,
  }) => {
    test.setTimeout(300_000);
    await waitForEditorReady(page);
    await createParagraphBlocks(page, 8, "order");
    await waitForDraftSynced(page, { timeoutMs: 120_000 });

    const initialTexts = normalizeBlockTexts(await getTopLevelBlockTexts(page));
    expect(initialTexts).toHaveLength(8);
    expect(initialTexts[0]).toBe("order-0");

    // 6 次末块→首块拖拽，覆盖连续 move 场景；每 2 轮等待一次草稿同步
    for (let round = 0; round < 6; round += 1) {
      const blockCount = await countTopLevelBlocks(page);
      await dragBlockToGap(page, blockCount - 1, 0);
      await page.waitForTimeout(150);
      if ((round + 1) % 2 === 0) {
        await waitForDraftSynced(page, { timeoutMs: 60_000 }).catch(() => {});
      }
    }

    const beforeReload = await waitForEditorMatchesServerDraft(
      page,
      authSession,
      syncDocument.docId,
      180_000,
    );
    expect(beforeReload).toHaveLength(8);
    expect(beforeReload).not.toEqual(initialTexts);
    await waitForSyncIdle(page, { timeoutMs: 120_000 });

    await reloadEditor(page);
    await waitForSyncIdle(page);

    const afterReload = normalizeBlockTexts(await getTopLevelBlockTexts(page));
    expect(afterReload).toEqual(beforeReload);

    const serverAfterReload = await fetchEditContentSnapshot(
      authSession,
      syncDocument.docId,
    );
    const serverTextsAfterReload = normalizeBlockTexts(
      flattenTopLevelBlockTexts(serverAfterReload.tree),
    );
    expect(serverTextsAfterReload).toEqual(afterReload);

    await assertNoSyncIncidents(page);
  });
});

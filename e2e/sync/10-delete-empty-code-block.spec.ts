import { fetchEditContentSnapshot, type E2EAuthSession } from "../helpers/api";
import { EDITOR_SELECTOR, createParagraphBlocks, reloadEditor, waitForEditorReady } from "../helpers/editor";
import { waitForDraftSynced, waitForSyncIdle } from "../helpers/sync";
import { expect, test } from "../fixtures/sync-fixture";

/**
 * 回归：删除空代码块后刷新，代码块又回来了，且上方多出一个空段落。
 */
async function readEditorBlockTypes(page: import("@playwright/test").Page): Promise<string[]> {
  return page.locator(EDITOR_SELECTOR).first().evaluate((dom) => {
    const editor = (dom as HTMLElement & { editor?: { getJSON: () => { content?: Array<{ type: string; content?: Array<{ text?: string }> }> } } }).editor;
    return (editor?.getJSON().content ?? []).map((node) => `${node.type}:${(node.content ?? []).map((item) => item.text ?? "").join("")}`);
  });
}

async function readServerBlockTypes(session: E2EAuthSession, docId: string): Promise<string[]> {
  const snapshot = await fetchEditContentSnapshot(session, docId);
  return (snapshot.tree.children ?? [])
    .filter((node) => node.payload?.attrs?.deleted !== true && node.payload?.attrs?.deleted !== "true")
    .sort((a, b) => String(a.sortKey ?? "").localeCompare(String(b.sortKey ?? "")))
    .map((node) => `${(node.payload as { type?: string } | undefined)?.type ?? (node as { type?: string }).type}:${(node.payload?.content ?? []).map((item) => item.text ?? "").join("")}`);
}

async function openBlockMenu(page: import("@playwright/test").Page, block: import("@playwright/test").Locator) {
  const box = await block.boundingBox();
  const x = box!.x + 24;
  const y = box!.y + Math.min(14, box!.height / 2);
  const handle = page.locator('[data-testid="block-handle"]');
  // 手柄需要真实移动到目标块上（并且已经定位到该块旁边）才能点击
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.mouse.move(x + (attempt % 3), y + (attempt % 2));
    await page.evaluate(({ x, y }) => {
      document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
    }, { x, y });
    await page.waitForTimeout(250);
    const handleBox = await handle.boundingBox().catch(() => null);
    if (handleBox && handleBox.y >= box!.y - 4 && handleBox.y <= box!.y + box!.height) break;
  }
  await handle.click();
}

async function insertCodeBlockBelowFirst(page: import("@playwright/test").Page) {
  await openBlockMenu(page, page.locator(EDITOR_SELECTOR).first().locator(":scope > *").first());
  await page.locator('[data-testid="brick-menu-addBelow"]').hover();
  await page.locator('.yq-brick-sub [data-testid="card-menu-item-codeBlock"]').click();
}

for (const mode of ["block-menu", "backspace"] as const) {
  test(`删除空代码块（${mode}）后刷新不复活、不多出空行`, async ({ page, authSession, syncDocument }) => {
    await waitForEditorReady(page);
    await waitForSyncIdle(page);
    await createParagraphBlocks(page, 3, "段落");
    await waitForDraftSynced(page);

    await insertCodeBlockBelowFirst(page);
    await waitForDraftSynced(page);
    await page.waitForTimeout(1500);
    const withCode = await readEditorBlockTypes(page);
    expect(withCode.some((item) => item.startsWith("codeBlock"))).toBe(true);

    if (mode === "block-menu") {
      const codeEl = page.locator(EDITOR_SELECTOR).first().locator(":scope > .node-codeBlock");
      await openBlockMenu(page, codeEl);
      await page.locator('[data-testid="brick-menu-delete"]').click();
    } else {
      // 点进代码块正文（第 1 行），光标落在空代码块里
      const codeBox = await page.locator(EDITOR_SELECTOR).first().locator(":scope > .node-codeBlock").boundingBox();
      await page.mouse.click(codeBox!.x + 120, codeBox!.y + codeBox!.height - 26);
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
    }
    await page.waitForTimeout(500);
    const afterDelete = await readEditorBlockTypes(page);
    await waitForDraftSynced(page);
    await waitForSyncIdle(page, { stableMs: 2000 });
    expect(await readServerBlockTypes(authSession, syncDocument.docId)).toEqual(afterDelete);
    await reloadEditor(page);
    await waitForSyncIdle(page);
    const afterReload = await readEditorBlockTypes(page);
    expect(afterDelete.some((item) => item.startsWith("codeBlock"))).toBe(false);
    expect(afterReload).toEqual(afterDelete);
    expect(afterReload.some((item) => item.startsWith("codeBlock"))).toBe(false);
  });
}

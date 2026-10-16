import { EDITOR_SELECTOR, reloadEditor, waitForEditorReady } from "../helpers/editor";
import { waitForDraftSynced, waitForSyncIdle } from "../helpers/sync";
import { expect, test } from "../fixtures/sync-fixture";

/**
 * 回归：系统深浅色切换会让代码高亮扩展变化，进而重建 Tiptap 编辑器。
 * 之前新编辑器用父组件的初始 content（加载时的空文档）初始化，
 * 用户已输入的内容被回滚，同步层随后把这些块全部当成删除写入服务端。
 */
test("切换系统深浅色（编辑器重建）后内容、光标与服务端草稿不丢失", async ({ page, syncDocument }) => {
  void syncDocument;
  await page.emulateMedia({ colorScheme: "light" });
  await waitForEditorReady(page);
  await page.waitForTimeout(2000);

  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.type(`第${index}段内容`);
    await page.keyboard.press("Enter");
  }
  await waitForDraftSynced(page);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(1500);
  await page.keyboard.type("切换主题后继续输入");
  await waitForDraftSynced(page);
  await waitForSyncIdle(page, { stableMs: 2000 });

  const readTexts = () =>
    page.locator(EDITOR_SELECTOR).first().evaluate((editor) =>
      Array.from(editor.children)
        .map((child) => (child as HTMLElement).innerText.trim())
        .filter(Boolean),
    );
  const expected = [
    ...Array.from({ length: 5 }, (_, index) => `第${index}段内容`),
    "切换主题后继续输入",
  ];
  expect(await readTexts()).toEqual(expected);

  await reloadEditor(page);
  await waitForSyncIdle(page);
  expect(await readTexts()).toEqual(expected);
});

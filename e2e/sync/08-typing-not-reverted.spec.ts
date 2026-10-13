import { waitForEditorReady, EDITOR_SELECTOR } from "../helpers/editor";
import { test, expect } from "../fixtures/sync-fixture";

/**
 * 回归：同步 ACK 合并身份时曾把编辑器内容整体替换为 ACK 时刻的旧快照，
 * 导致 ACK 往返期间输入的字符/Markdown 快捷转换被回滚丢失。
 */
for (const delay of [0, 10, 25]) {
  test(`连续输入（含 Markdown 快捷语法）不应被同步回滚 delay=${delay}`, async ({ page, syncDocument }) => {
    void syncDocument;
    await waitForEditorReady(page);
    const type = (text: string) => page.keyboard.type(text, { delay });
    await type("# 产品设计文档");
    await page.keyboard.press("Enter");
    await type("这是一段正文内容。");
    await page.keyboard.press("Enter");
    await type("## 二级标题");
    await page.keyboard.press("Enter");
    await type("- 列表项一");
    await page.keyboard.press("Enter");
    await type("列表项二");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await type("> 引用内容");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    for (let index = 0; index < 8; index += 1) {
      await type(`段落${index}的文字内容`);
      await page.keyboard.press("Enter");
    }
    await type("最后一段文字。");
    await page.waitForTimeout(4000);

    const blocks = await page.locator(EDITOR_SELECTOR).first().evaluate((editor) =>
      Array.from(editor.children)
        .map((child) => `${child.tagName}:${(child as HTMLElement).innerText.trim()}`)
        .filter((item) => !/^P:$/.test(item)),
    );
    expect(blocks).toEqual([
      "H1:产品设计文档",
      "P:这是一段正文内容。",
      "H2:二级标题",
      "UL:列表项一\n\n列表项二",
      "BLOCKQUOTE:引用内容",
      ...Array.from({ length: 8 }, (_, index) => `P:段落${index}的文字内容`),
      "P:最后一段文字。",
    ]);
  });
}

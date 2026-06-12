import { expect, type Page } from "@playwright/test";

export const EDITOR_SELECTOR = ".tiptap-editor-wrapper .ProseMirror, .ProseMirror";
export const SYNC_STATUS_SELECTOR = '[role="status"] .header-sync__text';

const BOOT_LOADER_TEXT = "正在打开编辑器…";
const AUTH_LOADER_TEXT = "正在恢复登录状态…";

async function waitForHiddenText(page: Page, text: string, timeoutMs: number): Promise<void> {
  const loader = page.getByText(text, { exact: false });
  const visible = await loader.isVisible().catch(() => false);
  if (!visible) {
    return;
  }
  await loader.waitFor({ state: "hidden", timeout: timeoutMs });
}

export async function waitForEditorReady(page: Page): Promise<void> {
  // Next.js dynamic import + dev 编译
  await waitForHiddenText(page, BOOT_LOADER_TEXT, 120_000);
  await waitForHiddenText(page, AUTH_LOADER_TEXT, 60_000);

  const loginButton = page.getByRole("button", { name: "登录" });
  if (await loginButton.isVisible().catch(() => false)) {
    throw new Error(
      "SetupModal 仍显示登录界面：localStorage token 未生效，或 /auth/me 请求失败。",
    );
  }

  const editor = page.locator(EDITOR_SELECTOR).first();
  try {
    await editor.waitFor({ state: "visible", timeout: 60_000 });
  } catch (error) {
    const bodyText = ((await page.locator("body").innerText().catch(() => "")) ?? "").slice(
      0,
      500,
    );
    throw new Error(
      [
        "编辑器 ProseMirror 未在超时内出现。",
        `当前页面摘要: ${bodyText.replace(/\s+/g, " ")}`,
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
    );
  }

  await editor.click();
}

export async function getEditorPlainText(page: Page): Promise<string> {
  return page.locator(EDITOR_SELECTOR).first().innerText();
}

export async function countTopLevelBlocks(page: Page): Promise<number> {
  return page.locator(`${EDITOR_SELECTOR}`).first().locator(":scope > *").count();
}

export async function typeInEditor(page: Page, text: string): Promise<void> {
  const editor = page.locator(EDITOR_SELECTOR).first();
  await editor.click({ force: true });
  // insertText 不一定会触发 TipTap/ProseMirror 的 input 事件
  await page.keyboard.type(text, { delay: 15 });
}

export async function pasteMultilineBlocks(page: Page, lines: string[]): Promise<void> {
  const editor = page.locator(EDITOR_SELECTOR).first();
  await editor.click();
  const payload = lines.join("\n");

  const pastedLinesMatch = (text: string): boolean => {
    const normalized = text.replace(/\u00b7/g, "\n").split(/\n+/).map((line) => line.trim());
    return lines.every((line) => normalized.some((part) => part === line));
  };

  try {
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, payload);
    await page.keyboard.press("Control+V");
    const text = await editor.innerText();
    if (pastedLinesMatch(text)) {
      return;
    }
  } catch {
    // fall through to line-by-line insertion
  }

  await selectAllAndDelete(page);
  for (let index = 0; index < lines.length; index++) {
    if (index > 0) {
      await page.keyboard.press("Enter");
    }
    await page.keyboard.insertText(lines[index] ?? "");
  }
}

export async function createParagraphBlocks(page: Page, count: number, prefix = "block"): Promise<void> {
  const lines = Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
  await pasteMultilineBlocks(page, lines);
}

export async function selectAllInEditor(page: Page): Promise<void> {
  const editor = page.locator(EDITOR_SELECTOR).first();
  await editor.click();
  await page.keyboard.press("Control+A");
}

export async function deleteSelection(page: Page): Promise<void> {
  await page.keyboard.press("Backspace");
}

export async function selectAllAndDelete(page: Page): Promise<void> {
  await selectAllInEditor(page);
  await deleteSelection(page);
}

export async function reloadEditor(page: Page): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForEditorReady(page);
}

export async function assertEditorBooted(page: Page): Promise<void> {
  await expect(page.getByText(BOOT_LOADER_TEXT, { exact: false })).toBeHidden({ timeout: 120_000 });
}

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

export async function getTopLevelBlockTexts(page: Page): Promise<string[]> {
  return page.locator(EDITOR_SELECTOR).first().evaluate((editor) => {
    return Array.from(editor.children).map((element) =>
      (element as HTMLElement).innerText.replace(/\u00b7/g, "\n").trim(),
    );
  });
}

export async function dragBlockToGap(
  page: Page,
  sourceIndex: number,
  targetGapIndex: number,
): Promise<void> {
  const editor = page.locator(EDITOR_SELECTOR).first();
  await editor.waitFor({ state: "visible" });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const blocks = editor.locator(":scope > *");
    const blockCount = await blocks.count();
    if (sourceIndex < 0 || sourceIndex >= blockCount) {
      throw new Error(`drag sourceIndex ${sourceIndex} 超出块数 ${blockCount}`);
    }

    const sourceBlock = blocks.nth(sourceIndex);
    try {
      await sourceBlock.scrollIntoViewIfNeeded({ timeout: 5000 });
      const sourceBox = await sourceBlock.boundingBox();
      if (!sourceBox) {
        throw new Error(`无法定位源块 index=${sourceIndex}`);
      }

      const hoverX = sourceBox.x + Math.min(24, sourceBox.width / 2);
      const hoverY = sourceBox.y + sourceBox.height / 2;
      await page.mouse.move(hoverX, hoverY);
      await page.waitForTimeout(80);
      await page.evaluate(
        ({ x, y }) => {
          const wrapper = document.querySelector(".tiptap-editor-wrapper");
          wrapper?.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              clientX: x,
              clientY: y,
            }),
          );
        },
        { x: hoverX, y: hoverY },
      );
      await page.waitForTimeout(120);

      const handle = page.locator(".block-handle-wrapper .block-handle__btn").first();
      for (let hoverAttempt = 0; hoverAttempt < 6; hoverAttempt += 1) {
        if (await handle.isVisible().catch(() => false)) break;
        await page.mouse.move(hoverX, hoverY, { steps: 2 });
        await page.waitForTimeout(100);
      }
      await handle.waitFor({ state: "visible", timeout: 15_000 });

      const handleBox = await handle.boundingBox();
      if (!handleBox) {
        throw new Error("块拖拽手柄不可见");
      }

      let targetY: number;
      if (targetGapIndex <= 0) {
        const firstBox = await blocks.nth(0).boundingBox();
        if (!firstBox) throw new Error("无法定位首块");
        targetY = firstBox.y - 4;
      } else if (targetGapIndex >= blockCount) {
        const lastBox = await blocks.nth(blockCount - 1).boundingBox();
        if (!lastBox) throw new Error("无法定位末块");
        targetY = lastBox.y + lastBox.height + 4;
      } else {
        const targetBox = await blocks.nth(targetGapIndex).boundingBox();
        if (!targetBox) throw new Error(`无法定位目标 gap ${targetGapIndex}`);
        targetY = targetBox.y - 4;
      }

      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX, startY - 24, { steps: 6 });
      await page.mouse.move(startX, targetY, { steps: 16 });
      await page.waitForTimeout(120);
      await page.mouse.up();
      await page.waitForTimeout(300);
      await page.mouse.move(8, 8);
      await page.waitForTimeout(80);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(300);
    }
  }
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

export async function waitForEditorText(
  page: Page,
  expected: string,
  timeoutMs = 120_000,
): Promise<void> {
  await expect
    .poll(async () => (await getEditorPlainText(page)).includes(expected), {
      timeout: timeoutMs,
    })
    .toBe(true);
}

export async function assertEditorBooted(page: Page): Promise<void> {
  await expect(page.getByText(BOOT_LOADER_TEXT, { exact: false })).toBeHidden({ timeout: 120_000 });
}

import { API_BASE, fetchEditContentSnapshot, flattenTopLevelBlockTexts } from "../helpers/api";
import { EDITOR_SELECTOR, countTopLevelBlocks, reloadEditor, waitForEditorReady } from "../helpers/editor";
import { waitForDraftSynced, waitForSyncIdle } from "../helpers/sync";
import { expect, test } from "../fixtures/sync-fixture";

/**
 * 大文档懒加载：edit-content 默认单页 1000 块。
 * 之前前端只读取第一页，超过 1000 块的文档会被截断，且同步引擎会把未加载的块当作已删除。
 */

const BLOCK_COUNT = 2500;

async function api<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as { success: boolean; data: T; message?: string };
  if (!payload.success) throw new Error(`${method} ${path} failed: ${JSON.stringify(payload).slice(0, 300)}`);
  return payload.data;
}

function sortKeyAt(index: number): string {
  return `a${String(index).padStart(5, "0")}`;
}

test("超过单页上限的大文档应完整加载，编辑后服务端块不丢失", async ({ page, authSession, syncDocument }) => {
  test.setTimeout(600_000);
  const token = authSession.accessToken;
  const { docId, rootBlockId } = syncDocument;

  // 通过 batch API 预置大文档（编辑器页面已打开，先关闭以免占用会话）
  await page.goto("about:blank");
  let editContent = await api<{
    head: number;
    draft: { draftRevision?: number | null };
    syncSession: { sessionId: string; sessionEpoch: number };
  }>("GET", `/documents/${docId}/edit-content`, token);
  let draftRevision = editContent.draft.draftRevision ?? 0;
  for (let start = 0; start < BLOCK_COUNT; start += 100) {
    const operations = [];
    for (let index = start; index < Math.min(BLOCK_COUNT, start + 100); index += 1) {
      operations.push({
        type: "create",
        clientId: `seed_${index}`,
        syncCreateId: `sync-create:seed_${index}`,
        data: {
          docId,
          type: "paragraph",
          parentId: rootBlockId,
          sortKey: sortKeyAt(index),
          payload: { type: "paragraph", attrs: {}, content: [{ type: "text", text: `big block ${index}` }] },
        },
      });
    }
    const response = await api<{ draftRevision: number }>("POST", "/blocks/batch", token, {
      docId,
      baseVersion: editContent.head,
      draftRevision,
      clientBatchId: `seed_${start}_${Date.now()}`,
      sessionId: editContent.syncSession.sessionId,
      sessionEpoch: editContent.syncSession.sessionEpoch,
      operations,
    });
    draftRevision = response.draftRevision;
  }

  await page.goto(syncDocument.editPath, { waitUntil: "domcontentloaded" });
  await waitForEditorReady(page);
  await expect.poll(() => countTopLevelBlocks(page), { timeout: 120_000 }).toBe(BLOCK_COUNT);
  await waitForSyncIdle(page, { timeoutMs: 120_000 });

  // 在末尾块追加文字（最后一页的块）
  const last = page.locator(EDITOR_SELECTOR).first().locator(":scope > *").last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" edited-tail");
  await waitForDraftSynced(page, { timeoutMs: 120_000 });
  await waitForSyncIdle(page, { timeoutMs: 120_000, stableMs: 3000 });

  const server = await fetchEditContentSnapshot(authSession, docId);
  // 第一页之外的块也必须仍然存在（fetchEditContentSnapshot 只取第一页，这里改用 limit=10000）
  const full = await api<{ tree: { children?: Array<{ payload?: { content?: Array<{ text?: string }> } }> } }>(
    "GET",
    `/documents/${docId}/edit-content?limit=10000`,
    token,
  );
  const texts = (full.tree.children ?? []).map((child) =>
    (child.payload?.content ?? []).map((item) => item.text ?? "").join(""),
  );
  expect(texts).toHaveLength(BLOCK_COUNT);
  expect(texts[BLOCK_COUNT - 1]).toBe(`big block ${BLOCK_COUNT - 1} edited-tail`);
  expect(flattenTopLevelBlockTexts(server.tree).length).toBeGreaterThan(0);

  await reloadEditor(page);
  await expect.poll(() => countTopLevelBlocks(page), { timeout: 120_000 }).toBe(BLOCK_COUNT);
});

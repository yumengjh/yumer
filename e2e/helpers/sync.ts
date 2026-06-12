import { expect, type Page } from "@playwright/test";
import { SYNC_STATUS_SELECTOR } from "./editor";

const SYNC_DEBUG_ENABLED_KEY = "sync-debug-log-enabled";
const SYNC_TRACE_KEY = "sync-trace-log";
const SYNC_BATCH_KEY = "sync-debug-log";
const SYNC_INCIDENT_KEY = "sync-debug-incidents";

export type SyncDebugSnapshot = {
  traces: Array<{ event: string; payload?: Record<string, unknown> }>;
  batches: Array<{ success?: boolean; operationCount?: number }>;
  incidents: unknown[];
};

export async function seedSyncDebugStorage(page: Page): Promise<void> {
  await page.addInitScript((enabledKey) => {
    localStorage.setItem(enabledKey, "true");
    sessionStorage.removeItem("sync-trace-log");
    sessionStorage.removeItem("sync-debug-log");
    sessionStorage.removeItem("sync-debug-incidents");
  }, SYNC_DEBUG_ENABLED_KEY);
}

async function waitForStableStatus(
  page: Page,
  timeoutMs: number,
  stableMs: number,
  allowedPattern: RegExp,
): Promise<void> {
  const status = page.locator(SYNC_STATUS_SELECTOR);
  await expect(status).toHaveText(allowedPattern, { timeout: timeoutMs });

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = (await status.textContent()) ?? "";
    if (/同步中|未同步|保存失败/.test(text)) {
      await page.waitForTimeout(200);
      continue;
    }
    if (!allowedPattern.test(text)) {
      await page.waitForTimeout(200);
      continue;
    }
    await page.waitForTimeout(stableMs);
    const nextText = (await status.textContent()) ?? "";
    if (!/同步中|未同步|保存失败/.test(nextText) && allowedPattern.test(nextText)) {
      return;
    }
  }

  throw new Error(`同步未在 ${timeoutMs}ms 内稳定，当前状态: ${await status.textContent()}`);
}

/** 页面刚打开、尚未编辑时使用 */
export async function waitForSyncIdle(
  page: Page,
  options: { timeoutMs?: number; stableMs?: number } = {},
): Promise<void> {
  await waitForStableStatus(
    page,
    options.timeoutMs ?? 45_000,
    options.stableMs ?? 800,
    /已同步至草稿|已加载最新版本|已保存为最新版本|没有草稿需要保存/,
  );
}

/** 编辑内容后等待草稿同步：UI 状态或 sync debug batch 成功均可 */
export async function waitForDraftSynced(
  page: Page,
  options: { timeoutMs?: number; stableMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const stableMs = options.stableMs ?? 800;
  const status = page.locator(SYNC_STATUS_SELECTOR);
  const initialBatchCount = (await readSyncDebugSnapshot(page)).batches.length;
  const startedAt = Date.now();
  let sawDirtyOrFlushing = false;

  while (Date.now() - startedAt < timeoutMs) {
    const text = (await status.textContent()) ?? "";
    if (/未同步|同步中/.test(text)) {
      sawDirtyOrFlushing = true;
    }

    if (/已同步至草稿|已保存为最新版本/.test(text)) {
      await page.waitForTimeout(stableMs);
      return;
    }

    const debug = await readSyncDebugSnapshot(page);
    const newSuccessfulBatch = debug.batches
      .slice(initialBatchCount)
      .some((batch) => batch.success);
    if (
      newSuccessfulBatch &&
      (sawDirtyOrFlushing || initialBatchCount === 0) &&
      !/同步中|未同步|保存失败/.test(text)
    ) {
      await page.waitForTimeout(stableMs);
      return;
    }

    await page.waitForTimeout(300);
  }

  throw new Error(`草稿未同步，当前状态: ${await status.textContent()}`);
}

export async function waitForManifestReconcile(page: Page, timeoutMs = 90_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const debug = await readSyncDebugSnapshot(page);
    if (debug.traces.some((trace) => trace.event === "manifest:reconcile-response")) {
      return;
    }
    await page.waitForTimeout(400);
  }
}

export async function readSyncDebugSnapshot(page: Page): Promise<SyncDebugSnapshot> {
  return page.evaluate(
    ({ traceKey, batchKey, incidentKey }) => {
      const parse = <T,>(key: string): T[] => {
        const raw = sessionStorage.getItem(key);
        if (!raw) return [];
        try {
          return JSON.parse(raw) as T[];
        } catch {
          return [];
        }
      };

      return {
        traces: parse<{ event: string; payload?: Record<string, unknown> }>(traceKey),
        batches: parse<{ success?: boolean; operationCount?: number }>(batchKey),
        incidents: parse<unknown>(incidentKey),
      };
    },
    {
      traceKey: SYNC_TRACE_KEY,
      batchKey: SYNC_BATCH_KEY,
      incidentKey: SYNC_INCIDENT_KEY,
    },
  );
}

export async function assertNoSyncIncidents(page: Page): Promise<void> {
  const debug = await readSyncDebugSnapshot(page);
  expect(debug.incidents, "同步异常 incident 应为空").toEqual([]);
}

export async function assertNoResurrectedBlocks(page: Page): Promise<void> {
  const debug = await readSyncDebugSnapshot(page);
  const resurrected = debug.traces.filter((trace) => trace.event === "identity:resurrected");
  expect(resurrected, "不应出现 identity:resurrected").toEqual([]);
}

export async function assertNoDuplicateCreateStorm(page: Page, maxBatchRequests = 80): Promise<void> {
  const debug = await readSyncDebugSnapshot(page);
  const dispatches = debug.traces.filter((trace) => trace.event === "flush:dispatch");
  expect(
    dispatches.length,
    `batch 请求次数过多 (${dispatches.length})，可能存在请求风暴`,
  ).toBeLessThanOrEqual(maxBatchRequests);
}

export async function waitForAtLeastOneSuccessfulBatch(page: Page, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const debug = await readSyncDebugSnapshot(page);
    if (debug.batches.some((batch) => batch.success)) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("未观察到成功的 sync batch ACK");
}

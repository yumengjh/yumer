import { test as base, expect, type TestInfo } from "@playwright/test";
import {
  createE2EDocument,
  registerE2EUser,
  type E2EAuthSession,
  type E2EDocument,
} from "../helpers/api";
import { waitForEditorReady } from "../helpers/editor";
import { seedSyncDebugStorage } from "../helpers/sync";

type SyncFixtures = {
  authSession: E2EAuthSession;
  syncDocument: E2EDocument;
};

async function openAuthenticatedEditor(
  page: import("@playwright/test").Page,
  authSession: E2EAuthSession,
  editPath: string,
): Promise<void> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await seedSyncDebugStorage(page);

  // 在页面加载前注入 JWT，浏览器内 API 请求会自动带 Bearer token（见 api-client.ts）
  await page.addInitScript(
    ({ accessToken, refreshToken, workspaceId }) => {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("currentWorkspaceId", workspaceId);
      localStorage.setItem(
        "yuediter:editor-sync-preferences",
        JSON.stringify({ documentSyncDelayMs: 300, autoRememberEditPosition: true }),
      );
    },
    {
      accessToken: authSession.accessToken,
      refreshToken: authSession.refreshToken,
      workspaceId: authSession.workspaceId,
    },
  );

  try {
    await page.goto(editPath, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("load", { timeout: 60_000 }).catch(() => {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(message)) {
      throw new Error(
        [
          "无法连接前端 http://localhost:3001 。",
          "请先运行 pnpm dev，或取消 PLAYWRIGHT_SKIP_WEBSERVER 让 Playwright 自动启动。",
          "（API 鉴权已通过 fixture 注入 token，不是登录问题。）",
        ].join("\n"),
      );
    }
    throw error;
  }

  // SetupModal 在 token + workspace 有效时不应出现
  await expect(page.getByRole("button", { name: "登录" })).toBeHidden({ timeout: 30_000 });
  await waitForEditorReady(page);
}

export const test = base.extend<SyncFixtures>({
  authSession: async ({}, use, testInfo: TestInfo) => {
    if (process.env.PLAYWRIGHT_BACKEND_UNAVAILABLE === "1") {
      testInfo.skip(true, "后端 API 不可用，跳过 sync E2E");
      return;
    }
    if (process.env.PLAYWRIGHT_FRONTEND_UNAVAILABLE === "1") {
      testInfo.skip(true, "前端 dev server 不可用，跳过 sync E2E");
      return;
    }

    const session = await registerE2EUser();
    await use(session);
  },

  syncDocument: async ({ page, authSession }, use) => {
    const document = await createE2EDocument(authSession);
    await openAuthenticatedEditor(page, authSession, document.editPath);
    await use(document);
  },
});

export { expect };

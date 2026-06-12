import { chromium, type FullConfig } from "@playwright/test";

const apiBase = process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:5200/api/v1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";

async function probeUrl(url: string, timeoutMs = 15_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status < 500) {
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function probeBackend(): Promise<boolean> {
  for (const path of ["/health", "/auth/me"]) {
    if (await probeUrl(`${apiBase}${path}`)) {
      return true;
    }
  }
  return false;
}

async function prewarmEditorBundle(): Promise<void> {
  if (process.env.PLAYWRIGHT_SKIP_PREWARM === "1") {
    return;
  }

  console.log("[e2e] 预热 Next.js 编辑器 bundle（dev 首次编译可能较慢）…");
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL as "chrome" | "msedge" | undefined,
  });
  const page = await browser.newPage();

  try {
    await page.goto(`${baseURL}/dash`, {
      waitUntil: "domcontentloaded",
      timeout: 240_000,
    });
    await page
      .getByText("正在打开编辑器…")
      .waitFor({ state: "hidden", timeout: 240_000 })
      .catch(() => {
        // 预热失败不阻断；单测里仍会重试
      });
  } catch (error) {
    console.warn(
      "[e2e] 编辑器 bundle 预热超时或失败，将继续执行测试（用例内会重试）:",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const backendReady = await probeBackend();
  if (!backendReady) {
    console.warn(
      [
        "[e2e] 后端 API 不可达:",
        apiBase,
        "请先启动 yumer-server（pnpm dev），再运行 pnpm test:e2e:sync。",
        "若服务已在其他地址，请设置 PLAYWRIGHT_API_BASE。",
      ].join("\n"),
    );
    process.env.PLAYWRIGHT_BACKEND_UNAVAILABLE = "1";
    return;
  }
  process.env.PLAYWRIGHT_BACKEND_UNAVAILABLE = "0";

  const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";
  const frontendReady = await probeUrl(`${baseURL}/dash`, skipWebServer ? 60_000 : 15_000);
  if (!frontendReady) {
    if (skipWebServer) {
      console.warn(
        [
          "[e2e] 前端不可达:",
          `${baseURL}/dash`,
          "当前 PLAYWRIGHT_SKIP_WEBSERVER=1，Playwright 不会自动启动 next dev。",
          "请任选其一：",
          "  1) 另一终端运行: pnpm dev",
          "  2) 取消环境变量: Remove-Item Env:PLAYWRIGHT_SKIP_WEBSERVER",
          "  3) 直接运行 pnpm test:e2e:sync（默认会自动启动前端）",
        ].join("\n"),
      );
      process.env.PLAYWRIGHT_FRONTEND_UNAVAILABLE = "1";
      return;
    }
    console.log("[e2e] 等待 Playwright 自动启动前端…");
  }

  process.env.PLAYWRIGHT_FRONTEND_UNAVAILABLE = "0";

  if (frontendReady || !skipWebServer) {
    await prewarmEditorBundle();
  }
}

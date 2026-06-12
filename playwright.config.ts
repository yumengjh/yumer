import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
const apiBase = process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:5200/api/v1";
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";

if (skipWebServer) {
  console.warn(
    "[e2e] PLAYWRIGHT_SKIP_WEBSERVER=1：不会自动启动前端。请先在另一终端运行 pnpm dev，或取消该环境变量。",
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 45_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL as "chrome" | "msedge" }
          : {}),
      },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: "pnpm run dev:webpack",
        url: `${baseURL}/dash`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          NEXT_PUBLIC_API_BASE: apiBase,
          NEXT_PUBLIC_SYNC_ENGINE_ENABLED: "true",
        },
      },
});
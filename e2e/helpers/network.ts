import type { Page, Route } from "@playwright/test";

export type DelayedRouteOptions = {
  urlPattern: string | RegExp;
  delayMs: number;
  abortRate?: number;
};

export async function withDelayedRoute(
  page: Page,
  options: DelayedRouteOptions,
  action: () => Promise<void>,
): Promise<void> {
  const handler = async (route: Route) => {
    if (options.abortRate && Math.random() < options.abortRate) {
      await route.abort("failed");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    await route.continue();
  };

  await page.route(options.urlPattern, handler);
  try {
    await action();
  } finally {
    await page.unroute(options.urlPattern, handler);
  }
}

export async function delaySyncBatchRequests(
  page: Page,
  delayMs: number,
  action: () => Promise<void>,
): Promise<void> {
  await withDelayedRoute(
    page,
    {
      urlPattern: "**/blocks/batch**",
      delayMs,
    },
    action,
  );
}

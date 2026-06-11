const CLIENT_INSTANCE_ID_KEY = "yuediter.clientInstanceId";
const BROWSER_TAB_ID_KEY = "yuediter.browserTabId";

let cachedClientInstanceId: string | null = null;
let cachedBrowserTabId: string | null = null;

function createBrowserId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}

function getOrCreateStorageId(
  storage: Storage | null,
  key: string,
  prefix: string,
): string {
  if (!storage) return createBrowserId(prefix);
  const next = createBrowserId(prefix);
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    storage.setItem(key, next);
  } catch {
    return next;
  }
  return next;
}

export function getClientInstanceId(): string {
  if (cachedClientInstanceId) return cachedClientInstanceId;
  cachedClientInstanceId =
    typeof window === "undefined"
      ? createBrowserId("client")
      : getOrCreateStorageId(window.localStorage, CLIENT_INSTANCE_ID_KEY, "client");
  return cachedClientInstanceId;
}

export function getBrowserTabId(): string {
  if (cachedBrowserTabId) return cachedBrowserTabId;
  cachedBrowserTabId =
    typeof window === "undefined"
      ? createBrowserId("tab")
      : getOrCreateStorageId(window.sessionStorage, BROWSER_TAB_ID_KEY, "tab");
  return cachedBrowserTabId;
}

export function getRealtimeOriginIdentity(): {
  originClientId: string;
  originTabId: string;
} {
  return {
    originClientId: getClientInstanceId(),
    originTabId: getBrowserTabId(),
  };
}

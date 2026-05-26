export const BASE_URL = process.env.NEXT_PUBLIC_API_BASE || "https://api-zzz.yumgjs.com/api/v1";
// const BASE_URL = "https://api-zzz.yumgjs.com/api/v1";

export function resolveApiUrl(path: string): string {
  try {
    return new URL(path).toString();
  } catch {
    const base = BASE_URL.replace(/\/$/, "");
    const apiPrefix = new URL(`${base}/`).pathname.replace(/\/$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const suffix = apiPrefix && normalizedPath.startsWith(`${apiPrefix}/`)
      ? normalizedPath.slice(apiPrefix.length)
      : normalizedPath;
    return `${base}${suffix}`;
  }
}

const ACCESS_TOKEN_KEY = "accessToken";
const REFRESH_TOKEN_KEY = "refreshToken";

// Token 互斥锁，防止并发刷新
let refreshPromise: Promise<boolean> | null = null;

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function storeTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await response.json();
    if (data.success) {
      storeTokens(data.data.accessToken, data.data.refreshToken);
      return true;
    }
    clearTokens();
    return false;
  } catch {
    clearTokens();
    return false;
  }
}

async function refreshTokenOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string | string[] };
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(options.headers as Record<string, string>),
  };

  let response = await fetch(resolveApiUrl(path), { ...options, headers });

  if (response.status === 401) {
    const refreshed = await refreshTokenOnce();
    if (refreshed) {
      const newToken = getAccessToken();
      response = await fetch(resolveApiUrl(path), {
        ...options,
        headers: {
          ...(newToken && { Authorization: `Bearer ${newToken}` }),
          ...(options.headers as Record<string, string>),
        },
      });
    } else {
      throw new Error("认证已过期，请重新登录");
    }
  }

  return response;
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });

  const result: ApiResponse<T> = await response.json();

  if (!result.success) {
    const msg = Array.isArray(result.error?.message)
      ? result.error!.message.join(", ")
      : result.error?.message || "请求失败";
    throw new Error(msg);
  }

  return result.data;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPostForm<T>(path: string, body: FormData): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  let response = await fetch(resolveApiUrl(path), {
    method: "POST",
    headers,
    body,
  });

  if (response.status === 401) {
    const refreshed = await refreshTokenOnce();
    if (refreshed) {
      const newToken = getAccessToken();
      response = await fetch(resolveApiUrl(path), {
        method: "POST",
        headers: {
          ...(newToken && { Authorization: `Bearer ${newToken}` }),
        },
        body,
      });
    } else {
      throw new Error("认证已过期，请重新登录");
    }
  }

  const result: ApiResponse<T> = await response.json();

  if (!response.ok || !result.success) {
    const msg = Array.isArray(result.error?.message)
      ? result.error!.message.join(", ")
      : result.error?.message || "请求失败";
    throw new Error(msg);
  }

  return result.data;
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE" });
}

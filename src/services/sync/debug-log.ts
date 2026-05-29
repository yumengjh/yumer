import type { SyncBatchResponse } from "./api";

const STORAGE_KEY = "sync-debug-log";
const ENABLED_KEY = "sync-debug-log-enabled";
const MAX_RECORDS = 200;

export type SyncDebugRecord = {
  id: string;
  timestamp: number;
  source: string;
  docId: string;
  baseVersion: number;
  clientBatchId: string;
  operationCount: number;
  /** 完整请求体 */
  requestBody: unknown;
  /** 成功时的完整响应 */
  responseBody?: SyncBatchResponse;
  /** 失败时的错误信息 */
  error?: string;
  /** 耗时(ms) */
  duration: number;
  success: boolean;
};

function loadRecords(): SyncDebugRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecords(records: SyncDebugRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // sessionStorage 可能已满，忽略
  }
}

export const SyncDebugLog = {
  isEnabled(): boolean {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(ENABLED_KEY) === "true";
  },

  setEnabled(enabled: boolean): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(ENABLED_KEY, String(enabled));
  },

  add(record: SyncDebugRecord): void {
    if (!this.isEnabled()) return;
    const records = loadRecords();
    records.push(record);
    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
    }
    saveRecords(records);
  },

  getAll(): SyncDebugRecord[] {
    return loadRecords();
  },

  clear(): void {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(STORAGE_KEY);
  },

  formatAll(): string {
    return JSON.stringify(loadRecords(), null, 2);
  },
};

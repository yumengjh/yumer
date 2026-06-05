import type { SyncBatchResponse } from "./api";

const STORAGE_KEY = "sync-debug-log";
const ENABLED_KEY = "sync-debug-log-enabled";
const MAX_RECORDS = 200;

const TRACE_STORAGE_KEY = "sync-trace-log";
const TRACE_MAX_RECORDS = 800;
const TRACE_SCHEMA_VERSION = 1;

export type SyncTraceEvent =
  | "snapshot:advance"
  | "queue:before-select"
  | "flush:dispatch"
  | "flush:response"
  | "orphaned-create:delete-enqueued"
  | "ack:patch"
  | "idle:manifest"
  | "editor:ack-merged"
  | "manifest:reconcile"
  | "manifest:reconcile-response";

export type ManifestNodeSummary = {
  index: number;
  type: string;
  clientId: string | null;
  blockId: string | null;
  syncCreateId: string | null;
  sortKey: string | null;
  textPreview: string;
  contentHash: string;
};

export type SyncTraceRecord = {
  schemaVersion: number;
  traceId: string;
  timestamp: number;
  docId: string;
  sessionId: string | null;
  sessionEpoch: number | null;
  event: SyncTraceEvent;
  payload: Record<string, unknown>;
};

function loadTraceRecords(): SyncTraceRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(TRACE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTraceRecords(records: SyncTraceRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // sessionStorage 可能已满，忽略
  }
}

let traceCounter = 0;

function createTraceId(): string {
  traceCounter += 1;
  return `tr_${Date.now().toString(36)}_${traceCounter}`;
}

function computeContentHash(content: unknown): string {
  const text = JSON.stringify(content);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

export function buildManifestSummary(
  doc: { type: string; content?: unknown[] } | null,
  maxTextPreview = 60,
): ManifestNodeSummary[] {
  if (!doc || !Array.isArray(doc.content)) return [];
  return (doc.content as Array<Record<string, unknown>>).map((node, index) => {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    const clientId =
      typeof attrs.clientId === "string"
        ? attrs.clientId
        : typeof attrs["data-client-id"] === "string"
          ? (attrs["data-client-id"] as string)
          : null;
    const blockId =
      typeof attrs.blockId === "string"
        ? attrs.blockId
        : typeof attrs["data-block-id"] === "string"
          ? (attrs["data-block-id"] as string)
          : null;
    const syncCreateId =
      typeof attrs.syncCreateId === "string"
        ? attrs.syncCreateId
        : typeof attrs["data-sync-create-id"] === "string"
          ? (attrs["data-sync-create-id"] as string)
          : null;
    const sortKey =
      typeof attrs.sortKey === "string"
        ? attrs.sortKey
        : typeof attrs["data-sort-key"] === "string"
          ? (attrs["data-sort-key"] as string)
          : null;

    let textPreview = "";
    const content = node.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const child of content) {
        if (typeof child.text === "string") {
          textPreview = child.text.slice(0, maxTextPreview);
          break;
        }
        const nested = child.content as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(nested)) {
          for (const nc of nested) {
            if (typeof nc.text === "string") {
              textPreview = nc.text.slice(0, maxTextPreview);
              break;
            }
          }
          if (textPreview) break;
        }
      }
    }

    return {
      index,
      type: typeof node.type === "string" ? node.type : "unknown",
      clientId,
      blockId,
      syncCreateId,
      sortKey,
      textPreview,
      contentHash: computeContentHash(node),
    };
  });
}

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

export const SyncTraceLog = {
  isEnabled(): boolean {
    return SyncDebugLog.isEnabled();
  },

  add(
    event: SyncTraceEvent,
    docId: string,
    sessionId: string | null,
    sessionEpoch: number | null,
    payload: Record<string, unknown>,
  ): void {
    if (!this.isEnabled()) return;
    const records = loadTraceRecords();
    records.push({
      schemaVersion: TRACE_SCHEMA_VERSION,
      traceId: createTraceId(),
      timestamp: Date.now(),
      docId,
      sessionId,
      sessionEpoch,
      event,
      payload,
    });
    if (records.length > TRACE_MAX_RECORDS) {
      records.splice(0, records.length - TRACE_MAX_RECORDS);
    }
    saveTraceRecords(records);
  },

  getAll(): SyncTraceRecord[] {
    return loadTraceRecords();
  },

  clear(): void {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(TRACE_STORAGE_KEY);
  },

  exportBundle(): string {
    return JSON.stringify(
      {
        schemaVersion: TRACE_SCHEMA_VERSION,
        exportedAt: Date.now(),
        batchLog: loadRecords(),
        traceLog: loadTraceRecords(),
      },
      null,
      2,
    );
  },
};

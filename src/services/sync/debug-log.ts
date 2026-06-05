import type { SyncBatchResponse } from "./api";

const STORAGE_KEY = "sync-debug-log";
const ENABLED_KEY = "sync-debug-log-enabled";
const MAX_RECORDS = 200;

const TRACE_STORAGE_KEY = "sync-trace-log";
const TRACE_MAX_RECORDS = 800;
const TRACE_SCHEMA_VERSION = 2;

const DELETED_IDENTITY_STORAGE_KEY = "sync-deleted-identity-watch";
const INCIDENT_STORAGE_KEY = "sync-debug-incidents";
const MAX_DELETED_IDENTITIES = 500;
const MAX_INCIDENTS = 200;

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
  | "manifest:reconcile-response"
  | "identity:resurrected"
  | "debug:bookmark";

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

export type SyncIdentity = {
  blockId?: string | null;
  clientId?: string | null;
  syncCreateId?: string | null;
};

export type DeletedIdentityReason =
  | "batch-delete-request"
  | "batch-delete-ack"
  | "manifest-reconcile-tombstone";

export type DeletedIdentityWatchRecord = {
  id: string;
  timestamp: number;
  docId: string;
  reason: DeletedIdentityReason;
  clientBatchId?: string | null;
  identity: Required<SyncIdentity>;
  identityKeys: string[];
  evidence?: Record<string, unknown>;
};

export type SyncDebugIncident = {
  id: string;
  timestamp: number;
  docId: string;
  type: "deleted-identity-visible";
  severity: "warning";
  message: string;
  identity: Required<SyncIdentity>;
  identityKeys: string[];
  deletedAt: number;
  deletedReason: DeletedIdentityReason;
  observedEvent: SyncTraceEvent;
  observedTraceId: string;
  observedNode?: ManifestNodeSummary;
  evidence?: Record<string, unknown>;
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

function loadDeletedIdentityRecords(): DeletedIdentityWatchRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(DELETED_IDENTITY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDeletedIdentityRecords(records: DeletedIdentityWatchRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(DELETED_IDENTITY_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // sessionStorage 可能已满，忽略
  }
}

function loadIncidentRecords(): SyncDebugIncident[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(INCIDENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveIncidentRecords(records: SyncDebugIncident[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(INCIDENT_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // sessionStorage 可能已满，忽略
  }
}

let traceCounter = 0;

function createTraceId(): string {
  traceCounter += 1;
  return `tr_${Date.now().toString(36)}_${traceCounter}`;
}

function createRecordId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeIdentity(identity: SyncIdentity): Required<SyncIdentity> {
  return {
    blockId: identity.blockId ?? null,
    clientId: identity.clientId ?? null,
    syncCreateId: identity.syncCreateId ?? null,
  };
}

function getIdentityKeys(identity: SyncIdentity): string[] {
  const normalized = normalizeIdentity(identity);
  return [
    normalized.blockId ? `blockId:${normalized.blockId}` : null,
    normalized.clientId ? `clientId:${normalized.clientId}` : null,
    normalized.syncCreateId ? `syncCreateId:${normalized.syncCreateId}` : null,
  ].filter((value): value is string => Boolean(value));
}

function hasSharedIdentityKey(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  return left.some((key) => rightSet.has(key));
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

function isManifestNodeSummary(value: unknown): value is ManifestNodeSummary {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<ManifestNodeSummary>;
  return (
    typeof node.index === "number" &&
    typeof node.type === "string" &&
    typeof node.contentHash === "string"
  );
}

function readManifestFromTracePayload(payload: Record<string, unknown>): ManifestNodeSummary[] {
  const candidates = [
    payload.manifest,
    payload.nextManifest,
    payload.beforeManifest,
    payload.afterManifest,
  ];
  return candidates.flatMap((candidate) =>
    Array.isArray(candidate) && candidate.every(isManifestNodeSummary) ? candidate : [],
  );
}

export const SyncIdentityWatch = {
  markDeleted(input: {
    docId: string;
    reason: DeletedIdentityReason;
    identities: SyncIdentity[];
    clientBatchId?: string | null;
    evidence?: Record<string, unknown>;
  }): void {
    if (!SyncDebugLog.isEnabled()) return;
    const records = loadDeletedIdentityRecords();
    let changed = false;

    for (const identity of input.identities) {
      const normalized = normalizeIdentity(identity);
      const identityKeys = getIdentityKeys(normalized);
      if (identityKeys.length === 0) continue;

      const duplicate = records.some(
        (record) =>
          record.docId === input.docId &&
          hasSharedIdentityKey(record.identityKeys, identityKeys) &&
          record.reason === input.reason &&
          (record.clientBatchId ?? null) === (input.clientBatchId ?? null),
      );
      if (duplicate) continue;

      records.push({
        id: createRecordId("deleted_identity"),
        timestamp: Date.now(),
        docId: input.docId,
        reason: input.reason,
        clientBatchId: input.clientBatchId ?? null,
        identity: normalized,
        identityKeys,
        evidence: input.evidence,
      });
      changed = true;
    }

    if (!changed) return;
    if (records.length > MAX_DELETED_IDENTITIES) {
      records.splice(0, records.length - MAX_DELETED_IDENTITIES);
    }
    saveDeletedIdentityRecords(records);
  },

  observeTraceRecord(record: SyncTraceRecord): SyncDebugIncident[] {
    if (!SyncDebugLog.isEnabled()) return [];
    if (record.event === "identity:resurrected") return [];
    const manifest = readManifestFromTracePayload(record.payload);
    if (manifest.length === 0) return [];

    const watches = loadDeletedIdentityRecords().filter((item) => item.docId === record.docId);
    if (watches.length === 0) return [];

    const existingIncidents = loadIncidentRecords();
    const nextIncidents = [...existingIncidents];
    const created: SyncDebugIncident[] = [];

    for (const node of manifest) {
      const nodeIdentity = {
        blockId: node.blockId,
        clientId: node.clientId,
        syncCreateId: node.syncCreateId,
      };
      const nodeKeys = getIdentityKeys(nodeIdentity);
      if (nodeKeys.length === 0) continue;

      for (const watch of watches) {
        if (!hasSharedIdentityKey(watch.identityKeys, nodeKeys)) continue;
        const dedupeKey = `${record.traceId}:${watch.id}:${node.index}:${node.contentHash}`;
        if (nextIncidents.some((incident) => incident.id === dedupeKey)) continue;

        const incident: SyncDebugIncident = {
          id: dedupeKey,
          timestamp: Date.now(),
          docId: record.docId,
          type: "deleted-identity-visible",
          severity: "warning",
          message: "已删除的同步身份再次出现在前端快照中",
          identity: watch.identity,
          identityKeys: watch.identityKeys,
          deletedAt: watch.timestamp,
          deletedReason: watch.reason,
          observedEvent: record.event,
          observedTraceId: record.traceId,
          observedNode: node,
          evidence: {
            watchedIdentity: watch.evidence ?? null,
            observedPayload: record.payload,
          },
        };
        nextIncidents.push(incident);
        created.push(incident);
      }
    }

    if (created.length === 0) return [];
    if (nextIncidents.length > MAX_INCIDENTS) {
      nextIncidents.splice(0, nextIncidents.length - MAX_INCIDENTS);
    }
    saveIncidentRecords(nextIncidents);
    return created;
  },

  getDeleted(): DeletedIdentityWatchRecord[] {
    return loadDeletedIdentityRecords();
  },

  getIncidents(): SyncDebugIncident[] {
    return loadIncidentRecords();
  },

  clear(): void {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(DELETED_IDENTITY_STORAGE_KEY);
    sessionStorage.removeItem(INCIDENT_STORAGE_KEY);
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
    const record: SyncTraceRecord = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      traceId: createTraceId(),
      timestamp: Date.now(),
      docId,
      sessionId,
      sessionEpoch,
      event,
      payload,
    };
    records.push(record);

    const incidents = SyncIdentityWatch.observeTraceRecord(record);
    incidents.forEach((incident) => {
      records.push({
        schemaVersion: TRACE_SCHEMA_VERSION,
        traceId: createTraceId(),
        timestamp: incident.timestamp,
        docId,
        sessionId,
        sessionEpoch,
        event: "identity:resurrected",
        payload: {
          incidentId: incident.id,
          message: incident.message,
          identity: incident.identity,
          identityKeys: incident.identityKeys,
          deletedAt: incident.deletedAt,
          deletedReason: incident.deletedReason,
          observedEvent: incident.observedEvent,
          observedTraceId: incident.observedTraceId,
          observedNode: incident.observedNode,
        },
      });
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
    SyncIdentityWatch.clear();
  },

  exportBundle(): string {
    return JSON.stringify(
      {
        schemaVersion: TRACE_SCHEMA_VERSION,
        exportedAt: Date.now(),
        page: typeof window === "undefined" ? null : window.location.href,
        userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
        batchLog: loadRecords(),
        traceLog: loadTraceRecords(),
        deletedIdentityWatch: loadDeletedIdentityRecords(),
        incidents: loadIncidentRecords(),
      },
      null,
      2,
    );
  },
};

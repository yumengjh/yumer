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
const AI_TRACE_LIMIT = 120;
const AI_RECENT_TRACE_LIMIT = 40;
const AI_BATCH_LIMIT = 40;
const AI_DELETED_LIMIT = 80;
const AI_INCIDENT_LIMIT = 30;
const AI_MANIFEST_NODE_LIMIT = 20;

export type SyncTraceEvent =
  | "snapshot:advance"
  | "queue:before-select"
  | "flush:dispatch"
  | "flush:response"
  | "flush:retry"
  | "flush:draft-revision-resync"
  | "ack:order-repair"
  | "idle:sort-key-repair"
  | "orphaned-create:delete-enqueued"
  | "ack:patch"
  | "idle:manifest"
  | "editor:ack-merged"
  | "manifest:reconcile"
  | "manifest:reconcile-response"
  | "realtime:connected"
  | "realtime:event"
  | "realtime:error"
  | "remote:applied"
  | "remote:conflict"
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

export type SyncAiDebugBundleOptions = {
  docId?: string | null;
  traceLimit?: number;
  batchLimit?: number;
  deletedLimit?: number;
  incidentLimit?: number;
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

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sameDoc(docId: string | null | undefined, value: { docId: string }): boolean {
  return !docId || value.docId === docId;
}

function summarizeOperation(operation: unknown): Record<string, unknown> {
  const item = toRecord(operation);
  if (!item) return { type: "unknown" };
  const data = toRecord(item.data);
  return {
    type: item.type ?? "unknown",
    blockId: item.blockId ?? null,
    clientId: item.clientId ?? null,
    syncCreateId: item.syncCreateId ?? null,
    parentId: data?.parentId ?? item.parentId ?? null,
    sortKey: data?.sortKey ?? item.sortKey ?? null,
    payloadType: toRecord(data?.payload)?.type ?? null,
    plainTextLength: typeof data?.plainText === "string" ? data.plainText.length : null,
  };
}

function summarizeBatchRequest(requestBody: unknown): Record<string, unknown> {
  const body = toRecord(requestBody);
  if (!body) return { malformed: true };
  const operations = readArray(body.operations);
  const operationCounts = operations.reduce<Record<string, number>>((counts, operation) => {
    const type = String(toRecord(operation)?.type ?? "unknown");
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});

  return {
    docId: body.docId ?? null,
    baseVersion: body.baseVersion ?? null,
    draftRevision: body.draftRevision ?? null,
    clientBatchId: body.clientBatchId ?? null,
    source: body.source ?? null,
    sessionId: body.sessionId ?? null,
    sessionEpoch: body.sessionEpoch ?? null,
    ackedThroughOpSeq: body.ackedThroughOpSeq ?? null,
    operationCount: operations.length,
    operationCounts,
    operations: operations.slice(0, 80).map(summarizeOperation),
    truncatedOperations: Math.max(0, operations.length - 80),
  };
}

function summarizeBatchResponse(responseBody: SyncBatchResponse | undefined): Record<string, unknown> | null {
  if (!responseBody) return null;
  return {
    serverHead: responseBody.serverHead,
    draftRevision: responseBody.draftRevision ?? null,
    ackedThroughOpSeq: responseBody.ackedThroughOpSeq ?? null,
    needsReload: responseBody.needsReload,
    conflicts: responseBody.conflicts,
    resultCount: responseBody.results.length,
    results: responseBody.results.slice(0, 120).map((result) => ({
      operation: result.operation,
      success: result.success,
      clientId: result.clientId ?? null,
      blockId: result.blockId ?? null,
      sortKey: result.sortKey ?? null,
      error: result.error ?? null,
      diagnosticCode: result.diagnosticCode ?? null,
      matchBy: result.matchBy ?? null,
      tombstoned: result.tombstoned ?? false,
    })),
    truncatedResults: Math.max(0, responseBody.results.length - 120),
  };
}

function summarizeBatchRecord(record: SyncDebugRecord): Record<string, unknown> {
  return {
    id: record.id,
    timestamp: record.timestamp,
    source: record.source,
    docId: record.docId,
    baseVersion: record.baseVersion,
    clientBatchId: record.clientBatchId,
    operationCount: record.operationCount,
    duration: record.duration,
    success: record.success,
    request: summarizeBatchRequest(record.requestBody),
    response: summarizeBatchResponse(record.responseBody),
    error: record.error ?? null,
  };
}

function summarizeManifest(manifest: ManifestNodeSummary[]): Record<string, unknown> {
  return {
    count: manifest.length,
    nodes: manifest.slice(0, AI_MANIFEST_NODE_LIMIT),
    truncatedNodes: Math.max(0, manifest.length - AI_MANIFEST_NODE_LIMIT),
  };
}

function summarizeTracePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const manifest = readManifestFromTracePayload(payload);
  const base: Record<string, unknown> = {};
  const scalarKeys = [
    "clientBatchId",
    "acceptedBatchId",
    "baseVersion",
    "draftRevision",
    "ackedThroughOpSeq",
    "needsReload",
    "dirtyOrderLength",
    "entryCount",
    "operationCount",
    "resultCount",
    "prevNodeCount",
    "nextNodeCount",
    "incidentId",
    "message",
    "deletedAt",
    "deletedReason",
    "observedEvent",
    "observedTraceId",
    "eventId",
    "previousDraftRevision",
    "remoteDraftRevision",
    "remoteOperationCount",
  ];
  scalarKeys.forEach((key) => {
    if (payload[key] !== undefined) base[key] = payload[key];
  });

  const arrays = ["operations", "results", "mappings", "deletes", "conflicts", "tombstoned"];
  arrays.forEach((key) => {
    const value = payload[key];
    if (Array.isArray(value)) {
      base[key] = value.slice(0, 80);
      base[`${key}Truncated`] = Math.max(0, value.length - 80);
    }
  });

  if (payload.identity) base.identity = payload.identity;
  if (payload.identityKeys) base.identityKeys = payload.identityKeys;
  if (payload.observedNode) base.observedNode = payload.observedNode;
  if (manifest.length > 0) base.manifest = summarizeManifest(manifest);
  return base;
}

function summarizeTraceRecord(record: SyncTraceRecord): Record<string, unknown> {
  return {
    traceId: record.traceId,
    timestamp: record.timestamp,
    docId: record.docId,
    sessionId: record.sessionId,
    sessionEpoch: record.sessionEpoch,
    event: record.event,
    payload: summarizeTracePayload(record.payload),
  };
}

function summarizeIncident(incident: SyncDebugIncident): Record<string, unknown> {
  return {
    id: incident.id,
    timestamp: incident.timestamp,
    docId: incident.docId,
    type: incident.type,
    severity: incident.severity,
    message: incident.message,
    identity: incident.identity,
    identityKeys: incident.identityKeys,
    deletedAt: incident.deletedAt,
    deletedReason: incident.deletedReason,
    observedEvent: incident.observedEvent,
    observedTraceId: incident.observedTraceId,
    observedNode: incident.observedNode ?? null,
  };
}

function summarizeDeletedIdentity(record: DeletedIdentityWatchRecord): Record<string, unknown> {
  return {
    id: record.id,
    timestamp: record.timestamp,
    docId: record.docId,
    reason: record.reason,
    clientBatchId: record.clientBatchId ?? null,
    identity: record.identity,
    identityKeys: record.identityKeys,
  };
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

  exportAiBundle(options: SyncAiDebugBundleOptions = {}): string {
    const docId = options.docId ?? null;
    const batchLimit = options.batchLimit ?? AI_BATCH_LIMIT;
    const traceLimit = options.traceLimit ?? AI_TRACE_LIMIT;
    const deletedLimit = options.deletedLimit ?? AI_DELETED_LIMIT;
    const incidentLimit = options.incidentLimit ?? AI_INCIDENT_LIMIT;

    const batches = loadRecords().filter((record) => sameDoc(docId, record));
    const traces = loadTraceRecords().filter((record) => sameDoc(docId, record));
    const deleted = loadDeletedIdentityRecords().filter((record) => sameDoc(docId, record));
    const incidents = loadIncidentRecords().filter((record) => sameDoc(docId, record));

    const importantTraceIds = new Set(
      incidents.flatMap((incident) => [incident.observedTraceId]),
    );
    const importantTraceEvents = new Set<SyncTraceEvent>([
      "identity:resurrected",
      "debug:bookmark",
      "flush:dispatch",
      "flush:response",
      "ack:patch",
      "orphaned-create:delete-enqueued",
      "manifest:reconcile",
      "manifest:reconcile-response",
    ]);
    const selectedTraceMap = new Map<string, SyncTraceRecord>();
    traces.slice(-AI_RECENT_TRACE_LIMIT).forEach((record) => {
      selectedTraceMap.set(record.traceId, record);
    });
    traces
      .filter((record) => importantTraceEvents.has(record.event) || importantTraceIds.has(record.traceId))
      .slice(-traceLimit)
      .forEach((record) => {
        selectedTraceMap.set(record.traceId, record);
      });
    const selectedTraces = [...selectedTraceMap.values()]
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(-traceLimit);

    return JSON.stringify(
      {
        schemaVersion: TRACE_SCHEMA_VERSION,
        bundleType: "sync-ai-debug",
        exportedAt: Date.now(),
        page: typeof window === "undefined" ? null : window.location.href,
        docId,
        note:
          "轻量 AI 诊断包：已压缩请求体、响应体和 manifest。需要完整原始数据时再复制完整包。",
        counts: {
          allBatches: batches.length,
          exportedBatches: Math.min(batches.length, batchLimit),
          allTraces: traces.length,
          exportedTraces: selectedTraces.length,
          allDeletedIdentityWatches: deleted.length,
          exportedDeletedIdentityWatches: Math.min(deleted.length, deletedLimit),
          allIncidents: incidents.length,
          exportedIncidents: Math.min(incidents.length, incidentLimit),
        },
        incidents: incidents.slice(-incidentLimit).map(summarizeIncident),
        deletedIdentityWatch: deleted.slice(-deletedLimit).map(summarizeDeletedIdentity),
        traceLog: selectedTraces.map(summarizeTraceRecord),
        batchLog: batches.slice(-batchLimit).map(summarizeBatchRecord),
      },
      null,
      2,
    );
  },
};

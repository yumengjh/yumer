export interface BlockIdentity {
  blockId?: string;
  clientId?: string;
}

export type NodeAttrs = Record<string, unknown> | null | undefined;

export interface IdentityNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: IdentityNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface IdentityDoc {
  type: "doc";
  content?: IdentityNode[];
}

export type SyncState =
  | "idle"
  | "dirty"
  | "flushing"
  | "error"
  | "conflicted"
  | "lease-lost";

export type SyncOpType = "create" | "update" | "delete" | "move";

export interface SyncEntry {
  clientId: string;
  blockId: string | null;
  opType: SyncOpType;
  syncCreateId?: string;
  blockType?: string;
  payload?: Record<string, unknown>;
  plainText?: string;
  parentId?: string;
  sortKey?: string;
  revision?: number;
}

export interface SyncReducerState {
  docId: string;
  rootBlockId: string;
  baseVersion: number;
  draftRevision: number;
  sessionId: string | null;
  sessionEpoch: number | null;
  leaseExpiresAt: string | null;
  lastAckedOpSeq: number | null;
  localRevision: number;
  syncState: SyncState;
  entries: Record<string, SyncEntry>;
  dirtyOrder: string[];
  inflightBatchId: string | null;
  inflightEntryIds: string[];
  inflightEntryRevisions: Record<string, number>;
  pendingCommit: boolean;
  lastError: string | null;
  hasCorruptedSortKeys: boolean;
  sortKeyCorruptionReport: SortKeyCorruptionReport | null;
}

export interface SortKeyCorruptionReport {
  duplicates: Array<{ sortKey: string; clientIds: string[] }>;
  nonMonotonic: Array<{
    previousClientId: string;
    previousSortKey: string;
    clientId: string;
    sortKey: string;
  }>;
}

export interface SyncBatchResult {
  operation: string;
  success: boolean;
  clientId?: string;
  blockId?: string;
  sortKey?: string;
  version?: number;
  error?: string;
  diagnosticCode?: string;
  matchBy?: string;
  tombstoned?: boolean;
}

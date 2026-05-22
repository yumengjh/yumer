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

export type SyncState = "idle" | "dirty" | "flushing" | "error" | "conflicted";

export type SyncOpType = "create" | "update" | "delete";

export interface SyncEntry {
  clientId: string;
  blockId: string | null;
  opType: SyncOpType;
  blockType?: string;
  payload?: Record<string, unknown>;
  plainText?: string;
  sortKey?: string;
  revision?: number;
}

export interface SyncReducerState {
  docId: string;
  rootBlockId: string;
  baseVersion: number;
  localRevision: number;
  syncState: SyncState;
  entries: Record<string, SyncEntry>;
  dirtyOrder: string[];
  inflightBatchId: string | null;
  inflightEntryIds: string[];
  inflightEntryRevisions: Record<string, number>;
  pendingCommit: boolean;
  lastError: string | null;
}

export interface SyncBatchResult {
  operation: string;
  success: boolean;
  clientId?: string;
  blockId?: string;
  version?: number;
  error?: string;
}

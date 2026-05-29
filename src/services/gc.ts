import { apiFetch } from "./api-client";

export type GcRunStatus = "running" | "completed" | "blocked" | "failed";

export interface BlockVersionGcHealth {
  status: "ok" | "blocked";
  missingRevisionSnapshots: number;
  missingPublishedSnapshots: number;
  missingRootBlockVersions: number;
  samples?: {
    missingRevisionSnapshots?: Array<{ docId: string; docVer: number }>;
    missingPublishedSnapshots?: Array<{ docId: string; publishedSnapshotId: string | null }>;
    missingRootBlockVersions?: Array<{ source: string; docId: string; resourceKey: string }>;
  };
}

export interface BlockVersionGcRunSummary {
  blockVersionsScanned: number;
  blocksScanned?: number;
  hardRootedBlockVersions: number;
  liveRootedBlockVersions?: number;
  tombstoneRootedBlockVersions?: number;
  policyRetainedBlockVersions: number;
  softDeletedMapEntries?: number;
  candidateBlockVersions: number;
  tombstoneCompactionCandidates?: number;
  rootSources?: {
    docSnapshots: number;
    documentDrafts: number;
  };
  candidateReasons?: Record<string, number>;
}

export interface BlockVersionGcPolicySnapshot {
  gracePeriodMs: number;
  tombstoneGracePeriodMs?: number;
  keepLatestPerBlock: number;
  maxCandidatesToStore: number;
  rootSources: Array<"doc_snapshots" | "document_drafts">;
}

export interface BlockVersionGcRun {
  runId: string;
  resourceType: "block_version";
  mode: "preview";
  status: GcRunStatus;
  scope: {
    workspaceId?: string | null;
    docId?: string | null;
  };
  policySnapshot?: BlockVersionGcPolicySnapshot;
  health?: BlockVersionGcHealth;
  summary: BlockVersionGcRunSummary;
  candidateDetailsStored?: boolean;
  candidateDetailsTruncated?: boolean;
  triggeredBy?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
}

export interface RiskFactor {
  code: string;
  weight: number;
  detail?: Record<string, unknown>;
}

export interface RiskAssessment {
  level: "low" | "medium" | "high";
  score: number;
  reasons: string[];
  factors: RiskFactor[];
}

export type PlannedAction = "candidate_block_version" | "compact_map_entry";

export type RequiredCheck =
  | "verify_root_stability"
  | "verify_source_consistency"
  | "verify_policy_overlap"
  | "verify_no_recent_write_dependency"
  | "verify_content_read_paths";

export type Readiness = "ready_for_manual_review" | "needs_more_validation";

export interface CandidateReasonDetail {
  rootKind?: string;
  deleted?: boolean;
  source?: string;
  action?: string;
  hardRooted?: boolean;
  retainedByPolicy?: boolean;
  gracePeriodMs?: number;
  tombstoneGracePeriodMs?: number;
  keepLatestPerBlock?: number;
  ageMs?: number;
  ageBucket?: string;
  rootSourceCount?: number;
  distanceFromLatestVer?: number;
  decisionPath?: string;
  [key: string]: unknown;
}

export type CandidateClass = "unreferenced_block_version" | "deleted_tombstone_map_entry";

export interface BlockVersionGcCandidate {
  id?: number;
  runId?: string;
  resourceType?: "block_version";
  resourceKey: string;
  resourceRowId?: number;
  docId?: string | null;
  workspaceId?: string | null;
  blockId?: string;
  blockVer?: number;
  versionCreatedAt?: number;
  reasonCode: string;
  reasonDetail?: CandidateReasonDetail;
  decision?: string;
  candidateClass?: CandidateClass;
  decisionReasons?: string[];
  riskLevel?: "low" | "medium" | "high";
  riskAssessment?: RiskAssessment;
  plannedAction?: PlannedAction;
  requiredChecks?: RequiredCheck[];
  readiness?: Readiness;
  createdAt?: string;
}

export interface PaginatedGcResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GcScannedBlock {
  blockId: string;
  docId?: string | null;
  workspaceId?: string | null;
  latestVer?: number;
  scannedVersionCount?: number;
  oldestVersionCreatedAt?: number;
  newestVersionCreatedAt?: number;
}

type AdminRequestOptions = {
  token: string;
  operatorId?: string;
};

type ScopeOptions = {
  workspaceId?: string;
  docId?: string;
};

type JsonEnvelope<T> = {
  success: boolean;
  data: T;
  error?: { code?: string; message?: string | string[] };
};

function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  const next = query.toString();
  return next ? `?${next}` : "";
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as JsonEnvelope<T>) : null;

  if (!payload?.success) {
    const message = Array.isArray(payload?.error?.message)
      ? payload.error?.message.join(", ")
      : payload?.error?.message || `GC request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload.data;
}

async function requestGc<T>(
  path: string,
  options: RequestInit & AdminRequestOptions,
): Promise<T> {
  const { token, operatorId, headers, ...rest } = options;
  const response = await apiFetch(path, {
    ...rest,
    headers: {
      ...(headers as Record<string, string> | undefined),
      "x-system-admin-token": token,
      ...(operatorId ? { "x-operator-id": operatorId } : {}),
    },
  });

  return parseEnvelope<T>(response);
}

export async function getBlockVersionGcHealth(
  input: AdminRequestOptions & ScopeOptions,
): Promise<BlockVersionGcHealth> {
  const query = buildQuery({
    workspaceId: input.workspaceId,
    docId: input.docId,
  });

  return requestGc<BlockVersionGcHealth>(`/admin/gc/block-versions/health${query}`, {
    token: input.token,
    operatorId: input.operatorId,
    method: "GET",
  });
}

export async function createBlockVersionGcRun(
  input: AdminRequestOptions &
    ScopeOptions & {
      includeCandidates?: boolean;
    },
): Promise<BlockVersionGcRun> {
  return requestGc<BlockVersionGcRun>("/admin/gc/block-versions/runs", {
    token: input.token,
    operatorId: input.operatorId,
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      docId: input.docId,
      includeCandidates: input.includeCandidates ?? true,
    }),
  });
}

export async function listBlockVersionGcRuns(
  input: AdminRequestOptions &
    ScopeOptions & {
      page?: number;
      pageSize?: number;
      status?: GcRunStatus;
    },
): Promise<PaginatedGcResult<BlockVersionGcRun>> {
  const query = buildQuery({
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 10,
    status: input.status,
    workspaceId: input.workspaceId,
    docId: input.docId,
  });

  return requestGc<PaginatedGcResult<BlockVersionGcRun>>(
    `/admin/gc/block-versions/runs${query}`,
    {
      token: input.token,
      operatorId: input.operatorId,
      method: "GET",
    },
  );
}

export async function getBlockVersionGcRun(
  input: AdminRequestOptions & {
    runId: string;
  },
): Promise<BlockVersionGcRun> {
  return requestGc<BlockVersionGcRun>(`/admin/gc/block-versions/runs/${input.runId}`, {
    token: input.token,
    operatorId: input.operatorId,
    method: "GET",
  });
}

export async function getBlockVersionGcCandidates(
  input: AdminRequestOptions & {
    runId: string;
    page?: number;
    pageSize?: number;
  },
): Promise<PaginatedGcResult<BlockVersionGcCandidate>> {
  const query = buildQuery({
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 100,
  });

  return requestGc<PaginatedGcResult<BlockVersionGcCandidate>>(
    `/admin/gc/block-versions/runs/${input.runId}/candidates${query}`,
    {
      token: input.token,
      operatorId: input.operatorId,
      method: "GET",
    },
  );
}

export async function getRunScannedBlocks(
  input: AdminRequestOptions & {
    runId: string;
    page?: number;
    pageSize?: number;
  },
): Promise<PaginatedGcResult<GcScannedBlock>> {
  const query = buildQuery({
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 20,
  });

  return requestGc<PaginatedGcResult<GcScannedBlock>>(
    `/admin/gc/block-versions/runs/${input.runId}/scanned-blocks${query}`,
    {
      token: input.token,
      operatorId: input.operatorId,
      method: "GET",
    },
  );
}

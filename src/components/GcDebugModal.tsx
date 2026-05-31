"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Descriptions, Divider, Drawer, Empty, Input, Modal, Popconfirm, Spin, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  compactSqliteStorage,
  createBlockVersionGcRun,
  getBlockVersionGcCandidates,
  getBlockVersionGcHealth,
  getBlockVersionGcRun,
  getGcCandidatePool,
  getGcPolicy,
  listBlockVersionGcRuns,
  sweepBlockVersions,
  sweepDraftTombstones,
  sweepRevisionTombstones,
  type BlockVersionGcCandidate,
  type BlockVersionGcHealth,
  type BlockVersionGcPolicySnapshot,
  type BlockVersionGcRun,
  type CandidateClass,
  type GcCandidatePoolItem,
  type GcPolicyDefaults,
  type GcPoolState,
  type GcRunMode,
  type GcStorageCompactResult,
  type GcSweepResult,
  type PlannedAction,
  type Readiness,
  type RequiredCheck,
} from "@/services/gc";
import "./GcDebugModal.css";

const GC_SYSTEM_ADMIN_TOKEN_KEY = "gcSystemAdminToken";
const GC_OPERATOR_ID_KEY = "gcOperatorId";

type GcDebugModalProps = {
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
  docId?: string;
  docTitle?: string;
};

type PolicyItem = {
  key: string;
  label: string;
  value: string;
};

function getStatusColor(status?: string) {
  switch (status) {
    case "completed":
      return "green";
    case "running":
      return "blue";
    case "blocked":
      return "orange";
    case "failed":
      return "red";
    case "ok":
      return "green";
    default:
      return "default";
  }
}

function formatTime(value?: string | number | null) {
  if (!value) return "--";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

function formatCount(value?: number) {
  return typeof value === "number" ? value.toLocaleString() : "0";
}

function formatDuration(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (value < 1000) return `${value}ms`;

  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

function toPolicyItems(policy?: BlockVersionGcPolicySnapshot): PolicyItem[] {
  if (!policy) return [];

  return [
    {
      key: "gracePeriodMs",
      label: "普通候选宽限期",
      value: `${formatDuration(policy.gracePeriodMs)} (${policy.gracePeriodMs}ms)`,
    },
    {
      key: "tombstoneGracePeriodMs",
      label: "Tombstone 宽限期",
      value:
        typeof policy.tombstoneGracePeriodMs === "number"
          ? `${formatDuration(policy.tombstoneGracePeriodMs)} (${policy.tombstoneGracePeriodMs}ms)`
          : "--",
    },
    {
      key: "keepLatestPerBlock",
      label: "每块额外保留版本数",
      value: String(policy.keepLatestPerBlock),
    },
    {
      key: "maxCandidatesToStore",
      label: "候选明细存储上限",
      value: String(policy.maxCandidatesToStore),
    },
    {
      key: "rootSources",
      label: "Root 来源",
      value: policy.rootSources.join(", "),
    },
  ];
}

function formatPolicySummary(policy?: BlockVersionGcPolicySnapshot) {
  if (!policy) return "--";

  return [
    `普通 ${formatDuration(policy.gracePeriodMs)}`,
    `Tombstone ${formatDuration(policy.tombstoneGracePeriodMs ?? null)}`,
    `每块保留 ${policy.keepLatestPerBlock}`,
  ].join(" / ");
}

const CANDIDATE_CLASS_LABELS: Record<CandidateClass, { label: string; color: string }> = {
  unreferenced_block_version: { label: "未引用旧版本", color: "blue" },
  deleted_tombstone_map_entry: { label: "可压缩 tombstone", color: "purple" },
};

const PLANNED_ACTION_LABELS: Record<PlannedAction, string> = {
  candidate_block_version: "候选旧版本",
  compact_map_entry: "可压缩 tombstone 引用",
};

const READINESS_LABELS: Record<Readiness, { label: string; color: string }> = {
  ready_for_manual_review: { label: "可人工复核", color: "green" },
  needs_more_validation: { label: "仍需补验证", color: "orange" },
};

const REQUIRED_CHECK_LABELS: Record<RequiredCheck, string> = {
  verify_root_stability: "复查 root 是否稳定",
  verify_source_consistency: "复查多来源 root 是否一致",
  verify_policy_overlap: "复查是否仍命中保留策略",
  verify_no_recent_write_dependency: "复查最近写入依赖",
  verify_content_read_paths: "复查内容读取链路",
};

const RUN_MODE_LABELS: Record<GcRunMode, { label: string; color: string }> = {
  preview: { label: "Preview", color: "blue" },
  sweep: { label: "Sweep", color: "red" },
};

const POOL_STATE_LABELS: Record<GcPoolState, { label: string; color: string }> = {
  pending: { label: "待晋升", color: "default" },
  eligible: { label: "可执行", color: "blue" },
  sweeping: { label: "执行中", color: "processing" },
  swept: { label: "已清理", color: "green" },
  resurrected: { label: "已复活", color: "orange" },
  blocked: { label: "已阻断", color: "red" },
};

const SOURCE_LABELS: Record<string, string> = {
  doc_snapshots: "正式快照",
  document_drafts: "草稿副本",
};

const BLOCKER_LABELS: Record<string, string> = {
  candidate_action_invalid: "候选动作无效",
  document_missing: "文档已删除",
  document_workspace_mismatch: "文档工作区不匹配",
  block_missing: "块已删除",
  block_version_missing: "版本已删除",
  block_latest_version: "当前最新版本，不可删除",
  block_version_too_recent: "版本过新，未过宽限期",
  block_version_policy_retained: "版本仍在策略保留窗口内",
  snapshot_root_present: "正式快照仍引用此版本",
  draft_root_present: "草稿仍引用此版本",
};

const ROOT_REF_TYPE_LABELS: Record<string, string> = {
  snapshot: "Snapshot",
  draft: "Draft",
};

function getRiskColor(level?: string) {
  switch (level) {
    case "low":
      return "green";
    case "medium":
      return "orange";
    case "high":
      return "red";
    default:
      return "default";
  }
}

function formatAge(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "--";
  return formatDuration(ms);
}

export function GcDebugModal({ open, onClose, workspaceId, docId, docTitle }: GcDebugModalProps) {
  const [token, setToken] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [includeCandidates, setIncludeCandidates] = useState(true);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [health, setHealth] = useState<BlockVersionGcHealth | null>(null);
  const [runs, setRuns] = useState<BlockVersionGcRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<BlockVersionGcRun | null>(null);
  const [candidates, setCandidates] = useState<BlockVersionGcCandidate[]>([]);
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<BlockVersionGcCandidate | null>(null);
  const [poolItems, setPoolItems] = useState<GcCandidatePoolItem[]>([]);
  const [poolTotal, setPoolTotal] = useState(0);
  const [poolStateFilter, setPoolStateFilter] = useState<GcPoolState | undefined>(undefined);
  const [poolActionFilter, setPoolActionFilter] = useState<PlannedAction | undefined>(undefined);
  const [poolLoading, setPoolLoading] = useState(false);
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepLimit, setSweepLimit] = useState(100);
  const [sweepDryRun, setSweepDryRun] = useState(true);
  const [selectedPoolItem, setSelectedPoolItem] = useState<GcCandidatePoolItem | null>(null);
  const [policy, setPolicy] = useState<GcPolicyDefaults | null>(null);
  const [runModeFilter, setRunModeFilter] = useState<GcRunMode | undefined>(undefined);
  const [compactLoading, setCompactLoading] = useState(false);
  const [compactResult, setCompactResult] = useState<GcStorageCompactResult | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setToken(sessionStorage.getItem(GC_SYSTEM_ADMIN_TOKEN_KEY) ?? "");
    setOperatorId(sessionStorage.getItem(GC_OPERATOR_ID_KEY) ?? "");
  }, []);

  const persistCredentials = useCallback((nextToken: string, nextOperatorId: string) => {
    if (typeof window === "undefined") return;

    if (nextToken.trim()) {
      sessionStorage.setItem(GC_SYSTEM_ADMIN_TOKEN_KEY, nextToken.trim());
    } else {
      sessionStorage.removeItem(GC_SYSTEM_ADMIN_TOKEN_KEY);
    }

    if (nextOperatorId.trim()) {
      sessionStorage.setItem(GC_OPERATOR_ID_KEY, nextOperatorId.trim());
    } else {
      sessionStorage.removeItem(GC_OPERATOR_ID_KEY);
    }
  }, []);

  const loadCandidatesForRun = useCallback(
    async (activeToken: string, runId: string, activeOperatorId: string) => {
      const candidateResult = await getBlockVersionGcCandidates({
        token: activeToken,
        operatorId: activeOperatorId || undefined,
        runId,
        page: 1,
        pageSize: 100,
      });
      setCandidates(candidateResult.items);
      setCandidatesTotal(candidateResult.total);
    },
    [],
  );

  const loadRunDetail = useCallback(
    async (run: BlockVersionGcRun, activeToken: string, activeOperatorId: string) => {
      const fullRun = await getBlockVersionGcRun({
        token: activeToken,
        operatorId: activeOperatorId || undefined,
        runId: run.runId,
      });

      setSelectedRun(fullRun);

      const tasks: Promise<void>[] = [];

      if (fullRun.candidateDetailsStored) {
        tasks.push(loadCandidatesForRun(activeToken, fullRun.runId, activeOperatorId));
      } else {
        setCandidates([]);
        setCandidatesTotal(0);
      }

      await Promise.all(tasks);
    },
    [loadCandidatesForRun],
  );

  const loadPanelData = useCallback(
    async (activeToken = token, activeOperatorId = operatorId) => {
      if (!activeToken.trim()) {
        setError("请先输入系统管理员令牌");
        return;
      }

      setLoading(true);
      setError(null);
      persistCredentials(activeToken, activeOperatorId);

      try {
        const [healthResult, runsResult] = await Promise.all([
          getBlockVersionGcHealth({
            token: activeToken,
            operatorId: activeOperatorId || undefined,
            workspaceId,
            docId,
          }),
          listBlockVersionGcRuns({
            token: activeToken,
            operatorId: activeOperatorId || undefined,
            workspaceId,
            docId,
            page: 1,
            pageSize: 10,
          }),
        ]);

        setHealth(healthResult);
        setRuns(runsResult.items);

        // Load policy in background
        void getGcPolicy({
          token: activeToken,
          operatorId: activeOperatorId || undefined,
        }).then((policyResult) => {
          setPolicy(policyResult);
        }).catch(() => { /* ignore policy load errors */ });

        // Load pool in background (non-blocking)
        void getGcCandidatePool({
          token: activeToken,
          operatorId: activeOperatorId || undefined,
          workspaceId,
          docId,
          page: 1,
          pageSize: 100,
        }).then((poolResult) => {
          setPoolItems(poolResult.items);
          setPoolTotal(poolResult.total);
        }).catch(() => { /* ignore pool load errors on init */ });

        const latestRun = runsResult.items[0] ?? null;
        if (latestRun) {
          await loadRunDetail(latestRun, activeToken, activeOperatorId);
        } else {
          setSelectedRun(null);
          setCandidates([]);
          setCandidatesTotal(0);
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "GC 调试信息加载失败");
      } finally {
        setLoading(false);
      }
    },
    [docId, loadRunDetail, operatorId, persistCredentials, token, workspaceId],
  );

  useEffect(() => {
    if (!open) return;
    void loadPanelData();
  }, [loadPanelData, open]);

  const handleRunPreview = useCallback(async () => {
    if (!token.trim()) {
      setError("请先输入系统管理员令牌");
      return;
    }

    setRunning(true);
    setError(null);
    persistCredentials(token, operatorId);

    try {
      const run = await createBlockVersionGcRun({
        token,
        operatorId: operatorId || undefined,
        workspaceId,
        docId,
        includeCandidates,
      });

      message.success(`GC preview 已触发：${run.runId}`);
      await loadPanelData(token, operatorId);
    } catch (nextError) {
      const messageText = nextError instanceof Error ? nextError.message : "GC preview 触发失败";
      setError(messageText);
      message.error(messageText);
    } finally {
      setRunning(false);
    }
  }, [docId, includeCandidates, loadPanelData, operatorId, persistCredentials, token, workspaceId]);

  const loadPool = useCallback(
    async (activeToken = token, activeOperatorId = operatorId, stateFilter = poolStateFilter, actionFilter = poolActionFilter) => {
      if (!activeToken.trim()) return;
      setPoolLoading(true);
      try {
        const result = await getGcCandidatePool({
          token: activeToken,
          operatorId: activeOperatorId || undefined,
          workspaceId,
          docId,
          state: stateFilter,
          action: actionFilter,
          page: 1,
          pageSize: 100,
        });
        setPoolItems(result.items);
        setPoolTotal(result.total);
      } catch (nextError) {
        const msg = nextError instanceof Error ? nextError.message : "Candidate pool 加载失败";
        setError(msg);
      } finally {
        setPoolLoading(false);
      }
    },
    [docId, operatorId, poolActionFilter, poolStateFilter, token, workspaceId],
  );

  const loadRunsByMode = useCallback(
    async (mode?: GcRunMode) => {
      if (!token.trim()) return;
      try {
        const result = await listBlockVersionGcRuns({
          token,
          operatorId: operatorId || undefined,
          workspaceId,
          docId,
          mode,
          page: 1,
          pageSize: 20,
        });
        setRuns(result.items);
      } catch { /* ignore */ }
    },
    [docId, operatorId, token, workspaceId],
  );

  const handleSweep = useCallback(
    async (type: "draft" | "revision" | "block-versions") => {
      if (!token.trim()) {
        setError("请先输入系统管理员令牌");
        return;
      }
      setSweepLoading(true);
      setError(null);
      persistCredentials(token, operatorId);

      try {
        const sweepFnMap = {
          draft: sweepDraftTombstones,
          revision: sweepRevisionTombstones,
          "block-versions": sweepBlockVersions,
        };
        const labelMap = {
          draft: "Draft Tombstones",
          revision: "Revision Tombstones",
          "block-versions": "Block Versions",
        };
        const result: GcSweepResult = await sweepFnMap[type]({
          token,
          operatorId: operatorId || undefined,
          workspaceId,
          docId,
          limit: sweepLimit,
          dryRun: sweepDryRun,
        });

        const modeLabel = sweepDryRun ? "Dry-run" : "Sweep";
        const summary = result.summary;
        let extra = "";
        if (summary) {
          if (sweepDryRun && typeof summary.wouldDeleteCandidates === "number") {
            extra = `，将删除 ${summary.wouldDeleteCandidates} 个版本`;
          }
          if (!sweepDryRun && typeof summary.deletedBlockVersions === "number") {
            extra = `，已删除 ${summary.deletedBlockVersions} 个版本`;
          }
          if (typeof summary.blockedCandidates === "number" && summary.blockedCandidates > 0) {
            extra += `，${summary.blockedCandidates} 个被阻断`;
          }
        }
        message.success(`${modeLabel} ${labelMap[type]} 已完成：run ${result.runId}${extra}`);

        await Promise.all([loadPanelData(token, operatorId), loadPool(token, operatorId)]);
      } catch (nextError) {
        const msg = nextError instanceof Error ? nextError.message : "Sweep 执行失败";
        setError(msg);
        message.error(msg);
      } finally {
        setSweepLoading(false);
      }
    },
    [docId, loadPanelData, loadPool, operatorId, persistCredentials, sweepDryRun, sweepLimit, token, workspaceId],
  );

  const handleCompact = useCallback(
    async (dryRun: boolean) => {
      if (!token.trim()) {
        setError("请先输入系统管理员令牌");
        return;
      }
      setCompactLoading(true);
      setError(null);
      persistCredentials(token, operatorId);

      try {
        const result = await compactSqliteStorage({
          token,
          operatorId: operatorId || undefined,
          dryRun,
          mode: "vacuum",
          confirm: dryRun ? undefined : "VACUUM_SQLITE_DATABASE",
        });

        setCompactResult(result);

        if (!result.supported) {
          message.info(result.message ?? "当前数据库不支持 VACUUM");
        } else if (dryRun) {
          const before = result.before;
          if (before) {
            const freeMB = (before.estimatedFreelistBytes / 1024 / 1024).toFixed(2);
            message.success(`Dry-run 完成：可回收约 ${freeMB} MB（${before.freelistCount} 页）`);
          }
        } else {
          const before = result.before;
          const after = result.after;
          if (before && after) {
            const savedMB = ((before.fileSizeBytes - after.fileSizeBytes) / 1024 / 1024).toFixed(2);
            message.success(`VACUUM 完成：文件缩小 ${savedMB} MB，耗时 ${result.durationMs ?? "--"}ms`);
          } else {
            message.success("VACUUM 完成");
          }
        }
      } catch (nextError) {
        const msg = nextError instanceof Error ? nextError.message : "Storage compact 执行失败";
        setError(msg);
        message.error(msg);
      } finally {
        setCompactLoading(false);
      }
    },
    [operatorId, persistCredentials, token],
  );

  const scopeLabel = useMemo(
    () => ({
      workspaceId: workspaceId || "--",
      docId: docId || "--",
      docTitle: docTitle || "当前未选中文档",
    }),
    [docId, docTitle, workspaceId],
  );

  const selectedPolicyItems = useMemo(
    () => toPolicyItems(selectedRun?.policySnapshot),
    [selectedRun?.policySnapshot],
  );

  const runColumns = useMemo<ColumnsType<BlockVersionGcRun>>(
    () => [
      {
        title: "Run",
        dataIndex: "runId",
        key: "runId",
        render: (value: string) => <code>{value}</code>,
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 96,
        render: (value?: string) => <Tag color={getStatusColor(value)}>{value || "unknown"}</Tag>,
      },
      {
        title: "模式",
        dataIndex: "mode",
        key: "mode",
        width: 88,
        render: (value?: GcRunMode) => {
          const m = value ? RUN_MODE_LABELS[value] : null;
          return m ? <Tag color={m.color}>{m.label}</Tag> : <Tag>{value || "--"}</Tag>;
        },
      },
      {
        title: "扫描",
        key: "scanned",
        width: 88,
        render: (_, record) => formatCount(record.summary?.blockVersionsScanned),
      },
      {
        title: "块数",
        key: "blocksScanned",
        width: 80,
        render: (_, record) => formatCount(record.summary?.blocksScanned),
      },
      {
        title: "普通候选",
        key: "candidateBlockVersions",
        width: 96,
        render: (_, record) => formatCount(record.summary?.candidateBlockVersions),
      },
      {
        title: "策略",
        key: "policy",
        render: (_, record) => (
          <span className="gc-debug__table-policy">{formatPolicySummary(record.policySnapshot)}</span>
        ),
      },
      {
        title: "开始时间",
        key: "startedAt",
        width: 180,
        render: (_, record) => formatTime(record.startedAt || record.createdAt),
      },
    ],
    [],
  );

  const candidateColumns = useMemo<ColumnsType<BlockVersionGcCandidate>>(
    () => [
      {
        title: "Version",
        dataIndex: "resourceKey",
        key: "resourceKey",
        render: (value: string) => <code>{value}</code>,
      },
      {
        title: "候选类别",
        key: "candidateClass",
        width: 150,
        render: (_, record) => {
          if (record.candidateClass) {
            const { label, color } = CANDIDATE_CLASS_LABELS[record.candidateClass];
            return <Tag color={color}>{label}</Tag>;
          }
          return <Tag>{record.reasonCode}</Tag>;
        },
      },
      {
        title: "判定原因",
        key: "decisionReasons",
        render: (_, record) => {
          if (record.decisionReasons && record.decisionReasons.length > 0) {
            return (
              <span className="gc-debug__decision-reasons">
                {record.decisionReasons.map((reason, idx) => (
                  <Tag key={idx} className="gc-debug__decision-tag">{reason}</Tag>
                ))}
              </span>
            );
          }
          return String(record.reasonDetail?.decisionPath ?? record.reasonCode ?? "--");
        },
      },
      {
        title: "Root Kind",
        key: "rootKind",
        width: 120,
        render: (_, record) => String(record.reasonDetail?.rootKind ?? "--"),
      },
      {
        title: "Root Ref",
        key: "rootRef",
        width: 160,
        render: (_, record) => {
          const refType = record.reasonDetail?.rootRefType as string | undefined;
          const refId = record.reasonDetail?.rootRefId as string | undefined;
          if (!refType && !refId) return "--";
          const typeLabel = ROOT_REF_TYPE_LABELS[refType ?? ""] ?? refType ?? "--";
          return (
            <Tooltip title={refId}>
              <Tag>{typeLabel}</Tag>
            </Tooltip>
          );
        },
      },
      {
        title: "Age",
        key: "age",
        width: 120,
        render: (_, record) => {
          const bucket = record.reasonDetail?.ageBucket;
          const ms = record.reasonDetail?.ageMs;
          if (bucket) return <Tag>{bucket}</Tag>;
          return formatAge(typeof ms === "number" ? ms : undefined);
        },
      },
    ],
    [],
  );

  return (
    <>
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1180}
      title="GC 调试面板"
      className="gc-debug-modal"
      destroyOnClose={false}
    >
      <div className="gc-debug">
        <div className="gc-debug__toolbar">
          <Input.Password
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="x-system-admin-token"
            className="gc-debug__token"
          />
          <Input
            value={operatorId}
            onChange={(event) => setOperatorId(event.target.value)}
            placeholder="x-operator-id，可选"
            className="gc-debug__operator"
          />
          <Checkbox checked={includeCandidates} onChange={(event) => setIncludeCandidates(event.target.checked)}>
            保存候选明细
          </Checkbox>
          <Button onClick={() => void loadPanelData()} loading={loading}>
            刷新状态
          </Button>
          <Button type="primary" onClick={() => void handleRunPreview()} loading={running}>
            触发 Preview
          </Button>
        </div>

        <div className="gc-debug__scope">
          <span>
            工作区：<code>{scopeLabel.workspaceId}</code>
          </span>
          <span>
            文档：<code>{scopeLabel.docId}</code>
          </span>
          <span className="gc-debug__scope-title">{scopeLabel.docTitle}</span>
        </div>

        {error ? <Alert type="error" showIcon message={error} className="gc-debug__alert" /> : null}

        <Spin spinning={loading}>
          <div className="gc-debug__grid">
            <section className="gc-debug__card">
              <div className="gc-debug__card-head">
                <h3>Health</h3>
                <Tag color={getStatusColor(health?.status)}>{health?.status || "unknown"}</Tag>
              </div>
              {health ? (
                <>
                  <div className="gc-debug__metrics">
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">缺快照版本</span>
                      <strong>{formatCount(health.missingRevisionSnapshots)}</strong>
                    </div>
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">缺发布快照</span>
                      <strong>{formatCount(health.missingPublishedSnapshots)}</strong>
                    </div>
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">缺 Root Version</span>
                      <strong>{formatCount(health.missingRootBlockVersions)}</strong>
                    </div>
                  </div>
                  <pre className="gc-debug__json">{JSON.stringify(health, null, 2)}</pre>
                </>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 health 数据" />
              )}
            </section>

            <section className="gc-debug__card">
              <div className="gc-debug__card-head">
                <h3>Latest Run</h3>
                <Tag color={getStatusColor(selectedRun?.status)}>{selectedRun?.status || "none"}</Tag>
              </div>
              {selectedRun ? (
                <>
                  <div className="gc-debug__metrics gc-debug__metrics--summary">
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">扫描</span>
                      <strong>{formatCount(selectedRun.summary?.blockVersionsScanned)}</strong>
                    </div>
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">Live Root</span>
                      <strong>{formatCount(selectedRun.summary?.liveRootedBlockVersions)}</strong>
                    </div>
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">Tombstone Root</span>
                      <strong>{formatCount(selectedRun.summary?.tombstoneRootedBlockVersions)}</strong>
                    </div>
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">策略保留</span>
                      <strong>{formatCount(selectedRun.summary?.policyRetainedBlockVersions)}</strong>
                    </div>
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">普通候选</span>
                      <strong>{formatCount(selectedRun.summary?.candidateBlockVersions)}</strong>
                    </div>
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">Map 压缩候选</span>
                      <strong>{formatCount(selectedRun.summary?.tombstoneCompactionCandidates)}</strong>
                    </div>
                  </div>
                  <div className="gc-debug__meta">
                    <span>
                      Run：<code>{selectedRun.runId}</code>
                    </span>
                    <span>开始：{formatTime(selectedRun.startedAt || selectedRun.createdAt)}</span>
                    <span>结束：{formatTime(selectedRun.finishedAt)}</span>
                    <span>触发人：{selectedRun.triggeredBy || "--"}</span>
                  </div>

                  <div className="gc-debug__subsection">
                    <div className="gc-debug__subsection-head">
                      <h4>Policy</h4>
                      <Typography.Text type="secondary">本次 run 固化的策略快照</Typography.Text>
                    </div>
                    {selectedPolicyItems.length > 0 ? (
                      <div className="gc-debug__policy-list">
                        {selectedPolicyItems.map((item) => (
                          <div key={item.key} className="gc-debug__policy-item">
                            <span className="gc-debug__policy-label">{item.label}</span>
                            <strong className="gc-debug__policy-value">{item.value}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该 run 未返回策略快照" />
                    )}
                  </div>

                  <pre className="gc-debug__json">{JSON.stringify(selectedRun, null, 2)}</pre>
                </>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 run 数据" />
              )}
            </section>
          </div>

          <section className="gc-debug__card gc-debug__card--table">
            <div className="gc-debug__card-head">
              <h3>Recent Runs</h3>
              <div className="gc-debug__run-mode-filter">
                <Tag
                  color={runModeFilter === undefined ? "blue" : undefined}
                  onClick={() => { setRunModeFilter(undefined); void loadRunsByMode(undefined); }}
                  style={{ cursor: "pointer" }}
                >
                  全部
                </Tag>
                <Tag
                  color={runModeFilter === "preview" ? "blue" : undefined}
                  onClick={() => { setRunModeFilter("preview"); void loadRunsByMode("preview"); }}
                  style={{ cursor: "pointer" }}
                >
                  Preview
                </Tag>
                <Tag
                  color={runModeFilter === "sweep" ? "red" : undefined}
                  onClick={() => { setRunModeFilter("sweep"); void loadRunsByMode("sweep"); }}
                  style={{ cursor: "pointer" }}
                >
                  Sweep
                </Tag>
              </div>
            </div>
            <Table
              size="small"
              rowKey="runId"
              columns={runColumns}
              dataSource={runs}
              pagination={false}
              locale={{ emptyText: "暂无 run 记录" }}
              onRow={(record) => ({
                onClick: () => {
                  void loadRunDetail(record, token, operatorId);
                },
              })}
            />
          </section>

          <section className="gc-debug__card gc-debug__card--table">
            <div className="gc-debug__card-head">
              <h3>Candidates</h3>
              <Typography.Text type="secondary">
                {selectedRun?.runId ? `run ${selectedRun.runId}` : "未选中 run"} / {formatCount(candidatesTotal)} 条
              </Typography.Text>
            </div>
            {selectedRun && !selectedRun.candidateDetailsStored && (
              <Alert type="info" showIcon message="本次 run 没有保存 candidates 明细" className="gc-debug__inline-alert" />
            )}
            {selectedRun?.candidateDetailsTruncated && (
              <Alert type="warning" showIcon message="本次 candidates 明细被截断，完整候选请去 Candidate Pool 查看" className="gc-debug__inline-alert" />
            )}
            <Table
              size="small"
              rowKey={(record) => record.resourceKey + "-" + record.reasonCode}
              columns={candidateColumns}
              dataSource={candidates}
              pagination={false}
              locale={{ emptyText: "当前没有候选明细" }}
              onRow={(record) => ({
                onClick: () => setSelectedCandidate(record),
                style: { cursor: "pointer" },
              })}
            />
          </section>

          {/* Candidate Pool Explorer */}
          <section className="gc-debug__card gc-debug__card--table">
            <div className="gc-debug__card-head">
              <h3>Candidate Pool</h3>
              <Typography.Text type="secondary">{formatCount(poolTotal)} 条</Typography.Text>
            </div>
            <div className="gc-debug__pool-filters">
              <span className="gc-debug__pool-filter-label">State：</span>
              {(["pending", "eligible", "sweeping", "swept", "resurrected", "blocked"] as GcPoolState[]).map((s) => (
                <Tag
                  key={s}
                  className="gc-debug__pool-filter-tag"
                  color={poolStateFilter === s ? POOL_STATE_LABELS[s].color : undefined}
                  onClick={() => {
                    const next = poolStateFilter === s ? undefined : s;
                    setPoolStateFilter(next);
                    void loadPool(token, operatorId, next, poolActionFilter);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {POOL_STATE_LABELS[s].label}
                </Tag>
              ))}
              <Divider type="vertical" />
              <span className="gc-debug__pool-filter-label">Action：</span>
              {(["candidate_block_version", "compact_map_entry"] as PlannedAction[]).map((a) => (
                <Tag
                  key={a}
                  className="gc-debug__pool-filter-tag"
                  color={poolActionFilter === a ? "blue" : undefined}
                  onClick={() => {
                    const next = poolActionFilter === a ? undefined : a;
                    setPoolActionFilter(next);
                    void loadPool(token, operatorId, poolStateFilter, next);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {PLANNED_ACTION_LABELS[a]}
                </Tag>
              ))}
              <Button
                size="small"
                onClick={() => void loadPool()}
                loading={poolLoading}
                style={{ marginLeft: 8 }}
              >
                刷新 Pool
              </Button>
            </div>
            <Table
              size="small"
              rowKey={(record) => record.candidateKey ?? record.resourceKey}
              dataSource={poolItems}
              pagination={false}
              locale={{ emptyText: "暂无 pool 数据，点击刷新 Pool 加载" }}
              scroll={{ x: 960 }}
              columns={[
                {
                  title: "candidateKey",
                  dataIndex: "candidateKey",
                  key: "candidateKey",
                  width: 200,
                  render: (value: string) => <code className="gc-debug__code-sm">{value}</code>,
                },
                {
                  title: "resourceKey",
                  dataIndex: "resourceKey",
                  key: "resourceKey",
                  width: 160,
                  render: (value: string) => <code className="gc-debug__code-sm">{value}</code>,
                },
                {
                  title: "Action",
                  dataIndex: "action",
                  key: "action",
                  width: 150,
                  render: (value?: PlannedAction) => value ? <Tag>{PLANNED_ACTION_LABELS[value] ?? value}</Tag> : "--",
                },
                {
                  title: "Source",
                  key: "source",
                  width: 100,
                  render: (_, record) => {
                    const src = record.source ?? record.reasonDetail?.source;
                    return src ? <Tag>{SOURCE_LABELS[src] ?? src}</Tag> : "--";
                  },
                },
                {
                  title: "State",
                  dataIndex: "state",
                  key: "state",
                  width: 88,
                  render: (value?: GcPoolState) => {
                    const s = value ? POOL_STATE_LABELS[value] : null;
                    return s ? <Tag color={s.color}>{s.label}</Tag> : <Tag>{value || "--"}</Tag>;
                  },
                },
                {
                  title: "Root Ref",
                  key: "rootRef",
                  width: 140,
                  render: (_, record) => {
                    const refType = record.reasonDetail?.rootRefType as string | undefined;
                    const refId = record.reasonDetail?.rootRefId as string | undefined;
                    if (!refType && !refId) return "--";
                    const typeLabel = ROOT_REF_TYPE_LABELS[refType ?? ""] ?? refType ?? "--";
                    return (
                      <Tooltip title={refId}>
                        <Tag>{typeLabel}</Tag>
                      </Tooltip>
                    );
                  },
                },
                {
                  title: "Readiness",
                  key: "readiness",
                  width: 110,
                  render: (_, record) => {
                    const r = record.readiness;
                    if (!r) return "--";
                    const l = READINESS_LABELS[r];
                    return l ? <Tag color={l.color}>{l.label}</Tag> : <Tag>{r}</Tag>;
                  },
                },
                {
                  title: "Risk",
                  key: "riskLevel",
                  width: 72,
                  render: (_, record) => {
                    const level = record.riskAssessment?.level ?? record.riskLevel;
                    return level ? <Tag color={getRiskColor(level)}>{level}</Tag> : "--";
                  },
                },
                {
                  title: "eligibleAfter",
                  dataIndex: "eligibleAfter",
                  key: "eligibleAfter",
                  width: 160,
                  render: (value?: string | null) => formatTime(value),
                },
                {
                  title: "lastSweepAt",
                  dataIndex: "lastSweepAt",
                  key: "lastSweepAt",
                  width: 160,
                  render: (value?: string | null) => formatTime(value),
                },
              ]}
              onRow={(record) => ({
                onClick: () => setSelectedPoolItem(record),
                style: { cursor: "pointer" },
              })}
            />
          </section>

          {/* Sweep Console */}
          <section className="gc-debug__card gc-debug__card--sweep">
            <div className="gc-debug__card-head">
              <h3>Sweep Console</h3>
              {health?.status === "blocked" && (
                <Tag color="red">Health blocked — 不可执行 sweep</Tag>
              )}
            </div>

            {policy && (
              <div className="gc-debug__policy-inline">
                <Tag>宽限期 {formatDuration(policy.gracePeriodMs)}</Tag>
                <Tag>Tombstone 宽限期 {formatDuration(policy.tombstoneGracePeriodMs)}</Tag>
                <Tag>每块保留 {policy.keepLatestPerBlock}</Tag>
                {policy.stableSeenThreshold != null && <Tag>稳定阈值 {policy.stableSeenThreshold} 次</Tag>}
              </div>
            )}

            <div className="gc-debug__sweep-form">
              <div className="gc-debug__sweep-row">
                <label className="gc-debug__sweep-label">Limit：</label>
                <Input
                  type="number"
                  value={sweepLimit}
                  onChange={(e) => setSweepLimit(Number(e.target.value) || 100)}
                  className="gc-debug__sweep-input"
                  style={{ width: 100 }}
                />
                <Checkbox checked={sweepDryRun} onChange={(e) => setSweepDryRun(e.target.checked)}>
                  Dry-run（不真实执行）
                </Checkbox>
              </div>

              <div className="gc-debug__sweep-group">
                <Typography.Text type="secondary" className="gc-debug__sweep-group-label">Tombstone Compaction</Typography.Text>
                <div className="gc-debug__sweep-row">
                  <Button
                    onClick={() => void handleSweep("draft")}
                    loading={sweepLoading}
                    disabled={health?.status === "blocked"}
                  >
                    {sweepDryRun ? "Dry-run" : "执行"} Draft Tombstones
                  </Button>
                  <Button
                    onClick={() => void handleSweep("revision")}
                    loading={sweepLoading}
                    disabled={health?.status === "blocked"}
                  >
                    {sweepDryRun ? "Dry-run" : "执行"} Revision Tombstones
                  </Button>
                </div>
                <Typography.Text type="secondary" className="gc-debug__sweep-hint">
                  Draft = document_drafts tombstone compaction / Revision = doc_snapshots(kind=revision, pinned=false) tombstone compaction
                </Typography.Text>
              </div>

              <Divider style={{ margin: "8px 0" }} />

              <div className="gc-debug__sweep-group">
                <Typography.Text type="secondary" className="gc-debug__sweep-group-label">Block Version Physical Delete</Typography.Text>
                <div className="gc-debug__sweep-row">
                  {sweepDryRun ? (
                    <Button
                      onClick={() => void handleSweep("block-versions")}
                      loading={sweepLoading}
                      disabled={health?.status === "blocked"}
                    >
                      Dry-run Block Versions
                    </Button>
                  ) : (
                    <Popconfirm
                      title="确认执行 Block Version 物理删除？"
                      description="此操作将真正删除 block_versions 行，不可撤回。请确保已先执行 dry-run 确认。"
                      onConfirm={() => void handleSweep("block-versions")}
                      okText="确认删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        danger
                        loading={sweepLoading}
                        disabled={health?.status === "blocked"}
                      >
                        执行 Block Versions
                      </Button>
                    </Popconfirm>
                  )}
                </div>
                <Typography.Text type="secondary" className="gc-debug__sweep-hint">
                  从 candidate pool 中选取 state=eligible + action=candidate_block_version 的候选，删除 block_versions 行。只代表逻辑清理完成，不代表磁盘空间已回收。
                </Typography.Text>
              </div>
            </div>
          </section>

          {/* Storage Maintenance */}
          <section className="gc-debug__card gc-debug__card--sweep">
            <div className="gc-debug__card-head">
              <h3>Storage Maintenance</h3>
              <Tag color="orange">仅 SQLite</Tag>
            </div>
            <div className="gc-debug__sweep-form">
              <Typography.Text type="secondary" className="gc-debug__sweep-hint">
                SQLite VACUUM 可回收已删除行占用的磁盘空间。Postgres 请使用 autovacuum 或 DBA 维护。VACUUM 可能阻塞写入，建议在维护窗口执行。
              </Typography.Text>
              <div className="gc-debug__sweep-row">
                <Popconfirm
                  title="预演 SQLite VACUUM"
                  description="仅分析可回收空间，不真实执行。"
                  onConfirm={() => void handleCompact(true)}
                  okText="执行 Dry-run"
                  cancelText="取消"
                >
                  <Button loading={compactLoading}>
                    Dry-run VACUUM
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title="确认执行 SQLite VACUUM？"
                  description="此操作将压缩数据库文件，可能阻塞写入。请确保在维护窗口执行。"
                  onConfirm={() => void handleCompact(false)}
                  okText="确认执行"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button danger loading={compactLoading}>
                    执行 VACUUM
                  </Button>
                </Popconfirm>
              </div>
              {compactResult && (
                <div className="gc-debug__compact-result">
                  {!compactResult.supported ? (
                    <Alert type="info" showIcon message={compactResult.message ?? "当前数据库不支持 VACUUM"} />
                  ) : (
                    <>
                      {compactResult.before && (
                        <Descriptions column={2} bordered size="small" title="VACUUM 前">
                          <Descriptions.Item label="文件大小">
                            {(compactResult.before.fileSizeBytes / 1024 / 1024).toFixed(2)} MB
                          </Descriptions.Item>
                          <Descriptions.Item label="总页数">
                            {compactResult.before.pageCount.toLocaleString()}
                          </Descriptions.Item>
                          <Descriptions.Item label="空闲页数">
                            <Tag color="orange">{compactResult.before.freelistCount.toLocaleString()}</Tag>
                          </Descriptions.Item>
                          <Descriptions.Item label="估算可回收">
                            <Tag color="green">{(compactResult.before.estimatedFreelistBytes / 1024 / 1024).toFixed(2)} MB</Tag>
                          </Descriptions.Item>
                        </Descriptions>
                      )}
                      {compactResult.after && (
                        <Descriptions column={2} bordered size="small" title="VACUUM 后" style={{ marginTop: 12 }}>
                          <Descriptions.Item label="文件大小">
                            {(compactResult.after.fileSizeBytes / 1024 / 1024).toFixed(2)} MB
                          </Descriptions.Item>
                          <Descriptions.Item label="总页数">
                            {compactResult.after.pageCount.toLocaleString()}
                          </Descriptions.Item>
                          <Descriptions.Item label="空闲页数">
                            {compactResult.after.freelistCount.toLocaleString()}
                          </Descriptions.Item>
                          <Descriptions.Item label="耗时">
                            {compactResult.durationMs != null ? `${compactResult.durationMs}ms` : "--"}
                          </Descriptions.Item>
                        </Descriptions>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        </Spin>
      </div>
    </Modal>

    <Drawer
      open={!!selectedCandidate}
      title={selectedCandidate ? `候选详情 · ${selectedCandidate.resourceKey}` : "候选详情"}
      width={560}
      onClose={() => setSelectedCandidate(null)}
      destroyOnClose
    >
      {selectedCandidate && (
        <div className="gc-debug__candidate-detail">
          {/* Section 1: 基本信息 */}
          <Descriptions column={2} bordered size="small" title="基本信息">
            <Descriptions.Item label="resourceKey" span={2}>
              <code>{selectedCandidate.resourceKey}</code>
            </Descriptions.Item>
            <Descriptions.Item label="blockId">
              <code>{selectedCandidate.blockId ?? "--"}</code>
            </Descriptions.Item>
            <Descriptions.Item label="blockVer">
              {selectedCandidate.blockVer ?? "--"}
            </Descriptions.Item>
            <Descriptions.Item label="版本创建时间" span={2}>
              {formatTime(selectedCandidate.versionCreatedAt)}
            </Descriptions.Item>
            <Descriptions.Item label="decision">
              {selectedCandidate.decision ?? "--"}
            </Descriptions.Item>
            <Descriptions.Item label="candidateClass">
              {selectedCandidate.candidateClass ? (
                (() => {
                  const { label, color } = CANDIDATE_CLASS_LABELS[selectedCandidate.candidateClass];
                  return <Tag color={color}>{label}</Tag>;
                })()
              ) : "--"}
            </Descriptions.Item>
          </Descriptions>

          <Divider />

          {/* Section 2: 判定原因 */}
          <div className="gc-debug__subsection">
            <h4>判定原因</h4>
            {selectedCandidate.decisionReasons && selectedCandidate.decisionReasons.length > 0 ? (
              <div className="gc-debug__decision-reasons-block">
                {selectedCandidate.decisionReasons.map((reason, idx) => (
                  <div key={idx} className="gc-debug__decision-reason-item">{reason}</div>
                ))}
              </div>
            ) : (
              <Typography.Text type="secondary">无判定原因文案，回退到 reasonCode：<Tag>{selectedCandidate.reasonCode}</Tag></Typography.Text>
            )}
          </div>

          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="reasonCode" span={2}>
              <Tag>{selectedCandidate.reasonCode}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="rootKind">
              {String(selectedCandidate.reasonDetail?.rootKind ?? "--")}
            </Descriptions.Item>
            <Descriptions.Item label="deleted">
              {selectedCandidate.reasonDetail?.deleted != null
                ? String(selectedCandidate.reasonDetail.deleted)
                : "--"}
            </Descriptions.Item>
            <Descriptions.Item label="source">
              {String(selectedCandidate.reasonDetail?.source ?? "--")}
            </Descriptions.Item>
            <Descriptions.Item label="ageMs">
              {formatAge(selectedCandidate.reasonDetail?.ageMs as number | undefined)}
            </Descriptions.Item>
            <Descriptions.Item label="ageBucket">
              {String(selectedCandidate.reasonDetail?.ageBucket ?? "--")}
            </Descriptions.Item>
            <Descriptions.Item label="distanceFromLatestVer">
              {selectedCandidate.reasonDetail?.distanceFromLatestVer != null
                ? String(selectedCandidate.reasonDetail.distanceFromLatestVer)
                : "--"}
            </Descriptions.Item>
          </Descriptions>

          {/* Root-entry 级字段 */}
          <Descriptions column={2} bordered size="small" title="Root Entry" style={{ marginTop: 12 }}>
            <Descriptions.Item label="rootRefType">
              {(() => {
                const refType = selectedCandidate.reasonDetail?.rootRefType as string | undefined;
                if (!refType) return "--";
                return <Tag>{ROOT_REF_TYPE_LABELS[refType] ?? refType}</Tag>;
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="rootRefId">
              <code>{String(selectedCandidate.reasonDetail?.rootRefId ?? "--")}</code>
            </Descriptions.Item>
            <Descriptions.Item label="rootRefKey" span={2}>
              <code>{String(selectedCandidate.reasonDetail?.rootRefKey ?? "--")}</code>
            </Descriptions.Item>
            <Descriptions.Item label="hardRooted">
              {selectedCandidate.reasonDetail?.hardRooted != null
                ? String(selectedCandidate.reasonDetail.hardRooted)
                : "--"}
            </Descriptions.Item>
            <Descriptions.Item label="retainedByPolicy">
              {selectedCandidate.reasonDetail?.retainedByPolicy != null
                ? String(selectedCandidate.reasonDetail.retainedByPolicy)
                : "--"}
            </Descriptions.Item>
            <Descriptions.Item label="rootSourceCount">
              {selectedCandidate.reasonDetail?.rootSourceCount != null
                ? String(selectedCandidate.reasonDetail.rootSourceCount)
                : "--"}
            </Descriptions.Item>
          </Descriptions>

          <Divider />

          {/* Section 3: 兼容字段 (downgraded) */}
          <details className="gc-debug__compat-section">
            <summary>兼容字段（旧版风险/动作/检查）</summary>
            <div className="gc-debug__compat-inner">
              {selectedCandidate.riskAssessment && (
                <div className="gc-debug__risk-assessment">
                  <div className="gc-debug__risk-header">
                    <Tag color={getRiskColor(selectedCandidate.riskAssessment.level)}>
                      {selectedCandidate.riskAssessment.level}
                    </Tag>
                    <span>风险分：<strong>{selectedCandidate.riskAssessment.score}</strong></span>
                  </div>
                  {selectedCandidate.riskAssessment.reasons.length > 0 && (
                    <div className="gc-debug__risk-reasons">
                      {selectedCandidate.riskAssessment.reasons.map((reason, idx) => (
                        <div key={idx} className="gc-debug__risk-reason-item">{reason}</div>
                      ))}
                    </div>
                  )}
                  {selectedCandidate.riskAssessment.factors.length > 0 && (
                    <div className="gc-debug__risk-factors">
                      <Typography.Text type="secondary">风险因子</Typography.Text>
                      {selectedCandidate.riskAssessment.factors.map((factor, idx) => (
                        <Tooltip key={idx} title={factor.detail ? JSON.stringify(factor.detail, null, 2) : undefined}>
                          <Tag className="gc-debug__factor-tag">
                            {factor.code}
                            <span className="gc-debug__factor-weight">
                              {factor.weight > 0 ? "+" : ""}{factor.weight}
                            </span>
                          </Tag>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Descriptions column={1} bordered size="small" style={{ marginTop: 12 }}>
                <Descriptions.Item label="plannedAction">
                  {selectedCandidate.plannedAction ? (
                    <Tag>{PLANNED_ACTION_LABELS[selectedCandidate.plannedAction] ?? selectedCandidate.plannedAction}</Tag>
                  ) : "--"}
                </Descriptions.Item>
                <Descriptions.Item label="readiness">
                  {selectedCandidate.readiness ? (
                    <Tag color={READINESS_LABELS[selectedCandidate.readiness].color}>
                      {READINESS_LABELS[selectedCandidate.readiness].label}
                    </Tag>
                  ) : "--"}
                </Descriptions.Item>
                <Descriptions.Item label="requiredChecks">
                  {selectedCandidate.requiredChecks && selectedCandidate.requiredChecks.length > 0 ? (
                    <div className="gc-debug__checks-list">
                      {selectedCandidate.requiredChecks.map((check) => (
                        <Tag key={check} className="gc-debug__check-tag">
                          {REQUIRED_CHECK_LABELS[check] ?? check}
                        </Tag>
                      ))}
                    </div>
                  ) : "--"}
                </Descriptions.Item>
                <Descriptions.Item label="riskLevel">
                  <Tag color={getRiskColor(selectedCandidate.riskLevel)}>{selectedCandidate.riskLevel ?? "medium"}</Tag>
                </Descriptions.Item>
              </Descriptions>
            </div>
          </details>

          <Divider />

          {/* Section 4: 扫描范围 */}
          <Descriptions column={1} bordered size="small" title="扫描范围">
            <Descriptions.Item label="docId">
              <code>{selectedCandidate.docId ?? "--"}</code>
            </Descriptions.Item>
            <Descriptions.Item label="workspaceId">
              <code>{selectedCandidate.workspaceId ?? "--"}</code>
            </Descriptions.Item>
          </Descriptions>

          <Divider />

          <details className="gc-debug__raw-detail">
            <summary>原始 reasonDetail JSON</summary>
            <pre className="gc-debug__json">{JSON.stringify(selectedCandidate.reasonDetail, null, 2)}</pre>
          </details>
        </div>
      )}
    </Drawer>

    <Drawer
      open={!!selectedPoolItem}
      title={selectedPoolItem ? `Pool 详情 · ${selectedPoolItem.candidateKey}` : "Pool 详情"}
      width={560}
      onClose={() => setSelectedPoolItem(null)}
      destroyOnClose
    >
      {selectedPoolItem && (
        <div className="gc-debug__candidate-detail">
          <Descriptions column={2} bordered size="small" title="基本信息">
            <Descriptions.Item label="candidateKey" span={2}>
              <code>{selectedPoolItem.candidateKey}</code>
            </Descriptions.Item>
            <Descriptions.Item label="resourceKey" span={2}>
              <code>{selectedPoolItem.resourceKey}</code>
            </Descriptions.Item>
            <Descriptions.Item label="blockId">
              <code>{selectedPoolItem.blockId ?? "--"}</code>
            </Descriptions.Item>
            <Descriptions.Item label="blockVer">
              {selectedPoolItem.blockVer ?? "--"}
            </Descriptions.Item>
            <Descriptions.Item label="action">
              {selectedPoolItem.action ? <Tag>{PLANNED_ACTION_LABELS[selectedPoolItem.action] ?? selectedPoolItem.action}</Tag> : "--"}
            </Descriptions.Item>
            <Descriptions.Item label="source">
              {selectedPoolItem.source ? <Tag>{SOURCE_LABELS[selectedPoolItem.source] ?? selectedPoolItem.source}</Tag> : "--"}
            </Descriptions.Item>
            <Descriptions.Item label="state">
              {(() => {
                const s = selectedPoolItem.state;
                const l = s ? POOL_STATE_LABELS[s] : null;
                return l ? <Tag color={l.color}>{l.label}</Tag> : <Tag>{s || "--"}</Tag>;
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="riskLevel">
              <Tag color={getRiskColor(selectedPoolItem.riskAssessment?.level ?? selectedPoolItem.riskLevel)}>
                {selectedPoolItem.riskAssessment?.level ?? selectedPoolItem.riskLevel ?? "--"}
              </Tag>
            </Descriptions.Item>
          </Descriptions>

          <Divider />

          <Descriptions column={2} bordered size="small" title="Root Entry">
            <Descriptions.Item label="rootRefType">
              {(() => {
                const refType = selectedPoolItem.reasonDetail?.rootRefType as string | undefined;
                if (!refType) return "--";
                return <Tag>{ROOT_REF_TYPE_LABELS[refType] ?? refType}</Tag>;
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="rootRefId">
              <code>{String(selectedPoolItem.reasonDetail?.rootRefId ?? "--")}</code>
            </Descriptions.Item>
            <Descriptions.Item label="rootRefKey" span={2}>
              <code>{String(selectedPoolItem.reasonDetail?.rootRefKey ?? "--")}</code>
            </Descriptions.Item>
          </Descriptions>

          <Divider />

          <Descriptions column={2} bordered size="small" title="晋升与执行">
            <Descriptions.Item label="eligibleAfter">
              {formatTime(selectedPoolItem.eligibleAfter)}
            </Descriptions.Item>
            <Descriptions.Item label="lastSweepAt">
              {formatTime(selectedPoolItem.lastSweepAt)}
            </Descriptions.Item>
            <Descriptions.Item label="lastValidationAt">
              {formatTime(selectedPoolItem.lastValidationAt)}
            </Descriptions.Item>
            <Descriptions.Item label="stableCount">
              {selectedPoolItem.stableCount ?? "--"}
            </Descriptions.Item>
            <Descriptions.Item label="firstSeenAt">
              {formatTime(selectedPoolItem.firstSeenAt)}
            </Descriptions.Item>
            <Descriptions.Item label="lastSeenAt">
              {formatTime(selectedPoolItem.lastSeenAt)}
            </Descriptions.Item>
          </Descriptions>

          {selectedPoolItem.lastBlockers && selectedPoolItem.lastBlockers.length > 0 && (
            <>
              <Divider />
              <div className="gc-debug__subsection">
                <h4>Blockers</h4>
                <div className="gc-debug__decision-reasons-block">
                  {selectedPoolItem.lastBlockers.map((b, idx) => (
                    <div key={idx} className="gc-debug__decision-reason-item">
                      <Tag color="red" className="gc-debug__blocker-tag">{BLOCKER_LABELS[b] ?? b}</Tag>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <Divider />

          <details className="gc-debug__compat-section">
            <summary>兼容字段（风险/动作/检查）</summary>
            <div className="gc-debug__compat-inner">
              {selectedPoolItem.riskAssessment && (
                <div className="gc-debug__risk-assessment">
                  <div className="gc-debug__risk-header">
                    <Tag color={getRiskColor(selectedPoolItem.riskAssessment.level)}>
                      {selectedPoolItem.riskAssessment.level}
                    </Tag>
                    <span>风险分：<strong>{selectedPoolItem.riskAssessment.score}</strong></span>
                  </div>
                  {selectedPoolItem.riskAssessment.reasons.length > 0 && (
                    <div className="gc-debug__risk-reasons">
                      {selectedPoolItem.riskAssessment.reasons.map((reason, idx) => (
                        <div key={idx} className="gc-debug__risk-reason-item">{reason}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <Descriptions column={1} bordered size="small" style={{ marginTop: 12 }}>
                <Descriptions.Item label="readiness">
                  {selectedPoolItem.readiness ? (() => {
                    const l = READINESS_LABELS[selectedPoolItem.readiness];
                    return l ? <Tag color={l.color}>{l.label}</Tag> : <Tag>{selectedPoolItem.readiness}</Tag>;
                  })() : "--"}
                </Descriptions.Item>
                <Descriptions.Item label="requiredChecks">
                  {selectedPoolItem.requiredChecks && selectedPoolItem.requiredChecks.length > 0 ? (
                    <div className="gc-debug__checks-list">
                      {selectedPoolItem.requiredChecks.map((check) => (
                        <Tag key={check} className="gc-debug__check-tag">
                          {REQUIRED_CHECK_LABELS[check] ?? check}
                        </Tag>
                      ))}
                    </div>
                  ) : "--"}
                </Descriptions.Item>
              </Descriptions>
            </div>
          </details>

          <Divider />

          <details className="gc-debug__raw-detail">
            <summary>原始 JSON</summary>
            <pre className="gc-debug__json">{JSON.stringify(selectedPoolItem, null, 2)}</pre>
          </details>
        </div>
      )}
    </Drawer>
    </>
  );
}

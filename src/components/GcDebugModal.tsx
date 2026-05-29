"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Descriptions, Divider, Drawer, Empty, Input, Modal, Spin, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  createBlockVersionGcRun,
  getBlockVersionGcCandidates,
  getBlockVersionGcHealth,
  getBlockVersionGcRun,
  getRunScannedBlocks,
  listBlockVersionGcRuns,
  type BlockVersionGcCandidate,
  type BlockVersionGcHealth,
  type BlockVersionGcPolicySnapshot,
  type BlockVersionGcRun,
  type CandidateClass,
  type GcScannedBlock,
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
  const [scannedBlocks, setScannedBlocks] = useState<GcScannedBlock[]>([]);
  const [scannedBlocksTotal, setScannedBlocksTotal] = useState(0);

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

      tasks.push(
        getRunScannedBlocks({
          token: activeToken,
          operatorId: activeOperatorId || undefined,
          runId: fullRun.runId,
          page: 1,
          pageSize: 20,
        }).then((result) => {
          setScannedBlocks(result.items);
          setScannedBlocksTotal(result.total);
        }),
      );

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

        const latestRun = runsResult.items[0] ?? null;
        if (latestRun) {
          await loadRunDetail(latestRun, activeToken, activeOperatorId);
        } else {
          setSelectedRun(null);
          setCandidates([]);
          setCandidatesTotal(0);
          setScannedBlocks([]);
          setScannedBlocksTotal(0);
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

  const scannedBlockColumns = useMemo<ColumnsType<GcScannedBlock>>(
    () => [
      {
        title: "Block ID",
        dataIndex: "blockId",
        key: "blockId",
        render: (value: string) => <code>{value}</code>,
      },
      {
        title: "Latest Ver",
        dataIndex: "latestVer",
        key: "latestVer",
        width: 100,
      },
      {
        title: "扫描版本数",
        dataIndex: "scannedVersionCount",
        key: "scannedVersionCount",
        width: 100,
      },
      {
        title: "最早版本",
        key: "oldestVersionCreatedAt",
        width: 160,
        render: (_, record) => formatTime(record.oldestVersionCreatedAt),
      },
      {
        title: "最新版本",
        key: "newestVersionCreatedAt",
        width: 160,
        render: (_, record) => formatTime(record.newestVersionCreatedAt),
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
              <Typography.Text type="secondary">{formatCount(runs.length)} 条已加载</Typography.Text>
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
            <Table
              size="small"
              rowKey={(record) => `${record.resourceKey}-${record.reasonCode}`}
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

          <section className="gc-debug__card gc-debug__card--table">
            <div className="gc-debug__card-head">
              <h3>Scanned Blocks</h3>
              <Typography.Text type="secondary">
                {selectedRun?.runId ? `run ${selectedRun.runId}` : "未选中 run"} / {formatCount(scannedBlocksTotal)} 块
              </Typography.Text>
            </div>
            <Table
              size="small"
              rowKey="blockId"
              columns={scannedBlockColumns}
              dataSource={scannedBlocks}
              pagination={false}
              locale={{ emptyText: "暂无扫描块数据" }}
            />
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
    </>
  );
}

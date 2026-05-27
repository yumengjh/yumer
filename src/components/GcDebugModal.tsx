"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Empty, Input, Modal, Spin, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  createBlockVersionGcRun,
  getBlockVersionGcCandidates,
  getBlockVersionGcHealth,
  getBlockVersionGcRun,
  listBlockVersionGcRuns,
  type BlockVersionGcCandidate,
  type BlockVersionGcHealth,
  type BlockVersionGcRun,
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
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatCount(value?: number) {
  return typeof value === "number" ? value.toLocaleString() : "0";
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
        width: 90,
        render: (_, record) => formatCount(record.summary?.blockVersionsScanned),
      },
      {
        title: "候选",
        key: "candidateBlockVersions",
        width: 90,
        render: (_, record) => formatCount(record.summary?.candidateBlockVersions),
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
        title: "原因",
        dataIndex: "reasonCode",
        key: "reasonCode",
        width: 240,
      },
      {
        title: "风险",
        dataIndex: "riskLevel",
        key: "riskLevel",
        width: 100,
        render: (value?: string) => <Tag color={value === "high" ? "red" : value === "low" ? "green" : "orange"}>{value || "medium"}</Tag>,
      },
      {
        title: "版本时间",
        dataIndex: "versionCreatedAt",
        key: "versionCreatedAt",
        width: 180,
        render: (value?: number) => formatTime(value),
      },
    ],
    [],
  );

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
        setSelectedRun(latestRun);
        if (latestRun) {
          const fullRun = await getBlockVersionGcRun({
            token: activeToken,
            operatorId: activeOperatorId || undefined,
            runId: latestRun.runId,
          });
          setSelectedRun(fullRun);
          if (fullRun.candidateDetailsStored) {
            await loadCandidatesForRun(activeToken, fullRun.runId, activeOperatorId);
          } else {
            setCandidates([]);
            setCandidatesTotal(0);
          }
        } else {
          setCandidates([]);
          setCandidatesTotal(0);
        }
      } catch (nextError) {
        const messageText = nextError instanceof Error ? nextError.message : "GC 调试信息加载失败";
        setError(messageText);
      } finally {
        setLoading(false);
      }
    },
    [docId, loadCandidatesForRun, operatorId, persistCredentials, token, workspaceId],
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
      setSelectedRun(run);
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

  const scopeLabel = useMemo(() => {
    return {
      workspaceId: workspaceId || "—",
      docId: docId || "—",
      docTitle: docTitle || "当前未选中文档",
    };
  }, [docId, docTitle, workspaceId]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1120}
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
          <span>工作区：<code>{scopeLabel.workspaceId}</code></span>
          <span>文档：<code>{scopeLabel.docId}</code></span>
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
                      <span className="gc-debug__metric-label">缺 root version</span>
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
                  <div className="gc-debug__metrics gc-debug__metrics--dense">
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">扫描</span>
                      <strong>{formatCount(selectedRun.summary?.blockVersionsScanned)}</strong>
                    </div>
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">硬 root</span>
                      <strong>{formatCount(selectedRun.summary?.hardRootedBlockVersions)}</strong>
                    </div>
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">策略保留</span>
                      <strong>{formatCount(selectedRun.summary?.policyRetainedBlockVersions)}</strong>
                    </div>
                    <div className="gc-debug__metric">
                      <span className="gc-debug__metric-label">候选</span>
                      <strong>{formatCount(selectedRun.summary?.candidateBlockVersions)}</strong>
                    </div>
                  </div>
                  <div className="gc-debug__meta">
                    <span>Run：<code>{selectedRun.runId}</code></span>
                    <span>开始：{formatTime(selectedRun.startedAt || selectedRun.createdAt)}</span>
                    <span>结束：{formatTime(selectedRun.finishedAt)}</span>
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
                  setSelectedRun(record);
                  if (record.candidateDetailsStored) {
                    void loadCandidatesForRun(token, record.runId, operatorId);
                  } else {
                    setCandidates([]);
                    setCandidatesTotal(0);
                  }
                },
              })}
            />
          </section>

          <section className="gc-debug__card gc-debug__card--table">
            <div className="gc-debug__card-head">
              <h3>Candidates</h3>
              <Typography.Text type="secondary">
                {selectedRun?.runId ? `run ${selectedRun.runId}` : "未选中 run"} · {formatCount(candidatesTotal)} 条
              </Typography.Text>
            </div>
            <Table
              size="small"
              rowKey={(record) => `${record.resourceKey}-${record.reasonCode}`}
              columns={candidateColumns}
              dataSource={candidates}
              pagination={false}
              locale={{ emptyText: "当前没有候选明细" }}
            />
          </section>
        </Spin>
      </div>
    </Modal>
  );
}

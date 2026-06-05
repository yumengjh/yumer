"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Collapse, Empty, Modal, Space, Statistic, Tag, Tabs, Tooltip, message } from "antd";
import {
  ClearOutlined,
  CopyOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  WarningOutlined,
  FlagOutlined,
} from "@ant-design/icons";
import {
  SyncDebugLog,
  SyncIdentityWatch,
  SyncTraceLog,
  type DeletedIdentityWatchRecord,
  type SyncDebugIncident,
  type SyncDebugRecord,
  type SyncTraceRecord,
} from "@/services/sync/debug-log";
import "./SyncDebugModal.css";

type SyncDebugModalProps = {
  open: boolean;
  onClose: () => void;
  docId?: string | null;
  docTitle?: string | null;
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="sync-debug-json">{JSON.stringify(value, null, 2)}</pre>;
}

function eventColor(event: string) {
  if (event === "identity:resurrected") return "error";
  if (event.includes("response")) return "processing";
  if (event.includes("dispatch")) return "blue";
  if (event.includes("manifest")) return "purple";
  if (event.includes("ack")) return "green";
  if (event === "debug:bookmark") return "gold";
  return "default";
}

function reasonLabel(reason: DeletedIdentityWatchRecord["reason"]) {
  if (reason === "batch-delete-request") return "delete 请求";
  if (reason === "batch-delete-ack") return "delete ACK";
  return "reconcile tombstone";
}

function RecordDetail({ record }: { record: SyncDebugRecord }) {
  const items = [
    {
      key: "request",
      label: "请求体",
      children: <JsonBlock value={record.requestBody} />,
    },
    {
      key: "response",
      label: record.success ? "响应体" : "错误",
      children: record.success ? (
        <JsonBlock value={record.responseBody} />
      ) : (
        <div className="sync-debug-error">{record.error}</div>
      ),
    },
  ];

  return <Tabs size="small" defaultActiveKey="request" items={items} />;
}

function TraceDetail({ record }: { record: SyncTraceRecord }) {
  return <JsonBlock value={record.payload} />;
}

function IncidentCard({ incident }: { incident: SyncDebugIncident }) {
  return (
    <div className="sync-debug-incident">
      <div className="sync-debug-incident__head">
        <Tag color="error" icon={<WarningOutlined />}>删除块回流</Tag>
        <span className="sync-debug-record-header__time">{formatTime(incident.timestamp)}</span>
        <Tag color={eventColor(incident.observedEvent)}>{incident.observedEvent}</Tag>
      </div>
      <div className="sync-debug-incident__message">{incident.message}</div>
      <div className="sync-debug-identity-row">
        {incident.identity.blockId ? <code>blockId:{incident.identity.blockId}</code> : null}
        {incident.identity.clientId ? <code>clientId:{incident.identity.clientId}</code> : null}
        {incident.identity.syncCreateId ? <code>syncCreateId:{incident.identity.syncCreateId}</code> : null}
      </div>
      <div className="sync-debug-incident__meta">
        删除来源：{reasonLabel(incident.deletedReason)} · 删除时间：{formatTime(incident.deletedAt)} · Trace：
        <code>{incident.observedTraceId}</code>
      </div>
      {incident.observedNode ? (
        <div className="sync-debug-node">
          <span>重新出现位置 #{incident.observedNode.index}</span>
          <span>{incident.observedNode.type}</span>
          <span>{incident.observedNode.textPreview || "(无文本)"}</span>
        </div>
      ) : null}
    </div>
  );
}

export function SyncDebugModal({ open, onClose, docId, docTitle }: SyncDebugModalProps) {
  const [records, setRecords] = useState<SyncDebugRecord[]>(() => SyncDebugLog.getAll());
  const [traceRecords, setTraceRecords] = useState<SyncTraceRecord[]>(() => SyncTraceLog.getAll());
  const [deletedRecords, setDeletedRecords] = useState<DeletedIdentityWatchRecord[]>(() => SyncIdentityWatch.getDeleted());
  const [incidents, setIncidents] = useState<SyncDebugIncident[]>(() => SyncIdentityWatch.getIncidents());
  const [refreshKey, setRefreshKey] = useState(0);
  const [recording, setRecording] = useState(() => SyncDebugLog.isEnabled());

  const refresh = useCallback(() => {
    setRecords(SyncDebugLog.getAll());
    setTraceRecords(SyncTraceLog.getAll());
    setDeletedRecords(SyncIdentityWatch.getDeleted());
    setIncidents(SyncIdentityWatch.getIncidents());
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  const handleToggleRecording = useCallback(() => {
    const next = !recording;
    SyncDebugLog.setEnabled(next);
    setRecording(next);
    message.info(next ? "已开始记录" : "已暂停记录");
    refresh();
  }, [recording, refresh]);

  const handleClear = useCallback(() => {
    SyncDebugLog.clear();
    SyncTraceLog.clear();
    refresh();
    message.success("已清空同步日志");
  }, [refresh]);

  const handleCopyAiBundle = useCallback(async () => {
    try {
      const bundle = SyncTraceLog.exportAiBundle({ docId });
      await navigator.clipboard.writeText(bundle);
      message.success(`已复制轻量 AI 包（${Math.ceil(bundle.length / 1024)} KB）`);
    } catch {
      message.error("复制失败");
    }
  }, [docId]);

  const handleCopyFullBundle = useCallback(async () => {
    try {
      const bundle = SyncTraceLog.exportBundle();
      await navigator.clipboard.writeText(bundle);
      message.success(`已复制完整包（${Math.ceil(bundle.length / 1024)} KB）`);
    } catch {
      message.error("复制失败");
    }
  }, []);

  const handleBookmark = useCallback(() => {
    if (!SyncTraceLog.isEnabled()) {
      message.warning("请先开始记录");
      return;
    }
    SyncTraceLog.add("debug:bookmark", docId ?? "unknown-doc", null, null, {
      docId: docId ?? null,
      docTitle: docTitle ?? null,
      markedAt: Date.now(),
      reason: "user-observed-sync-bug",
    });
    refresh();
    message.success("已标记现场");
  }, [docId, docTitle, refresh]);

  const sortedRecords = useMemo(() => [...records].reverse(), [records]);
  const sortedTraceRecords = useMemo(() => [...traceRecords].reverse(), [traceRecords]);
  const sortedDeletedRecords = useMemo(() => [...deletedRecords].reverse(), [deletedRecords]);
  const sortedIncidents = useMemo(() => [...incidents].reverse(), [incidents]);
  const deleteBatchCount = useMemo(
    () => records.filter((record) => JSON.stringify(record.requestBody).includes('"type":"delete"')).length,
    [records],
  );

  const batchItems = sortedRecords.map((record) => ({
    key: record.id,
    label: (
      <div className="sync-debug-record-header">
        <span className="sync-debug-record-header__time">{formatTime(record.timestamp)}</span>
        <Tag className="sync-debug-record-header__tag" color={record.source === "manual-save" ? "blue" : "default"}>
          {record.source}
        </Tag>
        <Tag
          className="sync-debug-record-header__tag"
          color={record.success ? "success" : "error"}
          icon={record.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        >
          {record.success ? "成功" : "失败"}
        </Tag>
        <span>{record.operationCount} 个操作</span>
        <span className="sync-debug-muted">{record.duration}ms</span>
      </div>
    ),
    children: <RecordDetail record={record} />,
  }));

  const traceItems = sortedTraceRecords.map((record) => ({
    key: record.traceId,
    label: (
      <div className="sync-debug-record-header">
        <span className="sync-debug-record-header__time">{formatTime(record.timestamp)}</span>
        <Tag color={eventColor(record.event)}>{record.event}</Tag>
        <span className="sync-debug-muted">{record.traceId}</span>
      </div>
    ),
    children: <TraceDetail record={record} />,
  }));

  const deletedItems = sortedDeletedRecords.map((record) => ({
    key: record.id,
    label: (
      <div className="sync-debug-record-header">
        <span className="sync-debug-record-header__time">{formatTime(record.timestamp)}</span>
        <Tag color="volcano">{reasonLabel(record.reason)}</Tag>
        <span className="sync-debug-muted">{record.clientBatchId ?? "-"}</span>
      </div>
    ),
    children: <JsonBlock value={record} />,
  }));

  const tabs = [
    {
      key: "overview",
      label: "概览",
      children: (
        <div className="sync-debug-overview">
          <div className="sync-debug-stats">
            <Statistic title="请求批次" value={records.length} />
            <Statistic title="Trace" value={traceRecords.length} />
            <Statistic title="删除观察" value={deletedRecords.length} />
            <Statistic title="异常" value={incidents.length} valueStyle={{ color: incidents.length > 0 ? "#cf1322" : undefined }} />
            <Statistic title="delete 批次" value={deleteBatchCount} />
          </div>
          <Alert
            type={incidents.length > 0 ? "error" : "info"}
            showIcon
            message={incidents.length > 0 ? "检测到已删除身份再次出现在前端快照中" : "记录开启后会自动捕捉请求、ACK、manifest 和删除身份回流"}
            description="遇到删除块又回来时，先点“标记现场”写入一条 debug:bookmark，用来定位你肉眼看到异常的时间点；再复制 AI 包。AI 包会过滤当前文档并压缩 manifest。"
          />
          {docId ? (
            <div className="sync-debug-scope">
              <span>当前文档</span>
              <strong>{docTitle ?? docId}</strong>
              <code>{docId}</code>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "incidents",
      label: `异常 ${incidents.length}`,
      children: (
        <div className="sync-debug-list" key={`incidents-${refreshKey}`}>
          {sortedIncidents.length === 0 ? (
            <Empty className="sync-debug-empty" description="暂无异常" />
          ) : (
            sortedIncidents.map((incident) => <IncidentCard key={incident.id} incident={incident} />)
          )}
        </div>
      ),
    },
    {
      key: "trace",
      label: `Trace ${traceRecords.length}`,
      children: sortedTraceRecords.length === 0 ? (
        <Empty className="sync-debug-empty" description="暂无 Trace" />
      ) : (
        <Collapse className="sync-debug-collapse" items={traceItems} size="small" accordion />
      ),
    },
    {
      key: "batches",
      label: `批次 ${records.length}`,
      children: sortedRecords.length === 0 ? (
        <Empty className="sync-debug-empty" description="暂无同步记录" />
      ) : (
        <Collapse className="sync-debug-collapse" items={batchItems} size="small" accordion />
      ),
    },
    {
      key: "deleted",
      label: `删除观察 ${deletedRecords.length}`,
      children: sortedDeletedRecords.length === 0 ? (
        <Empty className="sync-debug-empty" description="暂无删除观察" />
      ) : (
        <Collapse className="sync-debug-collapse" items={deletedItems} size="small" accordion />
      ),
    },
  ];

  return (
    <Modal
      title="同步引擎调试"
      open={open}
      onCancel={onClose}
      footer={null}
      width={1120}
      className="sync-debug-modal"
      destroyOnClose={false}
    >
      <div className="sync-debug-toolbar">
        <div className="sync-debug-toolbar__info">
          <Button
            size="small"
            type={recording ? "default" : "primary"}
            icon={recording ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={handleToggleRecording}
          >
            {recording ? "暂停记录" : "开始记录"}
          </Button>
          <Tag color={recording ? "processing" : "default"}>
            {recording ? "记录中" : "已暂停"}
          </Tag>
          <span>共 {records.length} 个批次，{traceRecords.length} 条 Trace</span>
        </div>
        <Space className="sync-debug-toolbar__actions">
          <Tooltip title="在 Trace 中写入 debug:bookmark，记录当前文档和时间点。看到删除块回流、请求风暴、内容异常时先点它，再复制 AI 包，分析时就能从这个标记附近倒查前后的请求、ACK 和快照。">
            <Button size="small" icon={<FlagOutlined />} onClick={handleBookmark}>
              标记现场
            </Button>
          </Tooltip>
          <Tooltip title="刷新">
            <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>
              刷新
            </Button>
          </Tooltip>
          <Tooltip title="复制轻量 AI 诊断包">
            <Button size="small" type="primary" icon={<CopyOutlined />} onClick={handleCopyAiBundle}>
              复制 AI 包
            </Button>
          </Tooltip>
          <Tooltip title="复制完整原始 JSON，体积可能很大">
            <Button size="small" icon={<CopyOutlined />} onClick={handleCopyFullBundle}>
              完整包
            </Button>
          </Tooltip>
          <Tooltip title="清空日志">
            <Button size="small" danger icon={<ClearOutlined />} onClick={handleClear}>
              清空
            </Button>
          </Tooltip>
        </Space>
      </div>

      <div className="sync-debug-body">
        <Tabs defaultActiveKey="overview" items={tabs} />
      </div>
    </Modal>
  );
}

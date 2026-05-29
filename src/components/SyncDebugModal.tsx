"use client";

import { useState, useCallback } from "react";
import { Button, Collapse, Empty, Modal, Space, Tag, Tabs, Tooltip, message } from "antd";
import {
  ClearOutlined,
  CopyOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
} from "@ant-design/icons";
import { SyncDebugLog, type SyncDebugRecord } from "@/services/sync/debug-log";
import "./SyncDebugModal.css";

type SyncDebugModalProps = {
  open: boolean;
  onClose: () => void;
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

function RecordDetail({ record }: { record: SyncDebugRecord }) {
  const items = [
    {
      key: "request",
      label: "请求体",
      children: <pre className="sync-debug-json">{JSON.stringify(record.requestBody, null, 2)}</pre>,
    },
    {
      key: "response",
      label: record.success ? "响应体" : "错误",
      children: record.success ? (
        <pre className="sync-debug-json">{JSON.stringify(record.responseBody, null, 2)}</pre>
      ) : (
        <div className="sync-debug-error">{record.error}</div>
      ),
    },
  ];

  return <Tabs size="small" defaultActiveKey="request" items={items} />;
}

export function SyncDebugModal({ open, onClose }: SyncDebugModalProps) {
  const [records, setRecords] = useState<SyncDebugRecord[]>(() => SyncDebugLog.getAll());
  const [refreshKey, setRefreshKey] = useState(0);
  const [recording, setRecording] = useState(() => SyncDebugLog.isEnabled());

  const handleToggleRecording = useCallback(() => {
    const next = !recording;
    SyncDebugLog.setEnabled(next);
    setRecording(next);
    message.info(next ? "已开始记录" : "已暂停记录");
  }, [recording]);

  const handleRefresh = useCallback(() => {
    setRecords(SyncDebugLog.getAll());
    setRefreshKey((k) => k + 1);
  }, []);

  const handleClear = useCallback(() => {
    SyncDebugLog.clear();
    setRecords([]);
    message.success("已清空同步日志");
  }, []);

  const handleCopyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(SyncDebugLog.formatAll());
      message.success("已复制到剪贴板");
    } catch {
      message.error("复制失败");
    }
  }, []);

  // 最新的在前
  const sorted = [...records].reverse();

  const collapseItems = sorted.map((record) => ({
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
        <span style={{ color: "var(--text-secondary, #999)" }}>{record.duration}ms</span>
      </div>
    ),
    children: <RecordDetail record={record} />,
  }));

  return (
    <Modal
      title="同步引擎调试"
      open={open}
      onCancel={onClose}
      footer={null}
      width={960}
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
          共 {records.length} 条记录
        </div>
        <Space className="sync-debug-toolbar__actions">
          <Tooltip title="刷新">
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRefresh}>
              刷新
            </Button>
          </Tooltip>
          <Tooltip title="复制全部（JSON）">
            <Button size="small" icon={<CopyOutlined />} onClick={handleCopyAll}>
              复制全部
            </Button>
          </Tooltip>
          <Tooltip title="清空日志">
            <Button size="small" danger icon={<ClearOutlined />} onClick={handleClear}>
              清空
            </Button>
          </Tooltip>
        </Space>
      </div>

      <div className="sync-debug-body" key={refreshKey}>
        {sorted.length === 0 ? (
          <Empty className="sync-debug-empty" description="暂无同步记录" />
        ) : (
          <Collapse
            items={collapseItems}
            size="small"
            accordion
          />
        )}
      </div>
    </Modal>
  );
}

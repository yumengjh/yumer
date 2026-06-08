"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Drawer, Empty, Input, Popconfirm, Spin, Tag, Tooltip, message } from "antd";
import {
  ClockCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  GlobalOutlined,
  InboxOutlined,
  LockOutlined,
  ReloadOutlined,
  TeamOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { useDocument } from "../contexts/DocumentContext";
import { listDocuments, type Document } from "../services/document";
import "./DocumentTrashDrawer.css";

interface DocumentTrashDrawerProps {
  open: boolean;
  onClose: () => void;
}

function visibilityIcon(visibility?: string) {
  switch (visibility) {
    case "workspace":
      return <TeamOutlined style={{ fontSize: 11, color: "var(--app-text-muted)" }} />;
    case "public":
      return <GlobalOutlined style={{ fontSize: 11, color: "var(--app-text-muted)" }} />;
    default:
      return <LockOutlined style={{ fontSize: 11, color: "var(--app-text-muted)" }} />;
  }
}

function statusTag(status?: string) {
  switch (status) {
    case "draft":
      return (
        <Tag color="default" style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
          草稿
        </Tag>
      );
    case "archived":
      return (
        <Tag color="orange" style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
          归档
        </Tag>
      );
    case "deleted":
      return (
        <Tag color="red" style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
          回收站
        </Tag>
      );
    default:
      return null;
  }
}

function formatTime(iso?: string | null) {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "--";
  }
}

function formatTrashDeadline(doc: Document) {
  if (typeof doc.trashDaysRemaining === "number") {
    if (doc.trashDaysRemaining <= 0) return "今天自动删除";
    return `${doc.trashDaysRemaining} 天后自动删除`;
  }
  if (doc.trashExpiresAt) return `自动删除：${formatTime(doc.trashExpiresAt)}`;
  return "自动删除时间未知";
}

export function DocumentTrashDrawer({ open, onClose }: DocumentTrashDrawerProps) {
  const { workspaceId, restoreDoc, permanentlyDeleteDoc, refreshDocs } = useDocument();
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(false);
  const [trashDocuments, setTrashDocuments] = useState<Document[]>([]);
  const [restoringDocId, setRestoringDocId] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  const loadTrashDocuments = useCallback(async () => {
    if (!workspaceId) {
      setTrashDocuments([]);
      return;
    }

    setLoading(true);
    try {
      const result = await listDocuments({
        workspaceId,
        status: "deleted",
        sortBy: "deletedAt",
        sortOrder: "DESC",
      });
      setTrashDocuments(result.items);
    } catch {
      message.error("加载回收站失败");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    setSearchText("");
    void loadTrashDocuments();
  }, [loadTrashDocuments, open]);

  const filteredDocuments = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return trashDocuments;
    return trashDocuments.filter((doc) => (doc.title || "").toLowerCase().includes(keyword));
  }, [searchText, trashDocuments]);

  const trashSummary = useMemo(() => {
    const expiringSoon = trashDocuments.filter(
      (doc) => typeof doc.trashDaysRemaining === "number" && doc.trashDaysRemaining <= 3,
    ).length;
    return { total: trashDocuments.length, expiringSoon };
  }, [trashDocuments]);

  const handleRestore = useCallback(
    async (docId: string) => {
      setRestoringDocId(docId);
      try {
        await restoreDoc(docId);
        await refreshDocs();
        await loadTrashDocuments();
        message.success("文档已恢复");
      } catch {
        message.error("恢复失败");
      } finally {
        setRestoringDocId((current) => (current === docId ? null : current));
      }
    },
    [loadTrashDocuments, refreshDocs, restoreDoc],
  );

  const handlePermanentDelete = useCallback(
    async (docId: string) => {
      setDeletingDocId(docId);
      try {
        await permanentlyDeleteDoc(docId);
        await refreshDocs();
        await loadTrashDocuments();
        message.success("文档已永久删除");
      } catch {
        message.error("永久删除失败");
      } finally {
        setDeletingDocId((current) => (current === docId ? null : current));
      }
    },
    [loadTrashDocuments, permanentlyDeleteDoc, refreshDocs],
  );

  return (
    <Drawer
      open={open}
      placement="top"
      height="86vh"
      onClose={onClose}
      destroyOnHidden
      className="document-trash-drawer"
      title="回收站"
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadTrashDocuments()}>
          刷新
        </Button>
      }
    >
      <div className="document-trash-drawer__toolbar">
        <Input
          prefix={<InboxOutlined style={{ color: "var(--app-text-muted)" }} />}
          placeholder="搜索回收站..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          className="document-trash-drawer__search"
        />
        <div className="document-trash-drawer__summary">
          <span>{trashSummary.total} 个文档</span>
          {trashSummary.expiringSoon > 0 ? <strong>{trashSummary.expiringSoon} 个即将自动删除</strong> : null}
        </div>
      </div>

      <Spin spinning={loading}>
        <div className="document-trash-drawer__grid">
          {filteredDocuments.length === 0 ? (
            <Empty
              description={searchText ? "没有匹配的回收站文档" : "回收站为空"}
              style={{ padding: "64px 0", gridColumn: "1 / -1" }}
            />
          ) : (
            filteredDocuments.map((doc) => (
              <div key={doc.docId} className="document-trash-drawer__card">
                <div className="document-trash-drawer__card-head">
                  <span className="document-trash-drawer__icon">
                    {doc.icon || <FileTextOutlined style={{ opacity: 0.45 }} />}
                  </span>
                  <div className="document-trash-drawer__title-wrap">
                    <span className="document-trash-drawer__title">{doc.title || "未命名文档"}</span>
                    <div className="document-trash-drawer__tags">
                      {statusTag(doc.deletedFromStatus || doc.status)}
                      {visibilityIcon(doc.visibility)}
                    </div>
                  </div>
                </div>

                <div className="document-trash-drawer__deadline">
                  <ClockCircleOutlined />
                  <span>{formatTrashDeadline(doc)}</span>
                </div>

                <div className="document-trash-drawer__meta">
                  <span>删除：{formatTime(doc.deletedAt)}</span>
                  {doc.deletedFromStatus ? <span>原状态：{doc.deletedFromStatus}</span> : null}
                </div>

                <div className="document-trash-drawer__actions">
                  <Tooltip title="恢复">
                    <Button
                      size="small"
                      icon={<UndoOutlined />}
                      loading={restoringDocId === doc.docId}
                      onClick={() => void handleRestore(doc.docId)}
                    >
                      恢复
                    </Button>
                  </Tooltip>
                  <Popconfirm
                    title="永久删除文档？"
                    description="真删除后无法从回收站恢复。"
                    okText="真删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true, loading: deletingDocId === doc.docId }}
                    onConfirm={() => void handlePermanentDelete(doc.docId)}
                  >
                    <Tooltip title="真删除">
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        loading={deletingDocId === doc.docId}
                      >
                        真删除
                      </Button>
                    </Tooltip>
                  </Popconfirm>
                </div>
              </div>
            ))
          )}
        </div>
      </Spin>
    </Drawer>
  );
}

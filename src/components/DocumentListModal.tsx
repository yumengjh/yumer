"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Modal,
  Input,
  Button,
  Tag,
  Popconfirm,
  message,
  Empty,
  Tooltip,
  Segmented,
  Spin,
} from "antd";
import {
  SearchOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UndoOutlined,
  LockOutlined,
  TeamOutlined,
  GlobalOutlined,
  FileTextOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import { useDocument } from "../contexts/DocumentContext";
import { listDocuments, type Document } from "../services/document";
import "./DocumentListModal.css";

interface DocumentListModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (docId: string) => void;
  onCreateNew: () => void;
  currentDocId?: string;
}

type DocumentViewMode = "active" | "trash";

export function DocumentListModal({
  open,
  onClose,
  onSelect,
  onCreateNew,
  currentDocId,
}: DocumentListModalProps) {
  const { workspaceId, documents, updateDoc, deleteDoc, restoreDoc, permanentlyDeleteDoc, refreshDocs } = useDocument();
  const [searchText, setSearchText] = useState("");
  const [viewMode, setViewMode] = useState<DocumentViewMode>("active");
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [trashDocuments, setTrashDocuments] = useState<Document[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [permanentlyDeletingDocId, setPermanentlyDeletingDocId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const loadTrashDocuments = useCallback(async () => {
    if (!workspaceId) {
      setTrashDocuments([]);
      return;
    }

    setTrashLoading(true);
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
      setTrashLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    setSearchText("");
    setRenamingDocId(null);
    setViewMode("active");
    refreshDocs().catch(() => {});
  }, [open, refreshDocs]);

  useEffect(() => {
    if (!open || viewMode !== "trash") return;
    void loadTrashDocuments();
  }, [loadTrashDocuments, open, viewMode]);

  useEffect(() => {
    if (renamingDocId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingDocId]);

  const visibleDocs = viewMode === "trash" ? trashDocuments : documents;

  const filtered = useMemo(() => {
    if (!searchText.trim()) return visibleDocs;
    const q = searchText.toLowerCase();
    return visibleDocs.filter((doc) => doc.title.toLowerCase().includes(q));
  }, [searchText, visibleDocs]);

  const handleStartRename = useCallback(
    (e: React.MouseEvent, docId: string, title: string) => {
      e.stopPropagation();
      setRenamingDocId(docId);
      setRenameValue(title);
    },
    [],
  );

  const handleSaveRename = useCallback(
    async (docId: string) => {
      const trimmed = renameValue.trim();
      setRenamingDocId(null);
      if (!trimmed) return;
      const doc = documents.find((item) => item.docId === docId);
      if (!doc || trimmed === doc.title) return;
      try {
        await updateDoc(docId, { title: trimmed });
        message.success("重命名成功");
      } catch {
        message.error("重命名失败");
      }
    },
    [documents, renameValue, updateDoc],
  );

  const handleTrash = useCallback(
    async (docId: string) => {
      try {
        await deleteDoc(docId);
        message.success("文档已移至回收站");
        if (viewMode === "trash") {
          await loadTrashDocuments();
        }
      } catch {
        message.error("移至回收站失败");
      }
    },
    [deleteDoc, loadTrashDocuments, viewMode],
  );

  const handleRestore = useCallback(
    async (docId: string) => {
      try {
        await restoreDoc(docId);
        message.success("文档已恢复");
        await loadTrashDocuments();
      } catch {
        message.error("恢复失败");
      }
    },
    [loadTrashDocuments, restoreDoc],
  );

  const handlePermanentDelete = useCallback(
    async (docId: string) => {
      setPermanentlyDeletingDocId(docId);
      try {
        await permanentlyDeleteDoc(docId);
        message.success("文档已永久删除");
        await loadTrashDocuments();
      } catch {
        message.error("永久删除失败");
      } finally {
        setPermanentlyDeletingDocId((current) => (current === docId ? null : current));
      }
    },
    [loadTrashDocuments, permanentlyDeleteDoc],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, docId: string) => {
      if (e.key === "Enter") {
        handleSaveRename(docId);
      } else if (e.key === "Escape") {
        setRenamingDocId(null);
      }
    },
    [handleSaveRename],
  );

  const visibilityIcon = (visibility?: string) => {
    switch (visibility) {
      case "workspace":
        return <TeamOutlined style={{ fontSize: 11, color: "var(--app-text-muted)" }} />;
      case "public":
        return <GlobalOutlined style={{ fontSize: 11, color: "var(--app-text-muted)" }} />;
      default:
        return <LockOutlined style={{ fontSize: 11, color: "var(--app-text-muted)" }} />;
    }
  };

  const statusLabel = (status?: string) => {
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
  };

  const formatTime = (iso?: string | null) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  const formatTrashDeadline = (doc: Document) => {
    if (typeof doc.trashDaysRemaining === "number") {
      if (doc.trashDaysRemaining <= 0) return "今天自动删除";
      return `${doc.trashDaysRemaining} 天后自动删除`;
    }
    if (doc.trashExpiresAt) return `自动删除：${formatTime(doc.trashExpiresAt)}`;
    return "自动删除时间未知";
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title="文档管理"
      width={560}
      className="doc-list-modal"
      destroyOnHidden
      zIndex={1100}
    >
      <div className="doc-list__toolbar">
        <Input
          prefix={<SearchOutlined style={{ color: "var(--app-text-muted)" }} />}
          placeholder="搜索文档..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          size="small"
          className="doc-list__search"
        />
        <Segmented
          size="small"
          value={viewMode}
          onChange={(value) => setViewMode(value as DocumentViewMode)}
          options={[
            { label: "文档", value: "active" },
            { label: "回收站", value: "trash", icon: <InboxOutlined /> },
          ]}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          size="small"
          onClick={() => {
            onClose();
            onCreateNew();
          }}
        >
          新建
        </Button>
      </div>

      <div className={`doc-list__items ${viewMode === "trash" ? "doc-list__items--trash-grid" : ""}`}>
        <Spin spinning={viewMode === "trash" && trashLoading}>
          {filtered.length === 0 ? (
            <Empty
              description={searchText ? "没有匹配的文档" : viewMode === "trash" ? "回收站为空" : "暂无文档"}
              style={{ padding: "40px 0" }}
            />
          ) : (
            filtered.map((doc) => (
              <div
                key={doc.docId}
                className={`doc-list__item ${
                  viewMode === "active" && currentDocId === doc.docId ? "doc-list__item--active" : ""
                } ${viewMode === "trash" ? "doc-list__item--trash" : ""}`}
                onClick={() => {
                  if (viewMode === "trash") return;
                  if (renamingDocId === doc.docId) return;
                  onSelect(doc.docId);
                }}
              >
                <span className="doc-list__item-icon">
                  {doc.icon || <FileTextOutlined style={{ opacity: 0.4 }} />}
                </span>

                <div className="doc-list__item-body">
                  {viewMode === "active" && renamingDocId === doc.docId ? (
                    <Input
                      ref={renameInputRef as any}
                      size="small"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleSaveRename(doc.docId)}
                      onKeyDown={(e) => handleKeyDown(e, doc.docId)}
                      onClick={(e) => e.stopPropagation()}
                      className="doc-list__rename-input"
                    />
                  ) : (
                    <span className="doc-list__item-title">{doc.title}</span>
                  )}
                  <span className="doc-list__item-meta">
                    {statusLabel(doc.status)}
                    {viewMode === "trash" && doc.deletedFromStatus ? statusLabel(doc.deletedFromStatus) : null}
                    {visibilityIcon(doc.visibility)}
                    <span className="doc-list__item-time">
                      {formatTime(viewMode === "trash" ? doc.deletedAt ?? doc.updatedAt : doc.updatedAt)}
                    </span>
                    {viewMode === "trash" ? (
                      <span className="doc-list__item-deadline">{formatTrashDeadline(doc)}</span>
                    ) : null}
                  </span>
                </div>

                <div className="doc-list__item-actions" onClick={(e) => e.stopPropagation()}>
                  {viewMode === "active" ? (
                    <>
                      <Tooltip title="重命名">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={(e) => handleStartRename(e, doc.docId, doc.title)}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="移至回收站？"
                        description="文档会先保留在回收站，之后可以恢复。"
                        onConfirm={() => {
                          void handleTrash(doc.docId);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                        okText="移至回收站"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                      >
                        <Tooltip title="移至回收站">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Tooltip>
                      </Popconfirm>
                    </>
                  ) : (
                    <>
                      <Tooltip title="恢复">
                        <Button
                          type="text"
                          size="small"
                          icon={<UndoOutlined />}
                          onClick={() => void handleRestore(doc.docId)}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="永久删除文档？"
                        description="真删除后无法从回收站恢复。"
                        onConfirm={() => void handlePermanentDelete(doc.docId)}
                        onCancel={(e) => e?.stopPropagation()}
                        okText="真删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true, loading: permanentlyDeletingDocId === doc.docId }}
                      >
                        <Tooltip title="真删除">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            loading={permanentlyDeletingDocId === doc.docId}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Tooltip>
                      </Popconfirm>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </Spin>
      </div>
    </Modal>
  );
}

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Select,
  Button,
  Typography,
  Tag,
  Spin,
  Input,
  Space,
  message,
  Tooltip,
  Dropdown,
} from "antd";
import type { InputRef, MenuProps } from "antd";
import {
  SaveOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LogoutOutlined,
  FileTextOutlined,
  UnorderedListOutlined,
  SendOutlined,
  LockOutlined,
  TeamOutlined,
  GlobalOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  MenuOutlined,
  TagsOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { useDocument } from "../contexts/DocumentContext";
import { VersionDiffModal } from "./VersionDiffModal";
import { DocumentListModal } from "./DocumentListModal";
import { CreateDocumentModal } from "./CreateDocumentModal";
import { DocumentInfoModal } from "./DocumentInfoModal";
import { TagManagementModal } from "./TagManagementModal";
import { useAuth } from "../contexts/AuthContext";
import "./DocumentHeader.css";

const { Text } = Typography;

interface DocumentHeaderProps {
  onSave: () => void;
  showTOC: boolean;
  onToggleTOC: (open: boolean) => void;
}

export function DocumentHeader({ onSave, showTOC, onToggleTOC }: DocumentHeaderProps) {
  const {
    currentDoc,
    saveStatus,
    lastSavedAt,
    selectDoc,
    updateDoc,
    publishDoc,
    refreshDocs,
  } = useDocument();
  const { user, logout } = useAuth();

  // 标题编辑
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const titleInputRef = useRef<InputRef>(null);
  const [publishing, setPublishing] = useState(false);
  const [visibilityChanging, setVisibilityChanging] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  // 弹窗状态
  const [listOpen, setListOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [tagManageOpen, setTagManageOpen] = useState(false);

  useEffect(() => {
    refreshDocs().catch(() => {});
  }, [refreshDocs]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const handleDocChange = useCallback(
    async (docId: string) => {
      try {
        await selectDoc(docId);
      } catch {
        message.error("加载文档失败");
      }
    },
    [selectDoc],
  );

  const startEditTitle = useCallback(() => {
    if (!currentDoc) return;
    setTitleValue(currentDoc.title);
    setEditingTitle(true);
  }, [currentDoc]);

  const cancelEditTitle = useCallback(() => {
    setEditingTitle(false);
    setTitleValue("");
  }, []);

  const saveTitle = useCallback(async () => {
    if (!currentDoc) return;
    const trimmed = titleValue.trim();
    if (!trimmed || trimmed === currentDoc.title) {
      cancelEditTitle();
      return;
    }
    setTitleSaving(true);
    try {
      await updateDoc(currentDoc.docId, { title: trimmed });
      setEditingTitle(false);
      message.success("标题已更新");
    } catch {
      message.error("更新标题失败");
    } finally {
      setTitleSaving(false);
    }
  }, [currentDoc, titleValue, updateDoc, cancelEditTitle]);

  const handleVisibilityChange = useCallback(
    async (value: string) => {
      if (!currentDoc) return;
      setVisibilityChanging(true);
      try {
        await updateDoc(currentDoc.docId, { visibility: value });
      } catch {
        message.error("修改可见性失败");
      } finally {
        setVisibilityChanging(false);
      }
    },
    [currentDoc, updateDoc],
  );

  const handlePublish = useCallback(async () => {
    if (!currentDoc) return;
    setPublishing(true);
    try {
      await publishDoc(currentDoc.docId);
      message.success("发布成功");
    } catch {
      message.error("发布失败");
    } finally {
      setPublishing(false);
    }
  }, [currentDoc, publishDoc]);

  const saveStatusLabel = {
    idle: null,
    dirty: (
      <Space size={4}>
        <ExclamationCircleOutlined style={{ color: "#faad14", fontSize: 11 }} />
        <Text type="warning" style={{ fontSize: 11 }}>
          未同步
        </Text>
      </Space>
    ),
    flushing: (
      <Space size={4}>
        <Spin size="small" />
        <Text type="secondary" style={{ fontSize: 11 }}>
          同步中...
        </Text>
      </Space>
    ),
    saved: (
      <Space size={4}>
        <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 11 }} />
        <Text type="secondary" style={{ fontSize: 11 }}>
          {lastSavedAt
            ? `${lastSavedAt.getHours().toString().padStart(2, "0")}:${lastSavedAt
                .getMinutes()
                .toString()
                .padStart(2, "0")} 已同步到草稿`
            : "已同步到草稿"}
        </Text>
      </Space>
    ),
    error: (
      <Space size={4}>
        <ExclamationCircleOutlined style={{ color: "#ff4d4f", fontSize: 11 }} />
        <Text type="danger" style={{ fontSize: 11 }}>
          保存失败
        </Text>
      </Space>
    ),
  };

  return (
    <div className="document-header">
      <div className="document-header-left">
        <Button
          type="text"
          className="doc-list-trigger"
          onClick={() => setListOpen(true)}
          icon={<MenuOutlined style={{ fontSize: 14 }} />}
          size="small"
        >
          {currentDoc?.icon ? (
            <span>{currentDoc.icon}</span>
          ) : (
            <FileTextOutlined style={{ fontSize: 13, opacity: 0.5 }} />
          )}
          <span className="doc-list-trigger__title">
            {currentDoc?.title || "选择文档"}
          </span>
        </Button>
      </div>

      <div className="document-header-center">
        {currentDoc && (
          editingTitle ? (
            <div className="title-edit-group">
              <Input
                ref={titleInputRef}
                className="title-edit-input"
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onPressEnter={saveTitle}
                onBlur={saveTitle}
                disabled={titleSaving}
                size="small"
              />
              {titleSaving && <Spin size="small" />}
            </div>
          ) : (
            <button
              className="title-display"
              onClick={startEditTitle}
              title="点击编辑标题"
            >
              <FileTextOutlined style={{ fontSize: 13, opacity: 0.5 }} />
              <span>{currentDoc.title}</span>
            </button>
          )
        )}
      </div>

      <div className="document-header-right">
        {/* 保存状态 — 始终显示 */}
        {saveStatusLabel[saveStatus]}
        {/* 保存按钮 — 始终显示 */}
        <Tooltip title="手动保存">
          <Button
            type="text"
            icon={<SaveOutlined />}
            size="small"
            onClick={onSave}
            disabled={saveStatus === "flushing"}
          />
        </Tooltip>

        {/* 桌面端完整操作区 */}
        {currentDoc && (
          <span className="header-actions-desktop">
            <Select
              size="small"
              value={currentDoc.visibility || "private"}
              onChange={handleVisibilityChange}
              loading={visibilityChanging}
              style={{ width: 100 }}
              options={[
                { value: "private", label: <Space size={4}><LockOutlined />私有</Space> },
                { value: "workspace", label: <Space size={4}><TeamOutlined />工作空间</Space> },
                { value: "public", label: <Space size={4}><GlobalOutlined />公开</Space> },
              ]}
              popupMatchSelectWidth={false}
            />
            {currentDoc.publishedHead ? (
              <Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                已发布 v{currentDoc.publishedHead}
              </Text>
            ) : null}
            <Tooltip title="发布（设为公开）">
              <Button
                type="primary"
                icon={<SendOutlined />}
                size="small"
                loading={publishing}
                onClick={handlePublish}
              >
                发布
              </Button>
            </Tooltip>
            <Tooltip title="版本对比">
              <Button type="text" icon={<HistoryOutlined />} size="small" onClick={() => setDiffOpen(true)} />
            </Tooltip>
            <Tooltip title="标签管理">
              <Button type="text" icon={<TagsOutlined />} size="small" onClick={() => setTagManageOpen(true)} />
            </Tooltip>
            <Tooltip title="文档信息">
              <Button type="text" icon={<InfoCircleOutlined />} size="small" onClick={() => setInfoOpen(true)} />
            </Tooltip>
            <Tooltip title={showTOC ? "隐藏目录" : "显示目录"}>
              <Button type={showTOC ? "primary" : "text"} icon={<UnorderedListOutlined />} size="small" onClick={() => onToggleTOC(!showTOC)} />
            </Tooltip>
          </span>
        )}

        {/* 移动端折叠操作区 */}
        <span className="header-actions-mobile">
          {currentDoc && (
            <Dropdown
              placement="bottomRight"
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "publish",
                    icon: <SendOutlined />,
                    label: "发布文档",
                    onClick: handlePublish,
                  },
                  {
                    key: "toc",
                    icon: <UnorderedListOutlined />,
                    label: showTOC ? "隐藏目录" : "显示目录",
                    onClick: () => onToggleTOC(!showTOC),
                  },
                  {
                    key: "history",
                    icon: <HistoryOutlined />,
                    label: "版本对比",
                    onClick: () => setDiffOpen(true),
                  },
                  {
                    key: "tags",
                    icon: <TagsOutlined />,
                    label: "标签管理",
                    onClick: () => setTagManageOpen(true),
                  },
                  {
                    key: "info",
                    icon: <InfoCircleOutlined />,
                    label: "文档信息",
                    onClick: () => setInfoOpen(true),
                  },
                  { type: "divider" },
                  {
                    key: "visibility-private",
                    icon: <LockOutlined />,
                    label: "设为私有",
                    onClick: () => handleVisibilityChange("private"),
                  },
                  {
                    key: "visibility-public",
                    icon: <GlobalOutlined />,
                    label: "设为公开",
                    onClick: () => handleVisibilityChange("public"),
                  },
                  { type: "divider" },
                  {
                    key: "logout",
                    icon: <LogoutOutlined />,
                    label: `退出 (${user?.displayName || user?.username})`,
                    danger: true,
                    onClick: logout,
                  },
                ] as MenuProps["items"],
              }}
            >
              <Button type="text" icon={<MoreOutlined />} size="small" />
            </Dropdown>
          )}
          {!currentDoc && (
            <Tooltip title="退出登录">
              <Button type="text" icon={<LogoutOutlined />} size="small" onClick={logout} danger />
            </Tooltip>
          )}
        </span>

        {/* 用户标签 — 仅桌面显示 */}
        <Tag className="document-header-user header-user-desktop" closable={false} color="blue">
          {user?.displayName || user?.username}
        </Tag>
        {/* 退出按钮 — 仅桌面显示 */}
        <span className="header-logout-desktop">
          <Tooltip title="退出登录">
            <Button type="text" icon={<LogoutOutlined />} size="small" onClick={logout} danger />
          </Tooltip>
        </span>
      </div>
      {currentDoc && (
        <VersionDiffModal
          open={diffOpen}
          onClose={() => setDiffOpen(false)}
          docId={currentDoc.docId}
        />
      )}
      <DocumentListModal
        open={listOpen}
        onClose={() => setListOpen(false)}
        onSelect={(docId) => {
          setListOpen(false);
          handleDocChange(docId);
        }}
        onCreateNew={() => {
          setListOpen(false);
          setCreateOpen(true);
        }}
        currentDocId={currentDoc?.docId}
      />
      <CreateDocumentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      {currentDoc && (
        <DocumentInfoModal
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          doc={currentDoc}
        />
      )}
      <TagManagementModal
        open={tagManageOpen}
        onClose={() => setTagManageOpen(false)}
      />
    </div>
  );
}

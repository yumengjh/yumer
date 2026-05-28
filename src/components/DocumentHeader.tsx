import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Button, Spin, message, Tooltip, Dropdown, Modal, Input } from "antd";
import type { MenuProps } from "antd";
import {
  SearchOutlined,
  SaveOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LogoutOutlined,
  FileTextOutlined,
  UnorderedListOutlined,
  SendOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  MenuOutlined,
  TagsOutlined,
  MoreOutlined,
  UserOutlined,
  SettingOutlined,
  ReloadOutlined,
  DownloadOutlined,
  CodeOutlined,
  FilePdfOutlined,
  BugOutlined,
  PushpinOutlined,
} from "@ant-design/icons";
import { useDocument, type SaveStatus } from "../contexts/DocumentContext";
import { VersionDiffModal } from "./VersionDiffModal";
import DocumentSidebar from "./DocumentSidebar";
import { TagManagementModal } from "./TagManagementModal";
import { WorkspaceSettingsModal } from "./WorkspaceSettingsModal";
import { DocumentSearchModal } from "./DocumentSearchModal";
import { CreateDocumentModal } from "./CreateDocumentModal";
import { useAuth } from "../contexts/AuthContext";
import type {
  AppSettings,
  SettingsPriority,
  SettingsScope,
  UserSettings,
  WorkspaceSettings,
} from "@/services/settings";
import {
  revalidatePublicDocument,
  type ManualPublicDocRevalidationResult,
} from "@/services/public-doc-revalidation";
import type { PublicDocRevalidationResult } from "@/services/document";
import { downloadDocumentExport, type DocumentExportFormat } from "@/services/document-export";
import { getDocumentSyncState } from "@/services/sync/api";
import { GcDebugModal } from "./GcDebugModal";
import "./DocumentHeader.css";

const PUBLIC_DOC_REVALIDATE_SECRET_KEY = "publicDocRevalidateSecret";

interface DocumentHeaderProps {
  onSave: () => void | Promise<void>;
  onRememberPosition: () => void | Promise<void>;
  onDiscardDraft: () => void;
  saving?: boolean;
  rememberingPosition?: boolean;
  discardingDraft?: boolean;
  showTOC: boolean;
  onToggleTOC: (open: boolean) => void;
  settingsScope: SettingsScope;
  settingsPriority: SettingsPriority;
  settingsByScope: {
    user: UserSettings;
    workspace: WorkspaceSettings;
  };
  effectiveSettings: AppSettings;
  settingsSaving?: boolean;
  onSettingsScopeChange: (scope: SettingsScope) => void;
  onSettingsPriorityChange: (priority: SettingsPriority) => void;
  onSaveSettings: (
    scope: SettingsScope,
    settings: UserSettings | WorkspaceSettings,
  ) => Promise<void>;
}

type VisibleSaveStatus = Exclude<SaveStatus, "idle">;

function SyncStatus({
  status,
  lastSavedAt,
}: {
  status: VisibleSaveStatus;
  lastSavedAt: Date | null;
}) {
  const timeLabel = lastSavedAt
    ? `${lastSavedAt.getHours().toString().padStart(2, "0")}:${lastSavedAt
        .getMinutes()
        .toString()
        .padStart(2, "0")}`
    : null;

  const map: Record<VisibleSaveStatus, { icon: ReactNode; text: string; mod: string }> = {
    loaded: { icon: <CheckCircleOutlined />, text: "已加载最新版本", mod: "loaded" },
    dirty: { icon: <ExclamationCircleOutlined />, text: "未同步", mod: "dirty" },
    flushing: { icon: <Spin size="small" />, text: "同步中", mod: "flushing" },
    "draft-synced": { icon: <CheckCircleOutlined />, text: "已同步至草稿", mod: "draft-synced" },
    saved: {
      icon: <CheckCircleOutlined />,
      text: timeLabel ? `${timeLabel} 已保存为最新版本` : "已保存为最新版本",
      mod: "saved",
    },
    error: { icon: <ExclamationCircleOutlined />, text: "保存失败", mod: "error" },
  };

  const item = map[status];

  return (
    <span
      className={`header-sync header-sync--${item.mod}`}
      role="status"
      aria-live="polite"
      title={item.text}
    >
      <span className="header-sync__icon">{item.icon}</span>
      <span className="header-sync__text">{item.text}</span>
    </span>
  );
}

function stringifyRevalidationBody(body: unknown): string {
  if (body === null || body === undefined) return "";
  if (typeof body === "string") return body;

  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function describePublishRevalidation(result: PublicDocRevalidationResult): string {
  if (result.success) {
    return "发布成功，公开页缓存已刷新";
  }

  if (!result.attempted) {
    const reasonMap: Record<NonNullable<PublicDocRevalidationResult["skippedReason"]>, string> = {
      not_public: "文档不是公开状态，未刷新公开页缓存",
      missing_config: "后端未配置刷新回调，公开页缓存未刷新",
      invalid_slug: "文档公开链接编码失败，公开页缓存未刷新",
    };
    return `发布成功，${result.skippedReason ? reasonMap[result.skippedReason] : "公开页缓存未刷新"}`;
  }

  const detail = result.status
    ? `状态码 ${result.status}`
    : result.error || "未知错误";
  return result.responseBody
    ? `发布成功，但公开页缓存刷新失败：${detail}，${result.responseBody}`
    : `发布成功，但公开页缓存刷新失败：${detail}`;
}

function showManualRevalidationMessage(result: ManualPublicDocRevalidationResult) {
  const bodyText = stringifyRevalidationBody(result.body);
  if (result.ok) {
    message.success(bodyText ? `公开页缓存已刷新：${bodyText}` : "公开页缓存已刷新");
    return;
  }

  message.error(
    bodyText
      ? `公开页缓存刷新失败：状态码 ${result.status}，${bodyText}`
      : `公开页缓存刷新失败：状态码 ${result.status}`,
  );
}

export function DocumentHeader({
  onSave,
  onRememberPosition,
  onDiscardDraft,
  saving = false,
  rememberingPosition = false,
  discardingDraft = false,
  showTOC,
  onToggleTOC,
  settingsScope,
  settingsPriority,
  settingsByScope,
  effectiveSettings,
  settingsSaving = false,
  onSettingsScopeChange,
  onSettingsPriorityChange,
  onSaveSettings,
}: DocumentHeaderProps) {
  const {
    currentDoc,
    saveStatus,
    lastSavedAt,
    currentContentSource,
    currentDocSlug,
    selectDoc,
    publishDoc,
    refreshDocs,
  } = useDocument();
  const { user, logout } = useAuth();

  const [publishing, setPublishing] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [tagManageOpen, setTagManageOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<DocumentExportFormat | null>(null);
  const [gcDebugOpen, setGcDebugOpen] = useState(false);

  useEffect(() => {
    refreshDocs().catch(() => {});
  }, [refreshDocs]);

  // Ctrl+K / Ctrl+J 打开搜索
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === "k" || key === "j")) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  const handlePublish = useCallback(async () => {
    if (!currentDoc) return;
    setPublishing(true);
    try {
      const result = await publishDoc(currentDoc.docId);
      const content = describePublishRevalidation(result.revalidation);
      if (result.revalidation.success) {
        message.success(content);
      } else if (result.revalidation.attempted) {
        message.warning(content);
      } else {
        message.info(content);
      }
    } catch {
      message.error("发布失败");
    } finally {
      setPublishing(false);
    }
  }, [currentDoc, publishDoc]);

  const requestRevalidateSecret = useCallback((): Promise<string | null> => {
    if (typeof window === "undefined") return Promise.resolve(null);

    const stored = sessionStorage.getItem(PUBLIC_DOC_REVALIDATE_SECRET_KEY);
    if (stored) return Promise.resolve(stored);

    let nextSecret = "";
    return new Promise((resolve) => {
      Modal.confirm({
        title: "刷新公开页缓存",
        content: (
          <Input.Password
            autoFocus
            placeholder="请输入刷新密钥"
            onChange={(event) => {
              nextSecret = event.target.value;
            }}
            onPressEnter={() => {
              const trimmed = nextSecret.trim();
              if (trimmed) {
                sessionStorage.setItem(PUBLIC_DOC_REVALIDATE_SECRET_KEY, trimmed);
                Modal.destroyAll();
                resolve(trimmed);
              }
            }}
          />
        ),
        okText: "刷新",
        cancelText: "取消",
        onOk: () => {
          const trimmed = nextSecret.trim();
          if (!trimmed) {
            message.warning("请输入刷新密钥");
            return Promise.reject();
          }
          sessionStorage.setItem(PUBLIC_DOC_REVALIDATE_SECRET_KEY, trimmed);
          resolve(trimmed);
          return undefined;
        },
        onCancel: () => resolve(null),
      });
    });
  }, []);

  const exportDocumentNow = useCallback(
    async (format: DocumentExportFormat) => {
      if (!currentDoc || exportingFormat) return;
      setExportingFormat(format);
      try {
        const result = await downloadDocumentExport(currentDoc.docId, format);
        message.success(`已开始导出 ${result.filename}`);
      } catch (error) {
        message.error(`导出失败：${error instanceof Error ? error.message : "未知错误"}`);
      } finally {
        setExportingFormat((current) => (current === format ? null : current));
      }
    },
    [currentDoc, exportingFormat],
  );

  const handleExport = useCallback(
    async (format: DocumentExportFormat) => {
      if (!currentDoc) return;
      if (exportingFormat) return;
      if (saving || saveStatus === "flushing") {
        message.info("文档正在保存，请稍后再导出");
        return;
      }

      let syncState: Awaited<ReturnType<typeof getDocumentSyncState>> | null = null;
      try {
        syncState = await getDocumentSyncState(currentDoc.docId);
      } catch {
        syncState = null;
      }

      const shouldPromptSave =
        saveStatus === "dirty" ||
        saveStatus === "draft-synced" ||
        Boolean(syncState?.hasPendingDraft || (syncState?.pendingCount ?? 0) > 0);

      if (shouldPromptSave) {
        Modal.confirm({
          title: "先保存再导出？",
          content: "当前文档还有未提交变更。导出会基于最近一次提交版本。",
          okText: "先保存并导出",
          cancelText: "直接导出",
          onOk: async () => {
            await Promise.resolve(onSave());
            await exportDocumentNow(format);
          },
          onCancel: () => {
            void exportDocumentNow(format);
          },
        });
        return;
      }

      await exportDocumentNow(format);
    },
    [currentDoc, exportDocumentNow, exportingFormat, onSave, saveStatus, saving],
  );

  const handleManualRevalidate = useCallback(async () => {
    if (!currentDoc || !currentDocSlug) return;
    if (currentDoc.visibility !== "public") {
      message.info("仅公开文档需要刷新公开页缓存");
      return;
    }

    const secret = await requestRevalidateSecret();
    if (!secret) return;

    setRevalidating(true);
    try {
      const result = await revalidatePublicDocument(currentDocSlug, secret);
      showManualRevalidationMessage(result);
      if (!result.ok && result.status === 401 && typeof window !== "undefined") {
        sessionStorage.removeItem(PUBLIC_DOC_REVALIDATE_SECRET_KEY);
      }
    } catch (error) {
      message.error(`公开页缓存刷新失败：${error instanceof Error ? error.message : "网络错误"}`);
    } finally {
      setRevalidating(false);
    }
  }, [currentDoc, currentDocSlug, requestRevalidateSecret]);

  const accountMenuItems: MenuProps["items"] = [
    {
      key: "user",
      label: user?.displayName || user?.username || "未登录",
      disabled: true,
    },
    { type: "divider" },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "退出登录",
      danger: true,
      onClick: logout,
    },
  ];

  const exportMenuItems: MenuProps["items"] = [
    {
      key: "export-md",
      icon: <FileTextOutlined />,
      label: "导出 Markdown",
      disabled: Boolean(exportingFormat),
      onClick: () => void handleExport("md"),
    },
    {
      key: "export-html",
      icon: <CodeOutlined />,
      label: "导出 HTML 压缩包",
      disabled: Boolean(exportingFormat),
      onClick: () => void handleExport("html"),
    },
    {
      key: "export-pdf",
      icon: <FilePdfOutlined />,
      label: "导出 PDF",
      disabled: Boolean(exportingFormat),
      onClick: () => void handleExport("pdf"),
    },
  ];

  const mobileMoreItems: MenuProps["items"] = currentDoc
    ? [
        {
          key: "history",
          icon: <HistoryOutlined />,
          label: "版本历史",
          onClick: () => setDiffOpen(true),
        },
        {
          key: "remember-position",
          icon: <PushpinOutlined />,
          label: "记住当前位置",
          disabled: rememberingPosition,
          onClick: () => void onRememberPosition(),
        },
        {
          key: "revalidate",
          icon: <ReloadOutlined />,
          label: "刷新公开页缓存",
          disabled: currentDoc.visibility !== "public" || revalidating,
          onClick: handleManualRevalidate,
        },
        {
          key: "export",
          icon: <DownloadOutlined />,
          label: "导出",
          children: exportMenuItems,
        },
        { type: "divider" },
        {
          key: "toc",
          icon: <UnorderedListOutlined />,
          label: showTOC ? "隐藏目录" : "显示目录",
          onClick: () => onToggleTOC(!showTOC),
        },
        {
          key: "tags",
          icon: <TagsOutlined />,
          label: "标签管理",
          onClick: () => setTagManageOpen(true),
        },
      ]
    : undefined;

  const visibleSaveStatus: VisibleSaveStatus | null = saveStatus === "idle" ? null : saveStatus;

  return (
    <header className="document-header">
      {/* 左侧：导航 + 工具；同步状态钉在最右，不挤占按钮 */}
      <div className="header-start">
        <div className="header-start__core">
          <button
            type="button"
            className="header-doc"
            onClick={() => setListOpen(true)}
            title={currentDoc?.title || "选择文档"}
          >
            <MenuOutlined className="header-doc__menu" />
            {currentDoc?.icon ? (
              <span className="header-doc__emoji">{currentDoc.icon}</span>
            ) : (
              <FileTextOutlined className="header-doc__file" />
            )}
            <span className="header-doc__title">
              {currentDoc?.title || "选择文档"}
            </span>
          </button>

          <Tooltip title="搜索 (Ctrl+K)">
            <button
              type="button"
              className="header-search-btn"
              onClick={() => setSearchOpen(true)}
              aria-label="搜索"
            >
              <SearchOutlined />
              <span className="header-search-btn__text">搜索</span>
            </button>
          </Tooltip>

          {currentDoc && (
            <nav className="header-nav header-nav--desktop" aria-label="文档工具">
              <Tooltip title="版本历史">
                <button
                  type="button"
                  className="header-icon-btn"
                  onClick={() => setDiffOpen(true)}
                  aria-label="版本历史"
                >
                  <HistoryOutlined />
                </button>
              </Tooltip>
            </nav>
          )}

          <Dropdown
            placement="bottomLeft"
            trigger={["click"]}
            menu={{ items: accountMenuItems }}
          >
            <button
              type="button"
              className="header-icon-btn"
              aria-label="账号"
              title={user?.displayName || user?.username || "账号"}
            >
              <UserOutlined />
            </button>
          </Dropdown>
        </div>

        <Tooltip title="页面设置">
          <button
            type="button"
            className="header-icon-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="页面设置"
          >
            <SettingOutlined />
          </button>
        </Tooltip>

        {currentDoc && (
          <Tooltip title="GC 调试面板">
            <button
              type="button"
              className="header-icon-btn header-btn-gc"
              onClick={() => setGcDebugOpen(true)}
              aria-label="GC 调试面板"
            >
              <BugOutlined />
            </button>
          </Tooltip>
        )}

        {currentDoc && visibleSaveStatus && (
          <div className="header-start__live">
            <SyncStatus status={visibleSaveStatus} lastSavedAt={lastSavedAt} />
          </div>
        )}
      </div>

      {/* 右侧：主操作 + 辅助 */}
      {currentDoc && (
        <div className="header-end">
          <div className="header-end__primary header-end--desktop">
            <Button
              size="small"
              className="header-btn-save"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={onSave}
              disabled={saving || saveStatus === "flushing"}
            >
              保存
            </Button>
            <Button
              size="small"
              className="header-btn-remember-position"
              icon={<PushpinOutlined />}
              loading={rememberingPosition}
              onClick={() => void onRememberPosition()}
            >
              记住当前位置
            </Button>
            {currentContentSource === "draft" ? (
              <Button
                size="small"
                className="header-btn-discard"
                loading={discardingDraft}
                onClick={onDiscardDraft}
              >
                取消草稿
              </Button>
            ) : null}
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              loading={publishing}
              onClick={handlePublish}
            >
              发布
            </Button>
            <Tooltip
              title={
                currentDoc.visibility === "public"
                  ? "刷新公开页缓存"
                  : "仅公开文档需要刷新公开页缓存"
              }
            >
              <Button
                size="small"
                className="header-btn-revalidate"
                icon={<ReloadOutlined />}
                loading={revalidating}
                onClick={handleManualRevalidate}
                disabled={currentDoc.visibility !== "public" || revalidating}
                aria-label="刷新公开页缓存"
              />
            </Tooltip>
            <Dropdown placement="bottomLeft" trigger={["click"]} menu={{ items: exportMenuItems }}>
              <Button
                size="small"
                className="header-btn-export"
                icon={<DownloadOutlined />}
                loading={Boolean(exportingFormat)}
                disabled={Boolean(exportingFormat)}
              >
                导出
              </Button>
            </Dropdown>
            {currentDoc.publishedHead ? (
              <span className="header-published" title={`已发布版本 ${currentDoc.publishedHead}`}>
                <span className="header-published__dot" />
                v{currentDoc.publishedHead}
              </span>
            ) : null}
          </div>

          <nav className="header-nav header-end--desktop" aria-label="视图">
            <Tooltip title={showTOC ? "隐藏目录" : "显示目录"}>
              <button
                type="button"
                className={`header-icon-btn${showTOC ? " is-active" : ""}`}
                onClick={() => onToggleTOC(!showTOC)}
                aria-label={showTOC ? "隐藏目录" : "显示目录"}
                aria-pressed={showTOC}
              >
                <UnorderedListOutlined />
              </button>
            </Tooltip>
            <Tooltip title="标签管理">
              <button
                type="button"
                className="header-icon-btn"
                onClick={() => setTagManageOpen(true)}
                aria-label="标签管理"
              >
                <TagsOutlined />
              </button>
            </Tooltip>
          </nav>

          <div className="header-end--mobile">
            <Button
              size="small"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={onSave}
              disabled={saving || saveStatus === "flushing"}
              aria-label="保存"
            />
            <Button
              size="small"
              icon={<PushpinOutlined />}
              loading={rememberingPosition}
              onClick={() => void onRememberPosition()}
              aria-label="记住当前位置"
            />
            {currentContentSource === "draft" ? (
              <Button
                size="small"
                loading={discardingDraft}
                onClick={onDiscardDraft}
                aria-label="取消草稿"
              >
                取消草稿
              </Button>
            ) : null}
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              loading={publishing}
              onClick={handlePublish}
              aria-label="发布"
            />
            {mobileMoreItems && mobileMoreItems.length > 0 ? (
              <Dropdown
                placement="bottomRight"
                trigger={["click"]}
                menu={{ items: mobileMoreItems }}
              >
                <button type="button" className="header-icon-btn" aria-label="更多">
                  <MoreOutlined />
                </button>
              </Dropdown>
            ) : null}
          </div>
        </div>
      )}

      {currentDoc && (
        <VersionDiffModal
          open={diffOpen}
          onClose={() => setDiffOpen(false)}
          docId={currentDoc.docId}
        />
      )}
      <DocumentSidebar
        visible={listOpen}
        onToggle={() => setListOpen(!listOpen)}
        onSelect={(docId) => {
          handleDocChange(docId);
        }}
        currentDocId={currentDoc?.docId}
      />
      <DocumentSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <CreateDocumentModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <WorkspaceSettingsModal
        open={settingsOpen}
        saving={settingsSaving}
        scope={settingsScope}
        priority={settingsPriority}
        settingsByScope={settingsByScope}
        effectiveSettings={effectiveSettings}
        onClose={() => setSettingsOpen(false)}
        onScopeChange={onSettingsScopeChange}
        onPriorityChange={onSettingsPriorityChange}
        onSubmit={async (nextSettings) => {
          await onSaveSettings(settingsScope, nextSettings);
          setSettingsOpen(false);
        }}
      />
      <TagManagementModal open={tagManageOpen} onClose={() => setTagManageOpen(false)} />
      <GcDebugModal
        open={gcDebugOpen}
        onClose={() => setGcDebugOpen(false)}
        workspaceId={currentDoc?.workspaceId}
        docId={currentDoc?.docId}
        docTitle={currentDoc?.title}
      />
    </header>
  );
}

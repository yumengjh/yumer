import { useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { Button, Spin, Switch, message, Tooltip, Dropdown, Modal, Input, Tag } from "antd";
import type { MenuProps } from "antd";
import {
  SearchOutlined,
  SaveOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LogoutOutlined,
  FileTextOutlined,
  UnorderedListOutlined,
  SendOutlined,
  HistoryOutlined,
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
  DatabaseOutlined,
  FileSearchOutlined,
  DownOutlined,
} from "@ant-design/icons";
import { useDocument, type SaveStatus } from "../contexts/DocumentContext";
import { VersionDiffModal } from "./VersionDiffModal";
import DocumentSidebar from "./DocumentSidebar";
import { TagManagementModal } from "./TagManagementModal";
import { WorkspaceSettingsModal } from "./WorkspaceSettingsModal";
import { DocumentSearchModal } from "./DocumentSearchModal";
import { CreateDocumentModal } from "./CreateDocumentModal";
import { useAuth } from "../contexts/AuthContext";
import type { LocalSnapshotState } from "@/hooks/useLocalDocumentSnapshot";
import type { TiptapDoc } from "@/services/tiptap-converter";
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
import { SyncDebugLog, type SyncDebugRecord } from "@/services/sync/debug-log";
import { GcDebugModal } from "./GcDebugModal";
import { SyncDebugModal } from "./SyncDebugModal";
import {
  loadFilterKeys,
  saveFilterKeys,
  deepFilterKeys,
  DEFAULT_FILTER_KEYS,
} from "@/services/local-snapshot-filter";
import {
  compareLocalSnapshotBlocks,
  type LocalSnapshotBlockChange,
} from "@/services/local-snapshot-compare";
import {
  buildLocalSnapshotDiffEntries,
  DEFAULT_VISIBLE_DIFF_CATEGORIES,
  filterLocalSnapshotDiffEntries,
  type LocalSnapshotDiffCategory,
  type LocalSnapshotDiffEntry,
} from "@/services/local-snapshot-diff-explorer";
import type { EditorToolbarPreferences } from "@/services/editor-toolbar-preferences";
import type { EditorSyncPreferences } from "@/services/editor-sync-preferences";
import type { ManualSaveMode } from "@/services/manual-save-preferences";
import "./DocumentHeader.css";

const PUBLIC_DOC_REVALIDATE_SECRET_KEY = "publicDocRevalidateSecret";
const EMPTY_LOCAL_SNAPSHOT_BLOCK_COMPARE: ReturnType<typeof compareLocalSnapshotBlocks> = {
  matches: true,
  summary: {
    totalBefore: 0,
    totalAfter: 0,
    unchanged: 0,
    added: 0,
    deleted: 0,
    modified: 0,
    moved: 0,
    metadataOnly: 0,
  },
  changes: [],
};

interface DocumentHeaderProps {
  onSave: (mode: ManualSaveMode) => void | Promise<void>;
  manualSaveMode: ManualSaveMode;
  onManualSaveModeChange: (mode: ManualSaveMode) => void;
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
  toolbarPreferences: EditorToolbarPreferences;
  syncPreferences: EditorSyncPreferences;
  settingsSaving?: boolean;
  onSettingsScopeChange: (scope: SettingsScope) => void;
  onSettingsPriorityChange: (priority: SettingsPriority) => void;
  onToolbarPreferencesChange: (preferences: EditorToolbarPreferences) => void;
  onSyncPreferencesChange: (preferences: EditorSyncPreferences) => void;
  onSaveSettings: (
    scope: SettingsScope,
    settings: UserSettings | WorkspaceSettings,
  ) => Promise<void>;
  localSnapshotState: LocalSnapshotState;
  onRefreshLocalSnapshot: () => Promise<void>;
  onCopyLocalSnapshot: () => Promise<boolean>;
  onCopyCurrentSnapshot: () => Promise<boolean>;
  onClearLocalSnapshot: () => Promise<void>;
  onManualSaveSnapshot: () => Promise<void>;
  autoSaveSnapshotEnabled: boolean;
  onAutoSaveSnapshotChange: (enabled: boolean) => void;
  currentDocumentContent: TiptapDoc | null;
  onRevertedToVersion?: () => void | Promise<void>;
  /** 打开/关闭查找替换栏 */
  onToggleFindReplace?: () => void;
}

type LocalSnapshotCompareMode = "explorer" | "raw";

const DIFF_CATEGORY_LABELS: Record<LocalSnapshotDiffCategory, string> = {
  content: "内容",
  sort: "sortKey / 顺序",
  style: "样式",
  structure: "结构",
  "auto-meta": "自动生成元数据",
  "other-meta": "其它元数据",
};

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
    "no-draft": {
      icon: <CheckCircleOutlined />,
      text: "没有草稿需要保存",
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

function LocalSnapshotStatus({
  state,
  onClick,
  filteredMatch,
}: {
  state: LocalSnapshotState;
  onClick: () => void;
  filteredMatch?: boolean;
}) {
  const timeLabel = state.lastSavedAt
    ? new Date(state.lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const effectiveStatus: LocalSnapshotState["status"] =
    state.status === "mismatch" && filteredMatch ? "saved" : state.status;

  const map: Record<LocalSnapshotState["status"], { text: string; mod: string }> = {
    idle: { text: "本地快照", mod: "idle" },
    checking: { text: "本地快照校验中", mod: "checking" },
    missing: { text: "本地快照：缺失", mod: "missing" },
    saved: { text: timeLabel ? `本地快照：${timeLabel}` : "本地快照：已保存", mod: "saved" },
    mismatch: { text: "本地快照：不一致", mod: "mismatch" },
    saving: { text: "本地快照：写入中", mod: "saving" },
    error: { text: "本地快照：失败", mod: "error" },
  };

  const item = map[effectiveStatus];

  return (
    <button
      type="button"
      className={`header-local-snapshot header-local-snapshot--${item.mod}`}
      onClick={onClick}
      title={state.error ?? item.text}
    >
      <DatabaseOutlined className="header-local-snapshot__icon" />
      <span className="header-local-snapshot__text">{item.text}</span>
    </button>
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

function stringifyFilteredDoc(content: TiptapDoc | null, filterKeys: Set<string>): string | null {
  if (!content) return null;
  try {
    return JSON.stringify(deepFilterKeys(content, filterKeys), null, 2);
  } catch {
    return null;
  }
}

function stringifyCompactJson(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

async function copyCompactJsonToClipboard(text: string | null, label: string): Promise<void> {
  if (!text) {
    message.warning(`${label}为空，无法复制`);
    return;
  }
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    message.error("当前环境不支持剪贴板复制");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    message.success(`${label}已复制`);
  } catch (error) {
    message.error(`复制失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
}

function buildCurrentDocumentSyncDebugPayload(records: SyncDebugRecord[], docId: string | null | undefined) {
  if (!docId) return [];
  return records
    .filter((record) => record.docId === docId)
    .map((record) => ({
      id: record.id,
      timestamp: record.timestamp,
      source: record.source,
      docId: record.docId,
      baseVersion: record.baseVersion,
      clientBatchId: record.clientBatchId,
      operationCount: record.operationCount,
      duration: record.duration,
      success: record.success,
      requestBody: record.requestBody,
      responseBody: record.responseBody ?? null,
      error: record.error ?? null,
    }));
}

function describeBlockPosition(change: LocalSnapshotBlockChange): string {
  const from = change.beforeIndex === null ? "新增" : `#${change.beforeIndex + 1}`;
  const to = change.afterIndex === null ? "删除" : `#${change.afterIndex + 1}`;
  return `${from} → ${to}`;
}

function blockChangeLabel(kind: LocalSnapshotBlockChange["kind"]): string {
  const map: Record<LocalSnapshotBlockChange["kind"], string> = {
    added: "新增",
    deleted: "删除",
    modified: "修改",
    moved: "移动",
    "metadata-only": "仅元数据",
  };
  return map[kind];
}

function blockChangeKey(change: LocalSnapshotBlockChange): string {
  return `${change.kind}-${change.blockKey}-${change.beforeIndex ?? "new"}-${change.afterIndex ?? "gone"}`;
}

function diffEntryKey(entry: LocalSnapshotDiffEntry): string {
  return blockChangeKey(entry.change);
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
  manualSaveMode,
  onManualSaveModeChange,
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
  toolbarPreferences,
  syncPreferences,
  settingsSaving = false,
  onSettingsScopeChange,
  onSettingsPriorityChange,
  onToolbarPreferencesChange,
  onSyncPreferencesChange,
  onSaveSettings,
  localSnapshotState,
  onRefreshLocalSnapshot,
  onCopyLocalSnapshot,
  onCopyCurrentSnapshot,
  onClearLocalSnapshot,
  onManualSaveSnapshot,
  autoSaveSnapshotEnabled,
  onAutoSaveSnapshotChange,
  currentDocumentContent,
  onRevertedToVersion,
  onToggleFindReplace,
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
  const [syncDebugOpen, setSyncDebugOpen] = useState(false);
  const [localSnapshotOpen, setLocalSnapshotOpen] = useState(false);
  const [localSnapshotCompareOpen, setLocalSnapshotCompareOpen] = useState(false);
  const [manualSnapshotSaving, setManualSnapshotSaving] = useState(false);
  const [compareFilterKeys, setCompareFilterKeys] = useState<string[]>(() => loadFilterKeys());
  const [compareFilterInput, setCompareFilterInput] = useState("");
  const [diffMode, setDiffMode] = useState<LocalSnapshotCompareMode>("explorer");
  const [diffQuery, setDiffQuery] = useState("");
  const [visibleDiffCategories, setVisibleDiffCategories] = useState<Set<LocalSnapshotDiffCategory>>(
    () => new Set(DEFAULT_VISIBLE_DIFF_CATEGORIES),
  );
  const [expandedBlockChangeKey, setExpandedBlockChangeKey] = useState<string | null>(null);

  const handleAddCompareFilter = useCallback(() => {
    const key = compareFilterInput.trim();
    if (!key || compareFilterKeys.includes(key)) return;
    const next = [...compareFilterKeys, key];
    setCompareFilterKeys(next);
    saveFilterKeys(next);
    setCompareFilterInput("");
  }, [compareFilterInput, compareFilterKeys]);

  const handleRemoveCompareFilter = useCallback(
    (key: string) => {
      const next = compareFilterKeys.filter((k) => k !== key);
      setCompareFilterKeys(next);
      saveFilterKeys(next);
    },
    [compareFilterKeys],
  );

  const handleResetCompareFilters = useCallback(() => {
    setCompareFilterKeys([...DEFAULT_FILTER_KEYS]);
    saveFilterKeys([...DEFAULT_FILTER_KEYS]);
  }, []);

  const toggleDiffCategory = useCallback((category: LocalSnapshotDiffCategory, enabled: boolean) => {
    setVisibleDiffCategories((current) => {
      const next = new Set(current);
      if (enabled) {
        next.add(category);
      } else {
        next.delete(category);
      }
      return next;
    });
  }, []);

  const compareFilterKeySet = useMemo(() => new Set(compareFilterKeys), [compareFilterKeys]);
  const shouldComputeSnapshotBlockCompare =
    localSnapshotCompareOpen || localSnapshotState.status === "mismatch";

  const snapshotBlockCompare = useMemo(
    () => {
      if (
        !shouldComputeSnapshotBlockCompare ||
        !localSnapshotState.storedSnapshot ||
        !currentDocumentContent
      ) {
        return EMPTY_LOCAL_SNAPSHOT_BLOCK_COMPARE;
      }
      return compareLocalSnapshotBlocks(
        localSnapshotState.storedSnapshot?.content ?? null,
        currentDocumentContent,
        { ignoredKeys: compareFilterKeySet },
      );
    },
    [
      localSnapshotState.storedSnapshot,
      currentDocumentContent,
      compareFilterKeySet,
      shouldComputeSnapshotBlockCompare,
    ],
  );

  const snapshotFilteredMatch = useMemo(() => {
    const snapshot = localSnapshotState.storedSnapshot;
    if (!snapshot || !currentDocumentContent) return false;
    if (localSnapshotState.status !== "mismatch") return false;
    return snapshotBlockCompare.matches;
  }, [localSnapshotState.status, localSnapshotState.storedSnapshot, currentDocumentContent, snapshotBlockCompare]);

  const snapshotDiffEntries = useMemo(
    () => buildLocalSnapshotDiffEntries(snapshotBlockCompare.changes, compareFilterKeySet),
    [compareFilterKeySet, snapshotBlockCompare.changes],
  );

  const visibleSnapshotDiffEntries = useMemo(
    () =>
      filterLocalSnapshotDiffEntries(snapshotDiffEntries, {
        query: diffQuery,
        visibleCategories: visibleDiffCategories,
      }),
    [diffQuery, snapshotDiffEntries, visibleDiffCategories],
  );

  const expandedBlockChange = useMemo(
    () =>
      expandedBlockChangeKey
        ? snapshotBlockCompare.changes.find((change) => blockChangeKey(change) === expandedBlockChangeKey) ?? null
        : null,
    [expandedBlockChangeKey, snapshotBlockCompare.changes],
  );

  const expandedDiffEntry = useMemo(
    () =>
      expandedBlockChange
        ? snapshotDiffEntries.find((entry) => blockChangeKey(entry.change) === blockChangeKey(expandedBlockChange)) ??
          null
        : null,
    [expandedBlockChange, snapshotDiffEntries],
  );

  const diffCategoryCounts = useMemo(() => {
    const counts = new Map<LocalSnapshotDiffCategory, number>();
    for (const entry of snapshotDiffEntries) {
      for (const category of entry.categories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return counts;
  }, [snapshotDiffEntries]);

  const hiddenAutoMetaCount = useMemo(
    () =>
      snapshotDiffEntries.filter(
        (entry) => entry.categories.has("auto-meta") && !visibleDiffCategories.has("auto-meta"),
      ).length,
    [snapshotDiffEntries, visibleDiffCategories],
  );

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
        const result = await downloadDocumentExport(currentDoc.docId, format, currentDoc.title);
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
            await Promise.resolve(onSave(manualSaveMode));
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
    [currentDoc, exportDocumentNow, exportingFormat, manualSaveMode, onSave, saveStatus, saving],
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
  const saveModeLabel = manualSaveMode === "reload" ? "保存并刷新" : "保存";
  const saveModeTooltip =
    manualSaveMode === "reload"
      ? "保存后重新拉取完整内容"
      : "仅提交增量同步结果，不重新拉取完整内容";
  const saveModeMenuItems: MenuProps["items"] = [
    {
      key: "incremental",
      label: "仅保存",
      icon: manualSaveMode === "incremental" ? <CheckCircleOutlined /> : null,
    },
    {
      key: "reload",
      label: "保存并重新拉取完整内容",
      icon: manualSaveMode === "reload" ? <CheckCircleOutlined /> : null,
    },
  ];
  const handleSaveModeMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "incremental" || key === "reload") {
      onManualSaveModeChange(key);
    }
  };

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
              {onToggleFindReplace && (
                <Tooltip title="查找替换 (Ctrl+F)">
                  <button
                    type="button"
                    className="header-icon-btn"
                    onClick={onToggleFindReplace}
                    aria-label="查找替换"
                  >
                    <FileSearchOutlined />
                  </button>
                </Tooltip>
              )}
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

        {currentDoc && (
          <Tooltip title="同步调试">
            <button
              type="button"
              className="header-icon-btn"
              onClick={() => setSyncDebugOpen(true)}
              aria-label="同步调试"
            >
              <CodeOutlined />
            </button>
          </Tooltip>
        )}

        {currentDoc && visibleSaveStatus && (
          <div className="header-start__live">
            <SyncStatus status={visibleSaveStatus} lastSavedAt={lastSavedAt} />
            <LocalSnapshotStatus state={localSnapshotState} onClick={() => setLocalSnapshotOpen(true)} filteredMatch={snapshotFilteredMatch} />
          </div>
        )}
      </div>

      {/* 右侧：主操作 + 辅助 */}
      {currentDoc && (
        <div className="header-end">
          <div className="header-end__primary header-end--desktop">
            <div className="header-btn-group">
              <Button.Group className="header-save-split">
                <Button
                  size="small"
                  className="header-btn-save"
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={() => void onSave(manualSaveMode)}
                  disabled={saving || saveStatus === "flushing"}
                  title={saveModeTooltip}
                >
                  {saveModeLabel}
                </Button>
                <Dropdown
                  placement="bottomRight"
                  trigger={["click"]}
                  menu={{ items: saveModeMenuItems, onClick: handleSaveModeMenuClick }}
                >
                  <Button
                    size="small"
                    className="header-btn-save-mode"
                    icon={<DownOutlined />}
                    disabled={saving || saveStatus === "flushing"}
                    aria-label="选择保存方式"
                  />
                </Dropdown>
              </Button.Group>
              {currentContentSource === "draft" ? (
                <Button
                  size="small"
                  className="header-btn-discard"
                  icon={<DeleteOutlined />}
                  loading={discardingDraft}
                  onClick={onDiscardDraft}
                >
                  弃稿
                </Button>
              ) : null}
            </div>
            <Tooltip title="记住当前位置">
              <button
                type="button"
                className="header-icon-btn"
                onClick={() => void onRememberPosition()}
                aria-label="记住当前位置"
              >
                <PushpinOutlined />
              </button>
            </Tooltip>
            <Tooltip title="发布">
              <button
                type="button"
                className="header-icon-btn"
                onClick={handlePublish}
                aria-label="发布"
              >
                <SendOutlined />
              </button>
            </Tooltip>
            <Tooltip
              title={
                currentDoc.visibility === "public"
                  ? "刷新公开页缓存"
                  : "仅公开文档需要刷新公开页缓存"
              }
            >
              <button
                type="button"
                className="header-icon-btn"
                onClick={handleManualRevalidate}
                disabled={currentDoc.visibility !== "public" || revalidating}
                aria-label="刷新公开页缓存"
              >
                <ReloadOutlined />
              </button>
            </Tooltip>
            <Dropdown placement="bottomLeft" trigger={["click"]} menu={{ items: exportMenuItems }}>
              <Tooltip title="导出">
                <button
                  type="button"
                  className="header-icon-btn"
                  aria-label="导出"
                >
                  <DownloadOutlined />
                </button>
              </Tooltip>
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
              onClick={() => void onSave(manualSaveMode)}
              disabled={saving || saveStatus === "flushing"}
              aria-label={saveModeLabel}
            />
            {currentContentSource === "draft" ? (
              <Button
                size="small"
                icon={<DeleteOutlined />}
                loading={discardingDraft}
                onClick={onDiscardDraft}
                aria-label="弃稿"
              />
            ) : null}
            <Button
              size="small"
              icon={<PushpinOutlined />}
              loading={rememberingPosition}
              onClick={() => void onRememberPosition()}
              aria-label="记住当前位置"
            />
            <Button
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
          onReverted={onRevertedToVersion}
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
        toolbarPreferences={toolbarPreferences}
        syncPreferences={syncPreferences}
        onClose={() => setSettingsOpen(false)}
        onScopeChange={onSettingsScopeChange}
        onPriorityChange={onSettingsPriorityChange}
        onToolbarPreferencesChange={onToolbarPreferencesChange}
        onSyncPreferencesChange={onSyncPreferencesChange}
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
      <SyncDebugModal
        open={syncDebugOpen}
        onClose={() => setSyncDebugOpen(false)}
      />
      <Modal
        open={localSnapshotOpen}
        title="本地数据快照"
        onCancel={() => setLocalSnapshotOpen(false)}
        footer={null}
        width={640}
        destroyOnClose
      >
        <div className="header-local-snapshot-modal">
          <div className="header-local-snapshot-modal__row">
            <span>自动保存</span>
            <Switch
              checked={autoSaveSnapshotEnabled}
              onChange={onAutoSaveSnapshotChange}
              checkedChildren="开"
              unCheckedChildren="关"
            />
          </div>
          <div className="header-local-snapshot-modal__row">
            <span>文档ID</span>
            <strong>{currentDoc?.docId ?? "-"}</strong>
          </div>
          <div className="header-local-snapshot-modal__row">
            <span>状态</span>
            <strong>{localSnapshotState.error ?? localSnapshotState.status}</strong>
          </div>
          <div className="header-local-snapshot-modal__row">
            <span>上次校验</span>
            <strong>
              {localSnapshotState.lastCheckedAt ? new Date(localSnapshotState.lastCheckedAt).toLocaleString() : "-"}
            </strong>
          </div>
          <div className="header-local-snapshot-modal__row">
            <span>上次保存</span>
            <strong>
              {localSnapshotState.lastSavedAt ? new Date(localSnapshotState.lastSavedAt).toLocaleString() : "-"}
            </strong>
          </div>
          <div className="header-local-snapshot-modal__row">
            <span>当前哈希</span>
            <strong className="header-local-snapshot-modal__mono">{localSnapshotState.currentHash ?? "-"}</strong>
          </div>
          <div className="header-local-snapshot-modal__row">
            <span>快照哈希</span>
            <strong className="header-local-snapshot-modal__mono">
              {localSnapshotState.storedSnapshot?.hash ?? "-"}
            </strong>
          </div>
        </div>
        <div className="header-local-snapshot-modal__actions">
          <Button
            type="primary"
            onClick={() => setLocalSnapshotCompareOpen(true)}
            disabled={!localSnapshotState.storedSnapshot || !currentDocumentContent}
          >
            一键对比
          </Button>
          <Button
            loading={manualSnapshotSaving}
            onClick={async () => {
              setManualSnapshotSaving(true);
              try {
                await onManualSaveSnapshot();
              } finally {
                setManualSnapshotSaving(false);
              }
            }}
          >
            手动保存快照
          </Button>
          <Button onClick={() => void onRefreshLocalSnapshot()}>重新校验</Button>
          <Button onClick={() => void onCopyLocalSnapshot()} disabled={!localSnapshotState.storedSnapshot}>
            复制本地快照
          </Button>
          <Button onClick={() => void onCopyCurrentSnapshot()} disabled={!currentDoc}>
            复制当前内容
          </Button>
          <Button danger onClick={() => void onClearLocalSnapshot()}>
            清空快照
          </Button>
        </div>
      </Modal>
      <Modal
        open={localSnapshotCompareOpen}
        title="本地快照 vs 当前文档"
        onCancel={() => {
          setExpandedBlockChangeKey(null);
          setLocalSnapshotCompareOpen(false);
        }}
        footer={null}
        width={960}
        destroyOnClose
      >
        <div className="header-local-snapshot-compare">
          {(() => {
            const rawMatch = localSnapshotState.storedSnapshot?.hash === localSnapshotState.currentHash;
            const filteredMatch = snapshotBlockCompare.matches;
            const matchLabel = rawMatch
              ? "一致"
              : filteredMatch
                ? "一致（已过滤）"
                : "不一致";
            const snapshotText =
              diffMode !== "raw"
                ? null
                : stringifyFilteredDoc(localSnapshotState.storedSnapshot?.content ?? null, compareFilterKeySet);
            const currentText =
              diffMode !== "raw"
                ? null
                : stringifyFilteredDoc(currentDocumentContent, compareFilterKeySet);
            const localSnapshotCompactJson =
              diffMode !== "raw"
                ? null
                : stringifyCompactJson(
                    deepFilterKeys(localSnapshotState.storedSnapshot?.content ?? null, compareFilterKeySet),
                  );
            const currentDocumentCompactJson =
              diffMode !== "raw"
                ? null
                : stringifyCompactJson(deepFilterKeys(currentDocumentContent, compareFilterKeySet));
            const currentDocumentSyncDebugRecordsJson =
              diffMode !== "raw"
                ? null
                : stringifyCompactJson(
                    buildCurrentDocumentSyncDebugPayload(SyncDebugLog.getAll(), currentDoc?.docId),
                  );
            const combinedCompactJson =
              diffMode !== "raw"
                ? null
                : `本地快照:${localSnapshotCompactJson ?? "null"}
当前文档:${currentDocumentCompactJson ?? "null"}`;
            const jsonWithSyncDebugRecords =
              diffMode !== "raw"
                ? null
                : `${combinedCompactJson ?? ""}
同步请求记录:${currentDocumentSyncDebugRecordsJson ?? "[]"}`;
            const copyLocalSnapshotCompactJson = () =>
              copyCompactJsonToClipboard(localSnapshotCompactJson, "本地快照 JSON");
            const copyCurrentDocumentCompactJson = () =>
              copyCompactJsonToClipboard(currentDocumentCompactJson, "当前文档 JSON");
            const copyCombinedCompactJson = () => copyCompactJsonToClipboard(combinedCompactJson, "JSON 对比");
            const copyJsonWithSyncDebugRecords = () =>
              copyCompactJsonToClipboard(jsonWithSyncDebugRecords, "JSON + 同步请求记录");
            const visibleDiffEntries = visibleSnapshotDiffEntries.slice(0, 500);
            const hiddenAutoMetaCountForUi = hiddenAutoMetaCount;
            const hiddenOtherMetaCount = visibleDiffCategories.has("other-meta")
              ? 0
              : snapshotDiffEntries.filter((entry) => entry.categories.has("other-meta")).length;

            return (
              <>
                <div className="header-local-snapshot-compare__summary">
                  <span>是否一致</span>
                  <strong className={rawMatch ? "" : filteredMatch ? "header-local-snapshot-compare__summary--filtered" : "header-local-snapshot-compare__summary--mismatch"}>
                    {matchLabel}
                  </strong>
                </div>
                <div className="header-local-snapshot-compare__toolbar">
                  <div className="header-local-snapshot-compare__filters">
                    <span className="header-local-snapshot-compare__filter-label">高级忽略字段：</span>
                    {compareFilterKeys.map((key) => (
                      <Tag
                        key={key}
                        closable
                        onClose={(e) => {
                          e.preventDefault();
                          handleRemoveCompareFilter(key);
                        }}
                      >
                        {key}
                      </Tag>
                    ))}
                    <Input
                      size="small"
                      placeholder="输入字段名，回车添加"
                      value={compareFilterInput}
                      onChange={(e) => setCompareFilterInput(e.target.value)}
                      onPressEnter={handleAddCompareFilter}
                      style={{ width: 180 }}
                    />
                    <Button size="small" type="link" onClick={handleResetCompareFilters}>
                      重置
                    </Button>
                  </div>
                  <Input
                    size="small"
                    allowClear
                    placeholder="搜索字段或内容，如 sortKey / color / 正文"
                    value={diffQuery}
                    onChange={(event) => setDiffQuery(event.target.value)}
                    style={{ width: 260 }}
                  />
                  <div className="header-local-snapshot-compare__mode-switch">
                    <Button
                      size="small"
                      type={diffMode === "explorer" ? "primary" : "default"}
                      onClick={() => setDiffMode("explorer")}
                    >
                      变更视图
                    </Button>
                    <Button
                      size="small"
                      type={diffMode === "raw" ? "primary" : "default"}
                      onClick={() => setDiffMode("raw")}
                    >
                      原始 JSON
                    </Button>
                  </div>
                </div>
                {diffMode === "explorer" ? (
                  <div className="header-local-snapshot-compare__blocks">
                    <div className="header-local-snapshot-compare__block-summary">
                      <Tag>本地 {snapshotBlockCompare.summary.totalBefore}</Tag>
                      <Tag>当前 {snapshotBlockCompare.summary.totalAfter}</Tag>
                      <Tag color="success">未变 {snapshotBlockCompare.summary.unchanged}</Tag>
                      <Tag color="green">+{snapshotBlockCompare.summary.added} 新增</Tag>
                      <Tag color="red">-{snapshotBlockCompare.summary.deleted} 删除</Tag>
                      <Tag color="orange">~{snapshotBlockCompare.summary.modified} 修改</Tag>
                      <Tag color="blue">↕{snapshotBlockCompare.summary.moved} 移动</Tag>
                      <Tag color="purple">{snapshotBlockCompare.summary.metadataOnly} 仅元数据</Tag>
                      {(["content", "sort", "style", "structure"] as LocalSnapshotDiffCategory[]).map(
                        (category) => (
                          <Switch
                            key={category}
                            size="small"
                            checked={visibleDiffCategories.has(category)}
                            onChange={(checked) => toggleDiffCategory(category, checked)}
                            checkedChildren={`${DIFF_CATEGORY_LABELS[category]} ${diffCategoryCounts.get(category) ?? 0}`}
                            unCheckedChildren={DIFF_CATEGORY_LABELS[category]}
                          />
                        ),
                      )}
                      <Switch
                        size="small"
                        checked={!visibleDiffCategories.has("auto-meta")}
                        onChange={(checked) => toggleDiffCategory("auto-meta", !checked)}
                        checkedChildren="忽略自动生成元数据"
                        unCheckedChildren="显示自动生成元数据"
                      />
                      <Switch
                        size="small"
                        checked={visibleDiffCategories.has("other-meta")}
                        onChange={(checked) => toggleDiffCategory("other-meta", checked)}
                        checkedChildren={`其它元数据 ${diffCategoryCounts.get("other-meta") ?? 0}`}
                        unCheckedChildren="隐藏其它元数据"
                      />
                      {(hiddenAutoMetaCountForUi > 0 || hiddenOtherMetaCount > 0) && (
                        <span className="header-local-snapshot-compare__muted">
                          已隐藏 {hiddenAutoMetaCountForUi + hiddenOtherMetaCount} 个元数据变更
                        </span>
                      )}
                    </div>
                    {visibleSnapshotDiffEntries.length === 0 ? (
                      <div className="header-local-snapshot-compare__empty">
                        {snapshotBlockCompare.changes.length === 0
                          ? "过滤后没有发现块级差异。"
                          : "没有匹配当前搜索和类型筛选的变更。"}
                      </div>
                    ) : (
                      <div className="header-local-snapshot-compare__change-list">
                        {visibleDiffEntries.map((entry) => {
                          const change = entry.change;
                          const key = diffEntryKey(entry);
                          const expanded = key === expandedBlockChangeKey;
                          return (
                            <div key={key} className="header-local-snapshot-compare__change-item">
                              <button
                                type="button"
                                className={`header-local-snapshot-compare__change header-local-snapshot-compare__change--${change.kind}`}
                                onClick={() => setExpandedBlockChangeKey(expanded ? null : key)}
                              >
                                <span className="header-local-snapshot-compare__change-kind">
                                  {blockChangeLabel(change.kind)}
                                </span>
                                <span className="header-local-snapshot-compare__change-label">
                                  {change.label}
                                </span>
                                <span className="header-local-snapshot-compare__change-position">
                                  {describeBlockPosition(change)}
                                </span>
                              </button>
                              {expanded && (
                                <div className="header-local-snapshot-compare__hunks">
                                  {(expandedDiffEntry?.hunks ?? entry.hunks).length === 0 ? (
                                    <div className="header-local-snapshot-compare__empty">
                                      过滤后这个块没有 JSON 字段差异。
                                    </div>
                                  ) : (
                                    (expandedDiffEntry?.hunks ?? entry.hunks).map((hunk) => (
                                      <pre
                                        key={hunk.path}
                                        className="header-local-snapshot-compare__hunk"
                                      >
                                        <div className="header-local-snapshot-compare__hunk-header">
                                          @@ {hunk.path} @@
                                        </div>
                                        {hunk.lines.map((line, index) => (
                                          <div
                                            key={`${line.kind}-${index}-${line.text}`}
                                            className={`header-local-snapshot-compare__hunk-line header-local-snapshot-compare__hunk-line--${line.kind}`}
                                          >
                                            <span className="header-local-snapshot-compare__diff-prefix">
                                              {line.kind === "added" ? "+" : "-"}
                                            </span>
                                            {line.text}
                                          </div>
                                        ))}
                                      </pre>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {visibleSnapshotDiffEntries.length > visibleDiffEntries.length && (
                          <div className="header-local-snapshot-compare__empty">
                            还有 {visibleSnapshotDiffEntries.length - visibleDiffEntries.length} 条变更未渲染，避免大文档一次性创建过多 DOM。
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="header-local-snapshot-compare__raw">
                    <div className="header-local-snapshot-compare__raw-actions">
                      <Button size="small" onClick={() => void copyLocalSnapshotCompactJson()}>
                        复制本地快照 JSON
                      </Button>
                      <Button size="small" onClick={() => void copyCurrentDocumentCompactJson()}>
                        复制当前文档 JSON
                      </Button>
                      <Button size="small" type="primary" onClick={() => void copyCombinedCompactJson()}>
                        一键复制 JSON 对比
                      </Button>
                      <Button size="small" onClick={() => void copyJsonWithSyncDebugRecords()}>
                        复制 JSON + 同步请求记录
                      </Button>
                    </div>
                    <div className="header-local-snapshot-compare__grid">
                      <section className="header-local-snapshot-compare__pane">
                        <h4>本地快照</h4>
                        <pre className="header-local-snapshot-compare__code">
                          {snapshotText ?? "无本地快照"}
                        </pre>
                      </section>
                      <section className="header-local-snapshot-compare__pane">
                        <h4>当前文档</h4>
                        <pre className="header-local-snapshot-compare__code">
                          {currentText ?? "无当前文档内容"}
                        </pre>
                      </section>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </Modal>
    </header>
  );
}

"use client";

import {
  Profiler,
  startTransition,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ProfilerOnRenderCallback,
} from "react";
import { App } from "antd";
import { usePathname, useRouter } from "next/navigation";
import TurndownService from "turndown";
import { MarkdownEditor, MarkdownEditorRef } from "@/modules/editor-kit";
import { nowEditorPerf, traceEditorPerf, traceEditorPerfSince } from "@/modules/editor-kit/perfTrace";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import {
  DASH_PATH,
  DocumentProvider,
  useDocument,
} from "@/contexts/DocumentContext";
import { SetupModal } from "@/components/SetupModal";
import AppLoader from "@/components/AppLoader";
import { shouldShowSetupModal } from "@/components/editorSetupState";
import { resolveEditorRouteHydration } from "@/components/editorRouteHydration";
import {
  resolvePendingRestoreTarget,
  shouldPersistLastEditPosition,
} from "@/components/editorLastEditPosition";
import { DocumentHeader } from "@/components/DocumentHeader";
import FindReplaceBar from "@/components/FindReplaceBar";
import AiChatFloatingPanel from "@/components/AiChatFloatingPanel";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useLocalDocumentSnapshot } from "@/hooks/useLocalDocumentSnapshot";
import { useZenMode } from "@/hooks/useZenMode";
import {
  buildLocalDocSnapshot,
  clearLocalSnapshotRecoveryMarker,
  createBrowserLocalSnapshotStore,
  readLocalSnapshotRecoveryMarker,
  shouldRestoreLocalSnapshotAfterLoad,
  writeLocalSnapshotRecoveryBackup,
  type LocalSnapshotStore,
  type LocalDocSnapshot,
  type LocalSnapshotRecoveryReason,
} from "@/services/local-snapshot";
import {
  commitVersion,
  discardDraft as discardDraftRequest,
  saveDocumentContentV2,
  type EditorContent,
  type LastEditPosition,
  updateDocumentLastEditPosition,
} from "@/services/document";
import { uploadImage } from "@/services/images";
import { useDocumentSync } from "@/hooks/useDocumentSync";
import { SyncTraceLog, buildManifestSummary } from "@/services/sync/debug-log";
import { alignDocToSortKeyOrder } from "@/services/sync/engine";
import { readIdentityFromAttrs } from "@/services/sync/identity";
import type { SyncDiffHint } from "@/services/sync/types";
import {
  hasDiscardableDraft,
  isNoopCommitError,
  isNoopDiscardDraftError,
  shouldEnableLegacyAutoSave,
  shouldReloadAfterManualSave,
  shouldSkipManualCommit,
} from "@/services/save-policy";
import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  buildSettingsState,
  getUserSettings,
  getWorkspaceSettings,
  readSettingsPriority,
  writeSettingsPriority,
  updateUserSettings,
  updateWorkspaceSettings,
  type SettingsScope,
  type SettingsState,
  type UserSettings,
  type WorkspaceSettings,
} from "@/services/settings";
import {
  getEnabledFloatingToolbarItemIds,
  readEditorToolbarPreferences,
  writeEditorToolbarPreferences,
  type EditorToolbarPreferences,
} from "@/services/editor-toolbar-preferences";
import {
  readEditorSyncPreferences,
  writeEditorSyncPreferences,
  type EditorSyncPreferences,
} from "@/services/editor-sync-preferences";
import {
  readManualSaveMode,
  writeManualSaveMode,
  type ManualSaveMode,
} from "@/services/manual-save-preferences";
import { generateHTML } from "@tiptap/core";
import { serializationExtensions } from "@/services/tiptap-extensions";
import type { TiptapDoc } from "@/services/tiptap-converter";

function createTurndownService(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  td.addRule("horizontalRule", {
    filter: "hr",
    replacement: () => "\n\n---\n\n",
  });

  td.addRule("styledSpan", {
    filter: (node) => {
      if (node.nodeName !== "SPAN") return false;
      const el = node as HTMLElement;
      return !!(el.style?.fontSize || el.style?.color || el.style?.backgroundColor);
    },
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const styles: string[] = [];
      if (el.style.fontSize) styles.push(`font-size: ${el.style.fontSize}`);
      if (el.style.color) styles.push(`color: ${el.style.color}`);
      if (el.style.backgroundColor) styles.push(`background-color: ${el.style.backgroundColor}`);
      const inner = node.textContent || "";
      if (!styles.length) return inner;
      return `<span style="${styles.join("; ")}">${inner}</span>`;
    },
  });

  td.addRule("underline", {
    filter: "u",
    replacement: (content) => `<u>${content}</u>`,
  });

  td.addRule("highlight", {
    filter: (node) => {
      if (node.nodeName !== "MARK") return false;
      const el = node as HTMLElement;
      return !!(el.style?.backgroundColor && el.style.backgroundColor !== "yellow");
    },
    replacement: (content, node) => {
      const el = node as HTMLElement;
      const bg = el.style.backgroundColor;
      return `<mark style="background-color: ${bg}">${content}</mark>`;
    },
  });

  function rgbToHex(rgb: string): string {
    if (rgb.startsWith("#")) return rgb;
    const match = rgb.match(/\d+/g);
    if (!match || match.length < 3) return "";
    const r = parseInt(match[0]).toString(16).padStart(2, "0");
    const g = parseInt(match[1]).toString(16).padStart(2, "0");
    const b = parseInt(match[2]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`.toUpperCase();
  }

  const highlightBlockColorTypeMap: Record<string, string> = {
    "#FFF2CC": "tip",
    "#FCE5CD": "warning",
    "#F4CCCC": "danger",
    "#E6B8AF": "caution",
    "#D9EAD3": "success",
    "#D0E0E3": "info",
    "#C9DAF8": "note",
    "#CFE2F3": "question",
    "#D9D2E9": "example",
    "#EAD1DC": "quote",
  };

  td.addRule("highlightBlock", {
    filter: (node) => {
      return (
        node.nodeName === "DIV" &&
        (node as HTMLElement).hasAttribute("data-highlight-block")
      );
    },
    replacement: (content, node) => {
      const el = node as HTMLElement;
      const bg = rgbToHex(el.style.backgroundColor);
      const trimmed = content.trim();
      const type = highlightBlockColorTypeMap[bg] || "tip";
      return `\n\n::: ${type}\n${trimmed}\n:::\n\n`;
    },
  });

  td.addRule("textAlign", {
    filter: (node) => {
      const el = node as HTMLElement;
      if (!el.style?.textAlign) return false;
      return ["P", "H1", "H2", "H3", "H4", "H5", "H6", "DIV", "BLOCKQUOTE"].includes(
        node.nodeName,
      );
    },
    replacement: (content, node) => {
      const el = node as HTMLElement;
      const tag = node.nodeName.toLowerCase();
      const align = el.style.textAlign;
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag[1]);
        const hashes = "#".repeat(level);
        return `<div style="text-align: ${align}">\n\n${hashes} ${content.trim()}\n\n</div>`;
      }
      if (tag === "p") {
        return `<p style="text-align: ${align}">${content}</p>`;
      }
      return `<${tag} style="text-align: ${align}">${content}</${tag}>`;
    },
  });

  td.addRule("lineHeight", {
    filter: (node) => {
      const el = node as HTMLElement;
      if (!el.style?.lineHeight) return false;
      return ["P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(node.nodeName);
    },
    replacement: (content, node) => {
      const el = node as HTMLElement;
      const tag = node.nodeName.toLowerCase();
      const lh = el.style.lineHeight;
      return `<${tag} style="line-height: ${lh}">${content}</${tag}>`;
    },
  });

  td.addRule("taskListItem", {
    filter: (node) => {
      return node.nodeName === "LI" && !!(node as HTMLElement).querySelector('input[type="checkbox"]');
    },
    replacement: (content, node) => {
      const checkbox = (node as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      const checked = checkbox?.checked ? "x" : " ";
      const clean = content.replace(/^\s*\[[ x]\]\s*/, "").replace(/^\s+/, "").trim();
      return `- [${checked}] ${clean}\n`;
    },
  });

  td.addRule("tableWrapper", {
    filter: (node) => {
      return node.nodeName === "DIV" && (node as HTMLElement).classList.contains("tableWrapper");
    },
    replacement: (content) => content,
  });

  td.addRule("table", {
    filter: "table",
    replacement: (_content, tableNode) => {
      const table = tableNode as HTMLTableElement;
      const rows = Array.from(table.querySelectorAll("tr"));
      if (rows.length === 0) return "";

      const cellText = (cell: Element): string => {
        let md = "";
        cell.childNodes.forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE) {
            md += child.textContent || "";
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            md += td.turndown((child as HTMLElement).outerHTML);
          }
        });
        return md.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
      };

      const parseRow = (tr: Element): string[] =>
        Array.from(tr.querySelectorAll("th, td")).map(cellText);

      const isHeader = (tr: Element): boolean => {
        if (tr.querySelector("th")) return true;
        const parent = tr.parentElement;
        return !!parent && parent.nodeName === "THEAD";
      };

      const dataRows = rows.map((tr) => ({ cells: parseRow(tr), header: isHeader(tr) }));
      const maxCols = Math.max(...dataRows.map((r) => r.cells.length), 1);
      const pad = (arr: string[]): string[] => {
        while (arr.length < maxCols) arr.push("");
        return arr;
      };

      const headerIdx = dataRows.findIndex((r) => r.header);
      const headerRow = headerIdx >= 0 ? dataRows[headerIdx] : dataRows[0];
      const bodyRows = dataRows.filter((_, i) => i !== (headerIdx >= 0 ? headerIdx : 0));

      const headerCells = pad([...headerRow.cells]);
      const separator = headerCells.map(() => "---");
      const bodyLines = bodyRows.map((r) => pad([...r.cells]));
      const toLine = (cells: string[]) => `| ${cells.join(" | ")} |`;
      return `\n${[toLine(headerCells), toLine(separator), ...bodyLines.map(toLine)].join("\n")}\n`;
    },
  });

  return td;
}

const turndownService = createTurndownService();

function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return turndownService.turndown(html).trim();
}

function contentToHtml(content: EditorContent): string {
  if (typeof content === "string") return content;
  if (content && content.type === "doc") {
    return generateHTML(content, serializationExtensions);
  }
  return "";
}

function mergeAckAttrsIntoCurrentEditorDoc(current: TiptapDoc, ackDoc: TiptapDoc): TiptapDoc {
  if (!Array.isArray(current.content) || !Array.isArray(ackDoc.content)) return current;

  const ackByClientId = new Map<string, Record<string, unknown>>();
  const ackByBlockId = new Map<string, Record<string, unknown>>();
  for (const node of ackDoc.content) {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    const identity = readIdentityFromAttrs(attrs);
    if (identity.clientId) {
      ackByClientId.set(identity.clientId, attrs ?? {});
    }
    if (identity.blockId) {
      ackByBlockId.set(identity.blockId, attrs ?? {});
    }
  }

  let changed = false;
  const content = current.content.map((node) => {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    const identity = readIdentityFromAttrs(attrs);

    const ackAttrs =
      (identity.clientId ? ackByClientId.get(identity.clientId) : undefined) ??
      (identity.blockId ? ackByBlockId.get(identity.blockId) : undefined);
    if (!ackAttrs) return node;

    const nextAttrs = { ...(attrs ?? {}) };
    let nodeChanged = false;

    for (const key of ["blockId", "data-block-id", "sortKey", "data-sort-key", "syncCreateId", "data-sync-create-id", "clientBatchId"]) {
      const value = ackAttrs[key];
      if (value !== undefined && nextAttrs[key] !== value) {
        nextAttrs[key] = value;
        nodeChanged = true;
      }
    }

    if (!nodeChanged) return node;
    changed = true;
    return { ...node, attrs: nextAttrs };
  });

  return changed ? { ...current, content } : current;
}

/** 合并 ACK 身份，并剔除服务端已确认删除、但编辑器仍残留的块。 */
function reconcileEditorWithAckBaseline(
  current: TiptapDoc,
  ackBaseline: TiptapDoc,
): TiptapDoc {
  const ackClientIds = new Set<string>();
  for (const node of ackBaseline.content ?? []) {
    const identity = readIdentityFromAttrs(node.attrs);
    if (identity.clientId) ackClientIds.add(identity.clientId);
  }

  let reconciled = mergeAckAttrsIntoCurrentEditorDoc(current, ackBaseline);
  const content = (reconciled.content ?? []).filter((node) => {
    const identity = readIdentityFromAttrs(node.attrs);
    return !identity.clientId || ackClientIds.has(identity.clientId);
  });

  if (content.length !== (reconciled.content?.length ?? 0)) {
    reconciled = { ...reconciled, content };
  }

  return alignDocToSortKeyOrder(reconciled);
}

type OutputTab = "html" | "markdown" | "json";

const BLANK_CONTENT: TiptapDoc = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

type PendingLocalRecovery = {
  docId: string;
  snapshot: LocalDocSnapshot;
};

function EditorContent() {
  const { isAuthenticated: authed, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { message } = App.useApp();
  const {
    currentDoc,
    currentDocSlug,
    currentDocVersion,
    currentContentSource,
    currentDraftMeta,
    currentSyncSession,
    currentBlockIds,
    lastEditPosition,
    loadContent,
    applyCommittedVersion,
    applySyncSession,
    selectDoc,
    updateDoc,
    workspaceId,
    setWorkspace,
    saveStatus,
    setSaveStatus,
    markSavedAt,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    lastSavedAt,
    pendingScrollBlockId,
    setPendingScrollBlockId,
  } = useDocument();

  const [content, setContent] = useState<EditorContent>(BLANK_CONTENT);
  const [liveContent, setLiveContent] = useState<EditorContent>(BLANK_CONTENT);
  const [contentDirty, setContentDirty] = useState(false);
  const [loadedContentDocId, setLoadedContentDocId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OutputTab>("markdown");
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [outputModalOpen, setOutputModalOpen] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [findReplaceEditor, setFindReplaceEditor] = useState<ReturnType<MarkdownEditorRef["getEditor"]>>(null);
  const { zenMode } = useZenMode();
  const [manualSaving, setManualSaving] = useState(false);
  const [manualSaveMode, setManualSaveMode] = useState<ManualSaveMode>(() => readManualSaveMode());
  const [discardingDraft, setDiscardingDraft] = useState(false);
  const [settingsState, setSettingsState] = useState<SettingsState>(() =>
    buildSettingsState({ priority: "workspace-first" }),
  );
  const [toolbarPreferences, setToolbarPreferences] = useState<EditorToolbarPreferences>(() =>
    readEditorToolbarPreferences(),
  );
  const [syncPreferences, setSyncPreferences] = useState<EditorSyncPreferences>(() =>
    readEditorSyncPreferences(),
  );
  const [settingsScope, setSettingsScope] = useState<SettingsScope>("user");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const syncEngineEnabled = process.env.NEXT_PUBLIC_SYNC_ENGINE_ENABLED === "true";
  const [autoSaveSnapshotEnabled, setAutoSaveSnapshotEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("yuediter:local-snapshot:auto-save");
    return stored !== "false";
  });
  const localSnapshotStore = useMemo<LocalSnapshotStore>(
    () => createBrowserLocalSnapshotStore(),
    [],
  );
  const [pendingLocalRecovery, setPendingLocalRecovery] =
    useState<PendingLocalRecovery | null>(null);
  const loadedDocIdRef = useRef<string | null>(null);
  const hydratingSlugRef = useRef<string | null>(null);
  const lastPathnameRef = useRef<string | null>(null);
  const contentRef = useRef<EditorContent>(content);
  const syncDiffHintRef = useRef<{
    content: EditorContent;
    hint: SyncDiffHint;
  } | null>(null);
  const editorRef = useRef<MarkdownEditorRef>(null);
  const replaceContent = useCallback((nextContent: EditorContent) => {
    contentRef.current = nextContent;
    setLiveContent(nextContent);
    setContent(nextContent);
  }, []);
  const restoredLastEditDocIdRef = useRef<string | null>(null);
  const [pendingLastEditRestoreBlockId, setPendingLastEditRestoreBlockId] = useState<string | null>(null);
  const lastPersistedEditBlockIdRef = useRef<string | null>(null);
  const lastEditPersistInflightRef = useRef(false);
  const forceRememberPositionRef = useRef(false);
  const [queuedLastEditPosition, setQueuedLastEditPosition] = useState<LastEditPosition | null>(null);
  const [rememberingPosition, setRememberingPosition] = useState(false);
  const queuedEditBlockIdRef = useRef<string | null>(null);
  const queuedEditAtRef = useRef(0);
  const tiptapContent = typeof liveContent === "object" && liveContent?.type === "doc"
    ? (liveContent as TiptapDoc)
    : null;
  const syncContent =
    currentDoc?.docId && loadedContentDocId === currentDoc.docId
      ? tiptapContent
      : null;
  const discardableDraft = hasDiscardableDraft({
    currentContentSource,
    currentDraftExists: currentDraftMeta?.exists === true,
    hasUnsavedChanges,
    contentDirty,
  });
  const consumeSyncDiffHint = useCallback((nextContent: TiptapDoc) => {
    const pending = syncDiffHintRef.current;
    if (!pending || pending.content !== nextContent) return null;
    syncDiffHintRef.current = null;
    return pending.hint;
  }, []);

  const sync = useDocumentSync({
    docId: syncEngineEnabled ? currentDoc?.docId ?? null : null,
    rootBlockId: syncEngineEnabled ? currentDoc?.rootBlockId ?? null : null,
    baseVersion: syncEngineEnabled ? currentDocVersion : null,
    draftRevision: currentDraftMeta?.draftRevision ?? 0,
    syncSession: syncEngineEnabled ? currentSyncSession : null,
    content: syncEngineEnabled ? syncContent : null,
    getLiveContent: () => {
      const fromEditor = editorRef.current?.getJSON() as TiptapDoc | undefined;
      if (fromEditor?.type === "doc") return fromEditor;
      const fromRef = contentRef.current;
      if (fromRef && typeof fromRef === "object" && (fromRef as TiptapDoc).type === "doc") {
        return fromRef as TiptapDoc;
      }
      return null;
    },
    onContentPatched: (ackBaseline) => {
      const latestEditorContent = editorRef.current?.getJSON() as TiptapDoc | undefined;
      if (latestEditorContent?.type === "doc") {
        // ackBaseline 来自实时编辑器 + ACK 补丁；只合并身份/结构，不回灌旧 snapshot 正文。
        const reconciled = reconcileEditorWithAckBaseline(
          latestEditorContent,
          ackBaseline,
        );
        if (reconciled !== latestEditorContent) {
          editorRef.current?.patchBlockIdentityFromDoc(reconciled);
          replaceContent(reconciled);
          if (currentDoc && SyncTraceLog.isEnabled()) {
            SyncTraceLog.add(
              "editor:ack-merged",
              currentDoc.docId,
              currentSyncSession?.sessionId ?? null,
              currentSyncSession?.sessionEpoch ?? null,
              {
                manifest: buildManifestSummary(reconciled),
              },
            );
          }
        }
        return reconciled;
      }
      return ackBaseline;
    },
    onRemoteContentApplied: (doc) => {
      ignoreNextLocalSnapshotChange();
      replaceContent(doc);
      setContentDirty(false);
      setHasUnsavedChanges(false);
      setSaveStatus("saved");
    },
    onRemoteReloadRequired: async (reason) => {
      if (!currentDoc) return;
      message.warning(reason || "其他设备已修改此文档，将重新加载最新内容");
      const loaded = await loadContent(currentDoc.docId);
      const loadedContent = loaded.content || BLANK_CONTENT;
      ignoreNextLocalSnapshotChange();
      replaceContent(loadedContent);
      setLoadedContentDocId(currentDoc.docId);
      setContentDirty(false);
      setHasUnsavedChanges(false);
      markSavedAt(null);
      setSaveStatus("loaded");
    },
    onSessionRecovered: applySyncSession,
    consumeDiffHint: consumeSyncDiffHint,
  });
  const syncFlush = sync.flush;
  const syncUiSaveStatus = sync.uiSaveStatus;
  const localSnapshot = useLocalDocumentSnapshot({
    docId: currentDoc?.docId ?? null,
    content: tiptapContent,
    enabled: Boolean(currentDoc?.docId && tiptapContent),
    autoSave: autoSaveSnapshotEnabled,
    hasUnsavedChanges,
  });
  const ignoreNextLocalSnapshotChange = localSnapshot.ignoreNextContentChange;
  const clearLocalSnapshot = localSnapshot.clearSnapshot;
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const handleToggleFindReplace = useCallback(() => {
    setFindReplaceEditor(editorRef.current?.getEditor() ?? null);
    setFindReplaceOpen((prev) => !prev);
  }, []);

  const handleCloseFindReplace = useCallback(() => {
    setFindReplaceOpen(false);
    setFindReplaceEditor(null);
  }, []);

  // Ctrl+F / Ctrl+H 打开查找替换栏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === "f" || key === "h")) {
        e.preventDefault();
        handleToggleFindReplace();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleFindReplace]);

  useEffect(() => {
    restoredLastEditDocIdRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore queue must reset when the active document changes
    setPendingLastEditRestoreBlockId(null);
    lastPersistedEditBlockIdRef.current = lastEditPosition?.blockId ?? null;
    lastEditPersistInflightRef.current = false;
    forceRememberPositionRef.current = false;
    queuedEditBlockIdRef.current = null;
    queuedEditAtRef.current = 0;
    setQueuedLastEditPosition(null);
  }, [currentDoc?.docId, lastEditPosition?.blockId]);

  useEffect(() => {
    if (!workspaceId || !authed) return;

    let active = true;
    const priority = readSettingsPriority();
    void Promise.all([
      getUserSettings().catch(() => DEFAULT_USER_SETTINGS),
      getWorkspaceSettings(workspaceId).catch(() => DEFAULT_WORKSPACE_SETTINGS),
    ])
      .then(([userSettings, workspaceSettings]) => {
        if (active) {
          setSettingsState(
            buildSettingsState({
              userSettings,
              workspaceSettings,
              priority,
            }),
          );
        }
      })
      .catch(() => {
        if (active) {
          setSettingsState(buildSettingsState({ priority }));
        }
      });

    return () => {
      active = false;
    };
  }, [authed, workspaceId]);

  useEffect(() => {
    const action = resolveEditorRouteHydration({
      authLoading,
      isAuthenticated: authed,
      workspaceId,
      pathname,
      currentDocSlug,
      hydratingSlug: hydratingSlugRef.current,
      lastPathname: lastPathnameRef.current,
    });
    lastPathnameRef.current = action.nextPathname;

    if (action.type === "noop") return;

    if (action.type === "settled") {
      hydratingSlugRef.current = null;
      return;
    }

    if (action.type === "redirect") {
      router.replace(action.href);
      return;
    }

    if (action.type === "invalid") {
      message.error("文档地址无效");
      router.replace(DASH_PATH);
      return;
    }

    hydratingSlugRef.current = action.slug;
    void selectDoc(action.docId)
      .catch(() => {
        message.error("无法打开该文档");
        router.replace(DASH_PATH);
      })
      .finally(() => {
        if (hydratingSlugRef.current === action.slug) {
          hydratingSlugRef.current = null;
        }
      });
  }, [authLoading, authed, currentDocSlug, message, pathname, router, selectDoc, workspaceId]);

  useEffect(() => {
    const docId = currentDoc?.docId;
    if (!docId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- document-bound editor state must reset when the active document is cleared
      replaceContent(BLANK_CONTENT);
      setContentDirty(false);
      setLoadedContentDocId(null);
      setHasUnsavedChanges(false);
      markSavedAt(null);
      setSaveStatus("idle");
      loadedDocIdRef.current = null;
      setPendingLocalRecovery(null);
      return;
    }
    if (loadedDocIdRef.current === docId) return;

    let cancelled = false;
    setLoadingDoc(true);
    setContentDirty(false);
    setLoadedContentDocId(null);
    setPendingLocalRecovery(null);
    void (async () => {
      try {
        const loaded = await loadContent(docId);
        if (cancelled) return;
        const loadedContent = loaded.content || BLANK_CONTENT;
        loadedDocIdRef.current = docId;
        replaceContent(loaded.content || BLANK_CONTENT);
        setLoadedContentDocId(docId);
        setContentDirty(false);
        setHasUnsavedChanges(false);
        markSavedAt(null);
        setSaveStatus("loaded");

        if (
          syncEngineEnabled &&
          typeof loadedContent === "object" &&
          loadedContent?.type === "doc"
        ) {
          const snapshot = await localSnapshotStore.read(docId);
          if (cancelled) return;
          const recoveryMarker = readLocalSnapshotRecoveryMarker(docId);
          const serverUpdatedAt =
            loaded.draft.updatedAt ?? currentDoc.updatedAt ?? null;
          if (
            shouldRestoreLocalSnapshotAfterLoad({
              snapshot,
              recoveryMarker,
              serverContent: loadedContent,
              serverUpdatedAt,
            })
          ) {
            setPendingLocalRecovery({ docId, snapshot: snapshot! });
          }
        }
      } catch {
        if (cancelled) return;
        replaceContent(BLANK_CONTENT);
        setContentDirty(false);
        setLoadedContentDocId(null);
        loadedDocIdRef.current = null;
      } finally {
        if (!cancelled) {
          setLoadingDoc(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    currentDoc,
    loadContent,
    localSnapshotStore,
    markSavedAt,
    replaceContent,
    setHasUnsavedChanges,
    setSaveStatus,
    syncEngineEnabled,
  ]);

  useEffect(() => {
    if (!syncEngineEnabled || !currentDoc || !tiptapContent) return;

    const recoveryReason: LocalSnapshotRecoveryReason | null =
      syncUiSaveStatus === "dirty" ||
      syncUiSaveStatus === "flushing" ||
      syncUiSaveStatus === "error"
        ? syncUiSaveStatus
        : null;

    if (!recoveryReason) {
      clearLocalSnapshotRecoveryMarker(currentDoc.docId);
      return;
    }

    const docId = currentDoc.docId;
    const timer = window.setTimeout(() => {
      const latestEditorContent = editorRef.current?.getJSON() as TiptapDoc | undefined;
      const backupContent = latestEditorContent?.type === "doc" ? latestEditorContent : tiptapContent;
      try {
        writeLocalSnapshotRecoveryBackup(
          buildLocalDocSnapshot(docId, backupContent),
          recoveryReason,
        );
      } catch {
        // Ignore local recovery backup quota/storage failures; normal autosync remains authoritative.
      }
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [currentDoc, syncEngineEnabled, syncUiSaveStatus, tiptapContent]);

  useEffect(() => {
    if (!pendingLocalRecovery) return;
    if (!syncEngineEnabled) return;
    if (!currentDoc || currentDoc.docId !== pendingLocalRecovery.docId) return;
    if (!sync.syncState) return;

    const recovery = pendingLocalRecovery;
    const timer = window.setTimeout(() => {
      replaceContent(recovery.snapshot.content);
      setContentDirty(true);
      setHasUnsavedChanges(true);
      setSaveStatus("dirty");
      setPendingLocalRecovery(null);
      message.warning("已恢复本地未同步快照，正在重新同步");
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    currentDoc,
    message,
    pendingLocalRecovery,
    replaceContent,
    setHasUnsavedChanges,
    setSaveStatus,
    sync.syncState,
    syncEngineEnabled,
  ]);

  const scheduleScrollToBlock = useCallback((blockId: string, onSuccess?: () => void) => {
    const tryScroll = () => editorRef.current?.scrollToBlock(blockId) ?? false;
    requestAnimationFrame(() => {
      if (tryScroll()) {
        onSuccess?.();
        return;
      }

      let retries = 0;
      const retryTimer = window.setInterval(() => {
        retries += 1;
        if (tryScroll()) {
          window.clearInterval(retryTimer);
          onSuccess?.();
          return;
        }
        if (retries >= 10) {
          window.clearInterval(retryTimer);
        }
      }, 200);
    });
  }, []);

  // 搜索结果滚动定位
  useEffect(() => {
    if (loadingDoc || !editorRef.current || !pendingScrollBlockId) return;

    const blockId = pendingScrollBlockId;
    setPendingScrollBlockId(null);
    scheduleScrollToBlock(blockId);
  }, [loadingDoc, pendingScrollBlockId, scheduleScrollToBlock, setPendingScrollBlockId]);

  useEffect(() => {
    const targetBlockId = resolvePendingRestoreTarget({
      docId: currentDoc?.docId ?? null,
      loadingDoc,
      pendingScrollBlockId,
      currentBlockIds,
      lastEditPosition,
      restoredDocId: restoredLastEditDocIdRef.current,
      pendingRestoreBlockId: pendingLastEditRestoreBlockId,
    });
    if (!targetBlockId) return;
    setPendingLastEditRestoreBlockId(targetBlockId);
  }, [
    currentBlockIds,
    currentDoc?.docId,
    lastEditPosition,
    loadingDoc,
    pendingLastEditRestoreBlockId,
    pendingScrollBlockId,
  ]);

  useEffect(() => {
    if (!currentDoc?.docId || !pendingLastEditRestoreBlockId || pendingScrollBlockId) return;
    scheduleScrollToBlock(pendingLastEditRestoreBlockId, () => {
      restoredLastEditDocIdRef.current = currentDoc.docId;
      setPendingLastEditRestoreBlockId(null);
    });
  }, [currentDoc?.docId, pendingLastEditRestoreBlockId, pendingScrollBlockId, scheduleScrollToBlock]);

  const saveLegacyContent = useCallback(async (nextContent: EditorContent) => {
    if (!currentDoc) return;
    if (typeof nextContent !== "string") {
      setSaveStatus("error");
      throw new Error("旧版自动保存只支持 HTML 文档；TipTap JSON 文档需要启用 NEXT_PUBLIC_SYNC_ENGINE_ENABLED=true");
    }
    setSaveStatus("flushing");
    try {
      await saveDocumentContentV2(currentDoc.docId, nextContent, currentDoc.rootBlockId);
      if (contentRef.current === nextContent) {
        setContentDirty(false);
      }
      setSaveStatus("draft-synced");
    } catch (error) {
      setSaveStatus("error");
      throw error;
    }
  }, [currentDoc, setSaveStatus]);

  useAutoSave(liveContent, saveLegacyContent, {
    delay: 1500,
    enabled: shouldEnableLegacyAutoSave({
      syncEngineEnabled,
      loadingDoc,
      hasCurrentDoc: Boolean(currentDoc),
      contentDirty,
      content: liveContent,
    }),
  });

  const queueEditorPosition = useCallback((mode: "selection" | "viewport", force = false): boolean => {
    const position =
      mode === "viewport"
        ? editorRef.current?.getViewportBlockPosition()
        : editorRef.current?.getSelectionBlockPosition();
    if (!position) return false;

    const now = Date.now();
    if (
      !force &&
      queuedEditBlockIdRef.current === position.blockId &&
      now - queuedEditAtRef.current < 2000
    ) {
      return true;
    }

    forceRememberPositionRef.current = force;
    queuedEditBlockIdRef.current = position.blockId;
    queuedEditAtRef.current = now;
    setQueuedLastEditPosition({
      ...position,
      updatedAt: new Date(now).toISOString(),
    });
    return true;
  }, []);

  const handleEditorChange = useCallback((nextContent: EditorContent, syncDiffHint?: SyncDiffHint) => {
    const startedAt = nowEditorPerf();
    if (
      syncDiffHint &&
      nextContent &&
      typeof nextContent === "object" &&
      (nextContent as TiptapDoc).type === "doc"
    ) {
      syncDiffHintRef.current = {
        content: nextContent,
        hint: syncDiffHint,
      };
    }
    contentRef.current = nextContent;
    startTransition(() => {
      setLiveContent(nextContent);
    });
    if (!contentDirty) {
      setContentDirty(true);
    }
    if (loadingDoc) return;
    if (currentDoc) {
      if (!hasUnsavedChanges) {
        setHasUnsavedChanges(true);
      }
      if (saveStatus !== "dirty") {
        setSaveStatus("dirty");
      }
      if (syncPreferences.autoRememberEditPosition) {
        void queueEditorPosition("selection", false);
      }
    }
    traceEditorPerfSince("EditorPage.handleEditorChange", startedAt, {
      hasSyncDiffHint: Boolean(syncDiffHint),
      contentDirty,
      loadingDoc,
      hasCurrentDoc: Boolean(currentDoc),
      blockCount:
        nextContent && typeof nextContent === "object" && Array.isArray((nextContent as TiptapDoc).content)
          ? (nextContent as TiptapDoc).content.length
          : null,
    });
  }, [
    currentDoc,
    contentDirty,
    hasUnsavedChanges,
    loadingDoc,
    queueEditorPosition,
    saveStatus,
    setHasUnsavedChanges,
    setSaveStatus,
    syncPreferences.autoRememberEditPosition,
  ]);

  const handleTitleChange = useCallback(async (newTitle: string) => {
    if (!currentDoc) return;
    try {
      await updateDoc(currentDoc.docId, { title: newTitle });
    } catch {
      message.error("标题保存失败");
    }
  }, [currentDoc, updateDoc, message]);

  const handleUploadImage = useCallback(
    async (file: File) => {
      if (!workspaceId) {
        throw new Error("未选择工作空间");
      }
      return uploadImage(workspaceId, file);
    },
    [workspaceId],
  );

  const handleRememberPosition = useCallback(async () => {
    if (!currentDoc || rememberingPosition) return;

    setRememberingPosition(true);
    try {
      const position =
        editorRef.current?.getViewportBlockPosition() ??
        editorRef.current?.getSelectionBlockPosition();
      if (!position) {
        message.warning("当前没有可记录的位置");
        return;
      }

      await updateDocumentLastEditPosition({
        docId: currentDoc.docId,
        lastEditPosition: {
          ...position,
          updatedAt: new Date().toISOString(),
        },
      });

      lastPersistedEditBlockIdRef.current = position.blockId;
      forceRememberPositionRef.current = false;
      setQueuedLastEditPosition(null);
      message.success("已记录当前位置");
    } catch (error) {
      message.error(`记录位置失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setRememberingPosition(false);
    }
  }, [currentDoc, message, rememberingPosition]);

  useEffect(() => {
    if (!syncEngineEnabled) return;
    if (!currentDoc) return;

    if (syncUiSaveStatus === "dirty" || syncUiSaveStatus === "flushing" || syncUiSaveStatus === "error") {
      setSaveStatus(syncUiSaveStatus);
      return;
    }

    if (saveStatus === "no-draft" && !hasUnsavedChanges && syncUiSaveStatus === "saved") {
      return;
    }

    setSaveStatus(hasUnsavedChanges ? "draft-synced" : lastSavedAt ? "saved" : "loaded");
  }, [currentDoc, hasUnsavedChanges, lastSavedAt, saveStatus, setSaveStatus, syncUiSaveStatus, syncEngineEnabled]);

  useEffect(() => {
    if (!syncEngineEnabled) return;
    if (typeof liveContent === "string") return;
    if (loadingDoc) return;
    if (syncUiSaveStatus !== "dirty") return;
    const timer = window.setTimeout(() => {
      void syncFlush("autosync");
    }, syncPreferences.documentSyncDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    liveContent,
    loadingDoc,
    syncFlush,
    syncUiSaveStatus,
    syncEngineEnabled,
    syncPreferences.documentSyncDelayMs,
  ]);

  useEffect(() => {
    if (!syncEngineEnabled || !currentDoc || !queuedLastEditPosition) return;
    if (!shouldPersistLastEditPosition({
      hasQueuedPosition: true,
      loadingDoc,
      inFlight: lastEditPersistInflightRef.current,
      autoRecord: syncPreferences.autoRememberEditPosition,
      contentSyncStatus: syncUiSaveStatus,
      queuedBlockId: queuedLastEditPosition.blockId,
      lastPersistedBlockId: lastPersistedEditBlockIdRef.current,
      force: forceRememberPositionRef.current,
    })) return;

    const queuedPosition = queuedLastEditPosition;
    const delayMs = Math.max(2200, syncPreferences.documentSyncDelayMs + 1400);
    const timer = window.setTimeout(() => {
      lastEditPersistInflightRef.current = true;
      void updateDocumentLastEditPosition({
        docId: currentDoc.docId,
        lastEditPosition: queuedPosition,
      })
        .then(() => {
          lastPersistedEditBlockIdRef.current = queuedPosition.blockId;
          forceRememberPositionRef.current = false;
          setQueuedLastEditPosition((current) =>
            current?.updatedAt === queuedPosition.updatedAt ? null : current,
          );
        })
        .catch((error) => {
          console.warn("persist last edit position failed", error);
        })
        .finally(() => {
          lastEditPersistInflightRef.current = false;
        });
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [
    currentDoc,
    loadingDoc,
    queuedLastEditPosition,
    syncUiSaveStatus,
    syncEngineEnabled,
    syncPreferences.autoRememberEditPosition,
    syncPreferences.documentSyncDelayMs,
  ]);

  const handleManualSaveModeChange = useCallback((mode: ManualSaveMode) => {
    writeManualSaveMode(mode);
    setManualSaveMode(mode);
  }, []);

  const handleManualSave = useCallback(async (mode: ManualSaveMode = manualSaveMode) => {
    if (!currentDoc || manualSaving) return;

    setManualSaving(true);
    try {
      const isJsonDocument = typeof liveContent !== "string";
      const skipCommit = shouldSkipManualCommit({
        syncEngineEnabled,
        isJsonDocument,
        hasDiscardableDraft: discardableDraft,
        contentDirty,
      });
      let noDraftToSave = skipCommit;

      if (!skipCommit && (!syncEngineEnabled || typeof liveContent === "string")) {
        await saveLegacyContent(liveContent);
      } else if (!skipCommit) {
        const latestEditorContent = editorRef.current?.getJSON() as TiptapDoc | undefined;
        if (latestEditorContent?.type === "doc") {
          replaceContent(latestEditorContent);
        }
        const ok = await sync.flushAndCommitBarrier(
          latestEditorContent?.type === "doc" ? latestEditorContent : tiptapContent,
          async () => {
            try {
              const commitResult = await commitVersion(
                currentDoc.docId,
                "手动保存",
                currentSyncSession
                  ? {
                      sessionId: currentSyncSession.sessionId,
                      sessionEpoch: currentSyncSession.sessionEpoch,
                      ackedThroughOpSeq: sync.syncState?.lastAckedOpSeq ?? undefined,
                    }
                  : undefined,
              );
              applyCommittedVersion(commitResult.version, commitResult.draftRevision);
            } catch (error) {
              if (!isNoopCommitError(error)) {
                throw error;
              }
              noDraftToSave = true;
            }
          },
        );
        if (!ok) {
          setSaveStatus("error");
          return;
        }
      }
      if (noDraftToSave) {
        await clearLocalSnapshot();
        setContentDirty(false);
        setHasUnsavedChanges(false);
        markSavedAt(null);
        setSaveStatus("no-draft");
        return;
      }
      if (shouldReloadAfterManualSave({
        syncEngineEnabled,
        isJsonDocument,
        manualSaveMode: mode,
      })) {
        const loaded = await loadContent(currentDoc.docId);
        const loadedContent = loaded.content || BLANK_CONTENT;
        ignoreNextLocalSnapshotChange();
        replaceContent(loadedContent);
      }
      await clearLocalSnapshot();
      setContentDirty(false);
      setHasUnsavedChanges(false);
      markSavedAt(new Date());
      setSaveStatus("saved");
    } catch (e) {
      console.error("手动保存失败:", e);
      setSaveStatus("error");
      setHasUnsavedChanges(true);
    } finally {
      setManualSaving(false);
    }
  }, [
    sync,
    currentDoc,
    liveContent,
    contentDirty,
    manualSaving,
    manualSaveMode,
    markSavedAt,
    setHasUnsavedChanges,
    setSaveStatus,
    syncEngineEnabled,
    saveLegacyContent,
    loadContent,
    replaceContent,
    applyCommittedVersion,
    discardableDraft,
    currentSyncSession,
    tiptapContent,
    ignoreNextLocalSnapshotChange,
    clearLocalSnapshot,
  ]);

  const handleDiscardDraft = useCallback(async () => {
    if (!currentDoc || !discardableDraft || discardingDraft) return;

    setDiscardingDraft(true);
    try {
      try {
        await discardDraftRequest(currentDoc.docId, currentSyncSession ?? undefined);
      } catch (error) {
        if (!isNoopDiscardDraftError(error)) {
          throw error;
        }
      }
      const loaded = await loadContent(currentDoc.docId);
      ignoreNextLocalSnapshotChange();
      replaceContent(loaded.content || BLANK_CONTENT);
      await clearLocalSnapshot();
      setContentDirty(false);
      setHasUnsavedChanges(false);
      markSavedAt(null);
      setSaveStatus("loaded");
      message.success("已取消草稿");
    } catch (error) {
      console.error("取消草稿失败:", error);
      message.error("取消草稿失败");
    } finally {
      setDiscardingDraft(false);
    }
  }, [
    currentDoc,
    discardableDraft,
    discardingDraft,
    ignoreNextLocalSnapshotChange,
    loadContent,
    replaceContent,
    markSavedAt,
    message,
    currentSyncSession,
    setHasUnsavedChanges,
    setSaveStatus,
    clearLocalSnapshot,
  ]);

  const handleReloadAfterRevert = useCallback(async () => {
    if (!currentDoc) return;

    await selectDoc(currentDoc.docId);
    const loaded = await loadContent(currentDoc.docId);
    replaceContent(loaded.content || BLANK_CONTENT);
    await clearLocalSnapshot();
    setContentDirty(false);
    setHasUnsavedChanges(false);
    markSavedAt(null);
    setSaveStatus("loaded");
  }, [
    currentDoc,
    loadContent,
    markSavedAt,
    replaceContent,
    selectDoc,
    setHasUnsavedChanges,
    setSaveStatus,
    clearLocalSnapshot,
  ]);

  const handleSetupComplete = useCallback(
    (wsId: string) => {
      setWorkspace(wsId);
      if (pathname === "/") {
        router.replace(DASH_PATH);
      }
    },
    [pathname, router, setWorkspace],
  );

  const handleAiChatToggle = useCallback(() => {
    setAiChatOpen((open) => !open);
  }, []);

  const outputContent = useMemo(() => {
    if (!outputModalOpen) return "";
    if (activeTab === "json") {
      return typeof liveContent === "object" ? JSON.stringify(liveContent, null, 2) : "{}";
    }
    const previewHtml = contentToHtml(liveContent);
    return activeTab === "html" ? previewHtml : htmlToMarkdown(previewHtml);
  }, [activeTab, liveContent, outputModalOpen]);
  const copyLabel = activeTab === "html" ? "复制 HTML" : activeTab === "json" ? "复制 JSON" : "复制 Markdown";

  const setupOpen = shouldShowSetupModal({
    authLoading,
    isAuthenticated: authed,
    workspaceId,
  });
  const activeSettingsState =
    authed && workspaceId
      ? settingsState
      : buildSettingsState({ priority: readSettingsPriority() });
  const floatingToolbarItemIds = useMemo(
    () => getEnabledFloatingToolbarItemIds(toolbarPreferences),
    [toolbarPreferences],
  );
  const showFixedToolbar =
    !toolbarPreferences.floatingToolbarEnabled ||
    toolbarPreferences.showFixedToolbarWithFloating;
  const markdownEditorStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--app-editor-font-size": `${activeSettingsState.effectiveSettings.editor.fontSize}px`,
        "--app-editor-content-width": `${activeSettingsState.effectiveSettings.editor.contentWidth}px`,
      }) as CSSProperties,
    [
      activeSettingsState.effectiveSettings.editor.contentWidth,
      activeSettingsState.effectiveSettings.editor.fontSize,
    ],
  );
  const handleEditorProfilerRender = useCallback<ProfilerOnRenderCallback>(
    (_id, phase, actualDuration, baseDuration) => {
      traceEditorPerf("EditorPage.MarkdownEditor.render", actualDuration, {
        phase,
        baseDuration: Math.round(baseDuration * 100) / 100,
      });
    },
    [],
  );
  const markdownEditorElement = useMemo(() => (
    <MarkdownEditor
      ref={editorRef}
      content={content}
      onChange={handleEditorChange}
      placeholder="不用完美，先留下痕迹"
      showToolbar={showFixedToolbar}
      floatingToolbarEnabled={toolbarPreferences.floatingToolbarEnabled}
      floatingToolbarItemIds={floatingToolbarItemIds}
      floatingToolbarDelayMs={toolbarPreferences.floatingToolbarDelayMs}
      showTOC={showTOC}
      onTOCToggle={setShowTOC}
      loading={loadingDoc}
      defaultFontSize={activeSettingsState.effectiveSettings.editor.fontSize}
      contentWidth={activeSettingsState.effectiveSettings.editor.contentWidth}
      title={currentDoc?.title ?? ""}
      onTitleChange={handleTitleChange}
      onUploadImage={handleUploadImage}
      onAiChatToggle={handleAiChatToggle}
      style={markdownEditorStyle}
    />
  ), [
    activeSettingsState.effectiveSettings.editor.contentWidth,
    activeSettingsState.effectiveSettings.editor.fontSize,
    content,
    currentDoc?.title,
    floatingToolbarItemIds,
    handleEditorChange,
    handleTitleChange,
    handleUploadImage,
    handleAiChatToggle,
    loadingDoc,
    markdownEditorStyle,
    showFixedToolbar,
    showTOC,
    toolbarPreferences.floatingToolbarDelayMs,
    toolbarPreferences.floatingToolbarEnabled,
  ]);

  const handleToolbarPreferencesChange = useCallback((next: EditorToolbarPreferences) => {
    setToolbarPreferences(next);
    writeEditorToolbarPreferences(next);
  }, []);

  const handleSyncPreferencesChange = useCallback((next: EditorSyncPreferences) => {
    setSyncPreferences(next);
    writeEditorSyncPreferences(next);
    if (!next.autoRememberEditPosition) {
      setQueuedLastEditPosition(null);
      forceRememberPositionRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (
      !workspaceId ||
      !currentDoc ||
      (!hasUnsavedChanges && !sync.hasPendingSync) ||
      !activeSettingsState.effectiveSettings.editor.confirmBeforeLeave
    ) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [
    activeSettingsState.effectiveSettings.editor.confirmBeforeLeave,
    currentDoc,
    hasUnsavedChanges,
    sync.hasPendingSync,
    workspaceId,
  ]);

  if (authLoading) {
    return (
      <AppLoader
        label="正在恢复登录状态…"
        words={["检查登录", "恢复账号", "读取令牌", "准备工作区", "检查登录"]}
      />
    );
  }

  return (
    <>
      <SetupModal open={setupOpen} onComplete={handleSetupComplete} />

      {authed && workspaceId && (
        <>
          <DocumentHeader
            onSave={handleManualSave}
            manualSaveMode={manualSaveMode}
            onManualSaveModeChange={handleManualSaveModeChange}
            onRememberPosition={handleRememberPosition}
            onDiscardDraft={handleDiscardDraft}
            saving={manualSaving}
            loadingDoc={loadingDoc}
            rememberingPosition={rememberingPosition}
            discardingDraft={discardingDraft}
            showTOC={showTOC}
            onToggleTOC={setShowTOC}
            settingsScope={settingsScope}
            settingsPriority={activeSettingsState.priority}
            settingsByScope={{
              user: activeSettingsState.userSettings,
              workspace: activeSettingsState.workspaceSettings,
            }}
            effectiveSettings={activeSettingsState.effectiveSettings}
            toolbarPreferences={toolbarPreferences}
            syncPreferences={syncPreferences}
            settingsSaving={settingsSaving}
            onSettingsScopeChange={setSettingsScope}
            onSettingsPriorityChange={(priority) => {
              writeSettingsPriority(priority);
              setSettingsState((current) =>
                buildSettingsState({
                  userSettings: current.userSettings,
                  workspaceSettings: current.workspaceSettings,
                  priority,
                }),
              );
            }}
            onToolbarPreferencesChange={handleToolbarPreferencesChange}
            onSyncPreferencesChange={handleSyncPreferencesChange}
            onSaveSettings={async (scope, nextSettings) => {
              setSettingsSaving(true);
              try {
                let nextState = settingsState;
                if (scope === "user") {
                  const savedSettings = await updateUserSettings(nextSettings as UserSettings);
                  nextState = buildSettingsState({
                    userSettings: savedSettings,
                    workspaceSettings: settingsState.workspaceSettings,
                    priority: settingsState.priority,
                  });
                } else {
                  if (!workspaceId) return;
                  const savedSettings = await updateWorkspaceSettings(
                    workspaceId,
                    nextSettings as WorkspaceSettings,
                  );
                  nextState = buildSettingsState({
                    userSettings: settingsState.userSettings,
                    workspaceSettings: savedSettings,
                    priority: settingsState.priority,
                  });
                }
                setSettingsState(nextState);
                message.success(scope === "user" ? "个人设置已保存" : "空间设置已保存");
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "保存设置失败";
                message.error(errorMessage);
                throw error;
              } finally {
                setSettingsSaving(false);
              }
            }}
            localSnapshotState={localSnapshot.state}
            onRefreshLocalSnapshot={localSnapshot.refreshSnapshot}
            onCopyLocalSnapshot={localSnapshot.copyStoredSnapshot}
            onCopyCurrentSnapshot={localSnapshot.copyCurrentSnapshot}
            onClearLocalSnapshot={localSnapshot.clearSnapshot}
            onManualSaveSnapshot={localSnapshot.manualSave}
            autoSaveSnapshotEnabled={autoSaveSnapshotEnabled}
            onAutoSaveSnapshotChange={(enabled) => {
              setAutoSaveSnapshotEnabled(enabled);
              localStorage.setItem("yuediter:local-snapshot:auto-save", String(enabled));
            }}
            currentDocumentContent={tiptapContent}
            onRevertedToVersion={handleReloadAfterRevert}
            onToggleFindReplace={handleToggleFindReplace}
            zenMode={zenMode}
          />
          <FindReplaceBar
            editor={findReplaceEditor}
            visible={findReplaceOpen}
            onClose={handleCloseFindReplace}
          />
          <div className={`output-card${zenMode ? " output-card--zen" : ""}`}>
            <Profiler id="MarkdownEditor" onRender={handleEditorProfilerRender}>
              {markdownEditorElement}
            </Profiler>
          </div>

          <AiChatFloatingPanel
            open={aiChatOpen}
            workspaceId={workspaceId}
            onClose={() => setAiChatOpen(false)}
          />

          <button
            className="output-trigger-btn"
            onClick={() => setOutputModalOpen(true)}
            title="查看 HTML / Markdown / JSON"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <span>输出</span>
          </button>

          {outputModalOpen && (
            <div className="output-modal-overlay" onClick={() => setOutputModalOpen(false)}>
              <div className="output-modal" onClick={(e) => e.stopPropagation()}>
                <div className="output-modal-header">
                  <div className="output-tab-bar">
                    <button
                      className={`output-tab ${activeTab === "markdown" ? "output-tab--active" : "output-tab--inactive"}`}
                      onClick={() => setActiveTab("markdown")}
                    >
                      Markdown
                    </button>
                    <button
                      className={`output-tab ${activeTab === "html" ? "output-tab--active" : "output-tab--inactive"}`}
                      onClick={() => setActiveTab("html")}
                    >
                      HTML
                    </button>
                    <button
                      className={`output-tab ${activeTab === "json" ? "output-tab--active" : "output-tab--inactive"}`}
                      onClick={() => setActiveTab("json")}
                    >
                      JSON
                    </button>
                  </div>
                  <div className="output-modal-actions">
                    <button
                      className="copy-button"
                      onClick={() => {
                        navigator.clipboard.writeText(outputContent);
                      }}
                    >
                      {copyLabel}
                    </button>
                    <button
                      className="output-modal-close"
                      onClick={() => setOutputModalOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <pre className="output-pre">{outputContent}</pre>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function EditorPage() {
  return (
    <App>
      <AuthProvider>
        <DocumentProvider>
          <div className="app-container">
            <EditorContent />
          </div>
        </DocumentProvider>
      </AuthProvider>
    </App>
  );
}

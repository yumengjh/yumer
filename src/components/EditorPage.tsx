"use client";

import { useState, useMemo, useCallback, useEffect, useRef, type CSSProperties } from "react";
import { App } from "antd";
import { usePathname, useRouter } from "next/navigation";
import TurndownService from "turndown";
import { MarkdownEditor, MarkdownEditorRef } from "@/components/markdown-editor";
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
import { useAutoSave } from "@/hooks/useAutoSave";
import { useLocalDocumentSnapshot } from "@/hooks/useLocalDocumentSnapshot";
import {
  commitVersion,
  discardDraft as discardDraftRequest,
  saveDocumentContentV2,
  type EditorContent,
  type LastEditPosition,
  updateDocumentLastEditPosition,
} from "@/services/document";
import { useDocumentSync } from "@/hooks/useDocumentSync";
import { hashEditorDoc, shouldApplyRemoteContent } from "@/services/sync/hash";
import { readIdentityFromAttrs } from "@/services/sync/identity";
import { shouldEnableLegacyAutoSave } from "@/services/save-policy";
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

type OutputTab = "html" | "markdown" | "json";

const BLANK_CONTENT: TiptapDoc = {
  type: "doc",
  content: [{ type: "paragraph" }],
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
    currentBlockIds,
    lastEditPosition,
    loadContent,
    selectDoc,
    updateDoc,
    workspaceId,
    setWorkspace,
    setSaveStatus,
    markSavedAt,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    lastSavedAt,
    pendingScrollBlockId,
    setPendingScrollBlockId,
  } = useDocument();

  const [content, setContent] = useState<EditorContent>(BLANK_CONTENT);
  const [contentDirty, setContentDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<OutputTab>("markdown");
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [outputModalOpen, setOutputModalOpen] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
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
  const loadedDocIdRef = useRef<string | null>(null);
  const hydratingSlugRef = useRef<string | null>(null);
  const lastPathnameRef = useRef<string | null>(null);
  const contentRef = useRef<EditorContent>(content);
  const editorRef = useRef<MarkdownEditorRef>(null);
  const restoredLastEditDocIdRef = useRef<string | null>(null);
  const [pendingLastEditRestoreBlockId, setPendingLastEditRestoreBlockId] = useState<string | null>(null);
  const lastPersistedEditBlockIdRef = useRef<string | null>(null);
  const lastEditPersistInflightRef = useRef(false);
  const forceRememberPositionRef = useRef(false);
  const [queuedLastEditPosition, setQueuedLastEditPosition] = useState<LastEditPosition | null>(null);
  const [rememberingPosition, setRememberingPosition] = useState(false);
  const tiptapContent = typeof content === "object" && content?.type === "doc"
    ? (content as TiptapDoc)
    : null;

  const sync = useDocumentSync({
    docId: syncEngineEnabled ? currentDoc?.docId ?? null : null,
    rootBlockId: syncEngineEnabled ? currentDoc?.rootBlockId ?? null : null,
    baseVersion: syncEngineEnabled ? currentDocVersion : null,
    content: syncEngineEnabled ? tiptapContent : null,
    onContentPatched: (doc) => {
      const latestEditorContent = editorRef.current?.getJSON() as TiptapDoc | undefined;
      if (latestEditorContent?.type === "doc") {
        // create ack 只合并 attrs，不回灌旧 snapshot 内容，避免覆盖用户正在输入的文本/顺序。
        // 同时必须把 blockId/sortKey 写回 editor 与 React content，否则下一次刷新前的首行更新会丢失身份。
        const merged = mergeAckAttrsIntoCurrentEditorDoc(latestEditorContent, doc);
        if (merged !== latestEditorContent) {
          editorRef.current?.patchBlockIdentityFromDoc(merged);
          contentRef.current = merged;
          setContent(merged);
        }
        return merged;
      }
      return doc;
    },
  });
  const syncFlush = sync.flush;
  const syncUiSaveStatus = sync.uiSaveStatus;
  const localSnapshot = useLocalDocumentSnapshot({
    docId: currentDoc?.docId ?? null,
    content: tiptapContent,
    enabled: Boolean(currentDoc?.docId && tiptapContent),
    autoSave: autoSaveSnapshotEnabled,
  });
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Ctrl+F / Ctrl+H 打开查找替换栏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === "f" || key === "h")) {
        e.preventDefault();
        setFindReplaceOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    restoredLastEditDocIdRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore queue must reset when the active document changes
    setPendingLastEditRestoreBlockId(null);
    lastPersistedEditBlockIdRef.current = lastEditPosition?.blockId ?? null;
    lastEditPersistInflightRef.current = false;
    forceRememberPositionRef.current = false;
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
      setContent(BLANK_CONTENT);
      setContentDirty(false);
      setHasUnsavedChanges(false);
      markSavedAt(null);
      setSaveStatus("idle");
      loadedDocIdRef.current = null;
      return;
    }
    if (loadedDocIdRef.current === docId) return;

    loadedDocIdRef.current = docId;
    setLoadingDoc(true);
    setContentDirty(false);
    loadContent(docId)
      .then((loaded) => {
        setContent(loaded.content || BLANK_CONTENT);
        setContentDirty(false);
        setHasUnsavedChanges(false);
        markSavedAt(null);
        setSaveStatus("loaded");
      })
      .catch(() => {
        setContent(BLANK_CONTENT);
        setContentDirty(false);
        loadedDocIdRef.current = null;
      })
      .finally(() => {
        setLoadingDoc(false);
      });
  }, [currentDoc, loadContent, markSavedAt, setHasUnsavedChanges, setSaveStatus]);

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

  useAutoSave(content, saveLegacyContent, {
    delay: 1500,
    enabled: shouldEnableLegacyAutoSave({
      syncEngineEnabled,
      loadingDoc,
      hasCurrentDoc: Boolean(currentDoc),
      contentDirty,
      content,
    }),
  });

  const queueEditorPosition = useCallback((mode: "selection" | "viewport", force = false): boolean => {
    const position =
      mode === "viewport"
        ? editorRef.current?.getViewportBlockPosition()
        : editorRef.current?.getSelectionBlockPosition();
    if (!position) return false;

    forceRememberPositionRef.current = force;
    setQueuedLastEditPosition({
      ...position,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }, []);

  const handleEditorChange = useCallback((nextContent: EditorContent) => {
    setContent(nextContent);
    setContentDirty(true);
    if (loadingDoc) return;
    if (currentDoc) {
      setHasUnsavedChanges(true);
      setSaveStatus("dirty");
      if (syncPreferences.autoRememberEditPosition) {
        void queueEditorPosition("selection", false);
      }
    }
  }, [
    currentDoc,
    loadingDoc,
    queueEditorPosition,
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

    setSaveStatus(hasUnsavedChanges ? "draft-synced" : lastSavedAt ? "saved" : "loaded");
  }, [currentDoc, hasUnsavedChanges, lastSavedAt, setSaveStatus, syncUiSaveStatus, syncEngineEnabled]);

  useEffect(() => {
    if (!syncEngineEnabled) return;
    if (typeof content === "string") return;
    if (loadingDoc) return;
    if (syncUiSaveStatus !== "dirty") return;
    const timer = window.setTimeout(() => {
      void syncFlush("autosync");
    }, syncPreferences.documentSyncDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    content,
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

  const handleManualSave = useCallback(async () => {
    if (!currentDoc || manualSaving) return;

    setManualSaving(true);
    try {
      if (!syncEngineEnabled || typeof content === "string") {
        await saveLegacyContent(content);
      } else {
        const latestEditorContent = editorRef.current?.getJSON() as TiptapDoc | undefined;
        if (latestEditorContent?.type === "doc") {
          setContent(latestEditorContent);
        }
        const ok = await sync.flushAndCommitBarrier(
          latestEditorContent?.type === "doc" ? latestEditorContent : tiptapContent,
        );
        if (!ok) {
          setSaveStatus("error");
          return;
        }
      }
      await commitVersion(currentDoc.docId, "手动保存");
      if (syncEngineEnabled && typeof content !== "string") {
        const editorContentAtReload = editorRef.current?.getJSON() as TiptapDoc | undefined;
        const hashAtReloadStart = editorContentAtReload?.type === "doc"
          ? hashEditorDoc(editorContentAtReload)
          : null;
        const loaded = await loadContent(currentDoc.docId);
        const loadedContent = loaded.content || BLANK_CONTENT;
        const currentEditorContent = editorRef.current?.getJSON() as TiptapDoc | undefined;
        const currentHash = currentEditorContent?.type === "doc" && hashAtReloadStart
          ? hashEditorDoc(currentEditorContent)
          : hashAtReloadStart;
        const responseHash = typeof loadedContent === "object" && loadedContent.type === "doc" && hashAtReloadStart
          ? hashEditorDoc(loadedContent)
          : hashAtReloadStart;

        if (
          hashAtReloadStart &&
          currentHash &&
          responseHash &&
          shouldApplyRemoteContent({
            hashAtDispatch: hashAtReloadStart,
            currentEditorHash: currentHash,
            responseHash,
          })
        ) {
          setContent(loadedContent);
        } else if (hashAtReloadStart) {
          setSaveStatus("error");
          setHasUnsavedChanges(true);
          message.warning("保存响应已过期，当前编辑内容未被覆盖。请检查同步状态后重试。");
          return;
        }
      }
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
    content,
    manualSaving,
    markSavedAt,
    setHasUnsavedChanges,
    setSaveStatus,
    syncEngineEnabled,
    saveLegacyContent,
    loadContent,
    tiptapContent,
    message,
  ]);

  const handleDiscardDraft = useCallback(async () => {
    if (!currentDoc || currentContentSource !== "draft" || discardingDraft) return;

    setDiscardingDraft(true);
    try {
      await discardDraftRequest(currentDoc.docId);
      const loaded = await loadContent(currentDoc.docId);
      setContent(loaded.content || BLANK_CONTENT);
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
    currentContentSource,
    currentDoc,
    discardingDraft,
    loadContent,
    markSavedAt,
    message,
    setHasUnsavedChanges,
    setSaveStatus,
  ]);

  const handleReloadAfterRevert = useCallback(async () => {
    if (!currentDoc) return;

    await selectDoc(currentDoc.docId);
    const loaded = await loadContent(currentDoc.docId);
    setContent(loaded.content || BLANK_CONTENT);
    setContentDirty(false);
    setHasUnsavedChanges(false);
    markSavedAt(null);
    setSaveStatus("loaded");
  }, [
    currentDoc,
    loadContent,
    markSavedAt,
    selectDoc,
    setHasUnsavedChanges,
    setSaveStatus,
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

  const previewHtml = useMemo(() => contentToHtml(content), [content]);
  const markdown = useMemo(() => htmlToMarkdown(previewHtml), [previewHtml]);
  const jsonContent = useMemo(() => {
    if (activeTab !== "json") return "";
    if (typeof content === "object") return JSON.stringify(content, null, 2);
    return "{}";
  }, [activeTab, content]);
  const outputContent = activeTab === "html" ? previewHtml : activeTab === "json" ? jsonContent : markdown;
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
      !hasUnsavedChanges ||
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
            onRememberPosition={handleRememberPosition}
            onDiscardDraft={handleDiscardDraft}
            saving={manualSaving}
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
            onToggleFindReplace={() => setFindReplaceOpen((prev) => !prev)}
          />
          <FindReplaceBar
            editor={editorRef.current?.getEditor() ?? null}
            visible={findReplaceOpen}
            onClose={() => setFindReplaceOpen(false)}
          />
          <div className="output-card">
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
              workspaceId={workspaceId}
              title={currentDoc?.title ?? ""}
              onTitleChange={handleTitleChange}
              style={
                {
                  "--app-editor-font-size": `${activeSettingsState.effectiveSettings.editor.fontSize}px`,
                  "--app-editor-content-width": `${activeSettingsState.effectiveSettings.editor.contentWidth}px`,
                } as CSSProperties
              }
            />
          </div>

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

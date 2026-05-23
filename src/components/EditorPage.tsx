"use client";

import { useState, useMemo, useCallback, useEffect, useRef, type CSSProperties } from "react";
import { App } from "antd";
import { usePathname, useRouter } from "next/navigation";
import TurndownService from "turndown";
import { MarkdownEditor, MarkdownEditorRef } from "@/components/markdown-editor";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import {
  DASH_EDIT_PATH,
  DASH_PATH,
  DocumentProvider,
  useDocument,
} from "@/contexts/DocumentContext";
import { decodeDocSlug } from "@/lib/doc-slug";
import { SetupModal } from "@/components/SetupModal";
import AppLoader from "@/components/AppLoader";
import { shouldShowSetupModal } from "@/components/editorSetupState";
import { DocumentHeader } from "@/components/DocumentHeader";
import { useAutoSave } from "@/hooks/useAutoSave";
import {
  commitVersion,
  saveDocumentContentV2,
  type EditorContent,
} from "@/services/document";
import { useDocumentSync } from "@/hooks/useDocumentSync";
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

type OutputTab = "html" | "markdown" | "json";

const DEFAULT_CONTENT: TiptapDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "欢迎使用 Markdown 增强型富文本编辑器" }] },
    { type: "paragraph", content: [
      { type: "text", text: "这是一款 " },
      { type: "text", text: "所见即所得", marks: [{ type: "bold" }] },
      { type: "text", text: " 的现代化编辑器，基于 TipTap 构建，融合 Markdown 简洁性与富文本强大能力，支持所有常用排版与内容格式：" },
    ]},
    { type: "bulletList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "六级标题（H1 - H6）自动排版与目录结构" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "加粗、斜体、下划线、删除线、字体颜色、背景高亮" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "有序列表 / 无序列表（支持多前缀样式）" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "待办事项清单、段落对齐、行高、缩进调整" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "代码块 / 行内代码（支持主流编程语言语法高亮）" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "引用块、高亮提示块、分割线、表格、链接、图片" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "撤销 / 重做、清除格式、格式刷一键复用样式" }] }] },
    ]},
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "无需记忆复杂语法，点击工具栏即可完成专业排版，适用于笔记、文档、技术文章、报告等多种场景。" }] }] },
    { type: "codeBlock", attrs: { language: "typescript" }, content: [{ type: "text", text: '// 快速体验：选中文字 → 使用工具栏格式化\nconst editor = "现代化富文本编辑器";\nconsole.log("欢迎使用", editor);' }] },
    { type: "paragraph", content: [{ type: "text", text: "开始你的创作吧 ↓" }] },
  ],
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
    loadContent,
    selectDoc,
    workspaceId,
    setWorkspace,
    setSaveStatus,
    markSavedAt,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    lastSavedAt,
  } = useDocument();

  const [content, setContent] = useState<EditorContent>(DEFAULT_CONTENT);
  const [contentDirty, setContentDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<OutputTab>("markdown");
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [outputModalOpen, setOutputModalOpen] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [settingsState, setSettingsState] = useState<SettingsState>(() =>
    buildSettingsState({ priority: "workspace-first" }),
  );
  const [settingsScope, setSettingsScope] = useState<SettingsScope>("user");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const syncEngineEnabled = process.env.NEXT_PUBLIC_SYNC_ENGINE_ENABLED === "true";
  const loadedDocIdRef = useRef<string | null>(null);
  const hydratingSlugRef = useRef<string | null>(null);
  const contentRef = useRef<EditorContent>(content);
  const editorRef = useRef<MarkdownEditorRef>(null);
  const tiptapContent = typeof content === "object" && content?.type === "doc"
    ? (content as TiptapDoc)
    : null;

  const sync = useDocumentSync({
    docId: syncEngineEnabled ? currentDoc?.docId ?? null : null,
    rootBlockId: syncEngineEnabled ? currentDoc?.rootBlockId ?? null : null,
    baseVersion: syncEngineEnabled ? currentDocVersion : null,
    content: syncEngineEnabled ? tiptapContent : null,
    onContentPatched: (doc) => setContent(doc),
  });

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

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
    if (!authed || authLoading || !workspaceId) return;
    if (!pathname.startsWith(`${DASH_EDIT_PATH}/`)) return;

    const slug = pathname.slice(DASH_EDIT_PATH.length + 1);
    if (!slug) {
      router.replace(DASH_PATH);
      return;
    }
    if (currentDocSlug === slug) {
      hydratingSlugRef.current = null;
      return;
    }
    if (hydratingSlugRef.current === slug) return;

    let docId: string;
    try {
      docId = decodeDocSlug(slug);
    } catch {
      message.error("文档地址无效");
      router.replace(DASH_PATH);
      return;
    }

    hydratingSlugRef.current = slug;
    void selectDoc(docId)
      .catch(() => {
        message.error("无法打开该文档");
        router.replace(DASH_PATH);
      })
      .finally(() => {
        if (hydratingSlugRef.current === slug) {
          hydratingSlugRef.current = null;
        }
      });
  }, [authLoading, authed, currentDocSlug, message, pathname, router, selectDoc, workspaceId]);

  useEffect(() => {
    const docId = currentDoc?.docId;
    if (!docId) {
      setContent(DEFAULT_CONTENT);
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
        setContent(loaded.content || DEFAULT_CONTENT);
        setContentDirty(false);
        setHasUnsavedChanges(false);
        markSavedAt(null);
        setSaveStatus("loaded");
      })
      .catch(() => {
        setContent(DEFAULT_CONTENT);
        setContentDirty(false);
        loadedDocIdRef.current = null;
      })
      .finally(() => {
        setLoadingDoc(false);
      });
  }, [currentDoc, loadContent, markSavedAt, setHasUnsavedChanges, setSaveStatus]);

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

  const handleEditorChange = useCallback((nextContent: EditorContent) => {
    setContent(nextContent);
    setContentDirty(true);
    if (loadingDoc) return;
    if (currentDoc) {
      setHasUnsavedChanges(true);
      setSaveStatus("dirty");
    }
  }, [currentDoc, loadingDoc, setHasUnsavedChanges, setSaveStatus]);

  useEffect(() => {
    if (!syncEngineEnabled) return;
    if (!currentDoc) return;

    if (sync.uiSaveStatus === "dirty" || sync.uiSaveStatus === "flushing" || sync.uiSaveStatus === "error") {
      setSaveStatus(sync.uiSaveStatus);
      return;
    }

    setSaveStatus(hasUnsavedChanges ? "draft-synced" : lastSavedAt ? "saved" : "loaded");
  }, [currentDoc, hasUnsavedChanges, lastSavedAt, setSaveStatus, sync.uiSaveStatus, syncEngineEnabled]);

  useEffect(() => {
    if (!syncEngineEnabled) return;
    if (typeof content === "string") return;
    if (loadingDoc) return;
    if (sync.uiSaveStatus !== "dirty") return;
    const timer = window.setTimeout(() => {
      void sync.flush("autosync");
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [content, loadingDoc, sync, sync.uiSaveStatus, syncEngineEnabled]);

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
      if (syncEngineEnabled) {
        const loaded = await loadContent(currentDoc.docId);
        setContent(loaded.content || DEFAULT_CONTENT);
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
  ]);

  useEffect(() => {
    if (!workspaceId || !currentDoc || !hasUnsavedChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [currentDoc, hasUnsavedChanges, workspaceId]);

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
    const json = editorRef.current?.getJSON();
    return json ? JSON.stringify(json, null, 2) : "{}";
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
            saving={manualSaving}
            showTOC={showTOC}
            onToggleTOC={setShowTOC}
            settingsScope={settingsScope}
            settingsPriority={activeSettingsState.priority}
            settingsByScope={{
              user: activeSettingsState.userSettings,
              workspace: activeSettingsState.workspaceSettings,
            }}
            effectiveSettings={activeSettingsState.effectiveSettings}
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
          />
          <div className="output-card">
            <MarkdownEditor
              ref={editorRef}
              content={content}
              onChange={handleEditorChange}
              placeholder="开始记录你的知识吧…"
              showTOC={showTOC}
              onTOCToggle={setShowTOC}
              loading={loadingDoc}
              defaultFontSize={activeSettingsState.effectiveSettings.editor.fontSize}
              contentWidth={activeSettingsState.effectiveSettings.editor.contentWidth}
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

import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import CodeBlock from "@tiptap/extension-code-block";
import Code from "@tiptap/extension-code";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { LinkExtension } from "./extensions/linkExtension";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import {
  DEFAULT_CODE_LANGUAGE,
  getShikiHighlighter,
  type CodeThemeMode,
  type ShikiHighlighter,
} from "./code/codeHighlight";
import { createShikiCodeBlockExtension, SHIKI_CODE_BLOCK_PLUGIN_KEY } from "./code/shikiCodeBlock";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { createPasteHandlerExtension } from "./extensions/pasteHandler";
import { createFontSizeExtension } from "./extensions/fontSize";
import { ListTypography } from "./extensions/listTypography";
import { TableIndexColumn } from "./extensions/tableIndexColumn";
import { OrderedListStyle } from "./extensions/orderedListStyle";
import { LineHeight } from "./extensions/lineHeight";
import { createMarkdownShortcutsExtension } from "./extensions/markdownShortcuts";
import { HighlightBlock } from "./extensions/highlightBlock";
import HighlightBlockView from "./HighlightBlockView";
import { Indent } from "./extensions/indent";
import { ImageBlock } from "./extensions/imageBlock";
import ImageBlockView from "./ImageBlockView";
import { BlockIdAttribute } from "./extensions/blockIdAttribute";
import { HeadingAnchor } from "./extensions/headingAnchor";
import { MultiCursor } from "./extensions/multiCursor";
import TaskItemView from "./TaskItemView";
import { EditorContextProvider } from "./EditorContext";
import Toolbar from "./Toolbar";
import FloatingSelectionToolbar from "./Toolbar/FloatingSelectionToolbar";
import BlockToolbar from "./BlockToolbar";
import LinkToolbar from "./LinkToolbar";
import TableInteractions from "./TableInteractions";
import TableOfContents from "./TableOfContents";
import EditorLoader from "./EditorLoader";
import {
  BLOCK_IDENTITY_PATCH_META,
  patchEditorBlockIdentityFromDoc,
  patchEditorBlockIdentityFromMatchingDoc,
  patchEditorDocumentIdentity,
} from "./editorIdentity";
import {
  BLOCK_IDENTITY_NODE_TYPES,
  readIdentityFromAttrs,
} from "./utils/identity";
import { stripUnsupportedSyncAttrs } from "./editorContentNormalization";
import { resolveEditorScrollContainer, resolveEditorViewportTop } from "./scrollContainer";
import type { EditorContent as EditorContentType, EditorImageUploadHandler, TiptapDoc } from "./types";
import type { SyncDiffHint } from "@/services/sync/types";
import "./styles/editor.css";

export interface MarkdownEditorRef {
  /** 获取 JSON 格式内容 */
  getJSON: () => object;
  /** 获取 HTML 格式内容 */
  getHTML: () => string;
  /** 获取纯文本内容 */
  getText: () => string;
  /** 获取 Tiptap Editor 实例 */
  getEditor: () => Editor | null;
  /** 仅将同步确认的 blockId/sortKey 写回当前编辑器节点 attrs */
  patchBlockIdentityFromDoc: (doc: TiptapDoc) => boolean;
  /** 滚动到指定 blockId 的块位置 */
  scrollToBlock: (blockId: string) => boolean;
  /** 获取当前选区所在块及相邻块 */
  getSelectionBlockPosition: () => {
    blockId: string;
    previousBlockId: string | null;
    nextBlockId: string | null;
  } | null;
  getViewportBlockPosition: () => {
    blockId: string;
    previousBlockId: string | null;
    nextBlockId: string | null;
  } | null;
}

export interface MarkdownEditorProps {
  /** 内容（HTML 字符串或 Tiptap JSON） */
  content?: EditorContentType;
  /** 内容变化回调（输出 Tiptap JSON） */
  onChange?: (content: EditorContentType, syncDiffHint?: SyncDiffHint) => void;
  /** 是否可编辑，默认 true */
  editable?: boolean;
  /** 占位文字 */
  placeholder?: string;
  /** 代码块主题，默认跟随系统 */
  theme?: "light" | "dark";
  /** 是否显示工具栏，默认 true */
  showToolbar?: boolean;
  /** Visible item ids for the fixed toolbar. */
  toolbarItemIds?: string[];
  /** Whether to show the floating toolbar when text is selected. */
  floatingToolbarEnabled?: boolean;
  /** Visible item ids for the floating toolbar. */
  floatingToolbarItemIds?: string[];
  /** Delay before showing the floating toolbar after selection stabilizes. */
  floatingToolbarDelayMs?: number;
  /** 是否显示目录，默认 false */
  showTOC?: boolean;
  /** 目录开关回调 */
  onTOCToggle?: (open: boolean) => void;
  /** 自定义类名 */
  className?: string;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** 编辑区最小高度，默认 "460px" */
  minHeight?: string;
  /** 自动聚焦 */
  autofocus?: boolean | "start" | "end";
  /** 内容加载状态 */
  loading?: boolean;
  /** 默认字号，用于正文字号和工具栏默认态 */
  defaultFontSize?: number;
  /** 编辑宽度 */
  contentWidth?: number;
  /** 当前工作空间，用于图片上传 */
  /** 文档标题 */
  title?: string;
  /** Whether to show the document title field. */
  showTitle?: boolean;
  /** 标题变化回调（失焦时触发） */
  onTitleChange?: (title: string) => void;
  onUploadImage?: EditorImageUploadHandler;
}

function EditorSkeleton() {
  return (
    <div className="skeleton-container">
      <div className="skeleton-item skeleton-title" />
      <div className="skeleton-item skeleton-text" />
      <div className="skeleton-item skeleton-text" />
      <div className="skeleton-item skeleton-text-mid" />
      <div className="skeleton-item skeleton-text" />
      <div className="skeleton-item skeleton-text-short" />
      <div className="skeleton-item skeleton-text" />
      <div className="skeleton-item skeleton-text" />
      <div className="skeleton-item skeleton-text-mid" />
      <div className="skeleton-item skeleton-text-short" />
    </div>
  );
}

function readTopLevelBlockIds(editor: Editor): string[] {
  const blockIds: string[] = [];
  editor.state.doc.forEach((node) => {
    const blockId = typeof node.attrs?.blockId === "string" ? node.attrs.blockId : null;
    if (blockId) {
      blockIds.push(blockId);
    }
  });
  return blockIds;
}

function readSelectionBlockPosition(editor: Editor): {
  blockId: string;
  previousBlockId: string | null;
  nextBlockId: string | null;
} | null {
  const { $from } = editor.state.selection;
  let currentBlockId: string | null = null;

  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const candidate = $from.node(depth).attrs?.blockId;
    if (typeof candidate === "string" && candidate.length > 0) {
      currentBlockId = candidate;
      break;
    }
  }

  if (!currentBlockId) return null;

  const blockIds = readTopLevelBlockIds(editor);
  const currentIndex = blockIds.indexOf(currentBlockId);
  if (currentIndex < 0) {
    return {
      blockId: currentBlockId,
      previousBlockId: null,
      nextBlockId: null,
    };
  }

  return {
    blockId: currentBlockId,
    previousBlockId: blockIds[currentIndex - 1] ?? null,
    nextBlockId: blockIds[currentIndex + 1] ?? null,
  };
}

function readViewportBlockPosition(editor: Editor): {
  blockId: string;
  previousBlockId: string | null;
  nextBlockId: string | null;
} | null {
  const blockElements = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("[data-block-id]"));
  if (blockElements.length === 0) return null;

  const HEADER_OFFSET = 96 + 20;
  const scrollContainer = resolveEditorScrollContainer(editor.view.dom);
  const containerTop = resolveEditorViewportTop(scrollContainer);
  const target =
    blockElements.find(
      (element) => element.getBoundingClientRect().bottom > containerTop + HEADER_OFFSET,
    ) ??
    blockElements[blockElements.length - 1];
  const blockId = target.dataset.blockId;
  if (!blockId) return null;

  const blockIds = blockElements.map((element) => element.dataset.blockId).filter(Boolean) as string[];
  const currentIndex = blockIds.indexOf(blockId);
  if (currentIndex < 0) return null;

  const result = {
    blockId,
    previousBlockId: blockIds[currentIndex - 1] ?? null,
    nextBlockId: blockIds[currentIndex + 1] ?? null,
  };

  return result;
}

function scrollElementIntoEditorView(element: HTMLElement): void {
  const HEADER_OFFSET = 96 + 20;
  const scrollContainer = resolveEditorScrollContainer(element);

  if (scrollContainer instanceof HTMLElement) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const targetTop =
      scrollContainer.scrollTop + (elementRect.top - containerRect.top) - HEADER_OFFSET;
    scrollContainer.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
    return;
  }

  const targetTop = window.scrollY + element.getBoundingClientRect().top - HEADER_OFFSET;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
}

const IDENTITY_NODE_TYPES = new Set<string>(BLOCK_IDENTITY_NODE_TYPES);
const CHANGE_EMIT_DELAY_MS = 80;

function jsonContainsIdentityNode(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some(jsonContainsIdentityNode);
  }

  const node = value as Record<string, unknown>;
  if (typeof node.type === "string" && IDENTITY_NODE_TYPES.has(node.type)) {
    return true;
  }
  return jsonContainsIdentityNode(node.content);
}

function selectionNeedsIdentityPatch(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth);
    if (!IDENTITY_NODE_TYPES.has(node.type.name)) continue;
    const identity = readIdentityFromAttrs(node.attrs);
    if (!identity.clientId) return true;
  }
  return false;
}

function transactionMayNeedIdentityPatch(
  editor: Editor,
  transaction: import("@tiptap/pm/state").Transaction,
): boolean {
  if (!transaction.docChanged) return false;
  if (selectionNeedsIdentityPatch(editor)) return true;
  if (transaction.before.childCount !== editor.state.doc.childCount) return true;
  return transaction.steps.some((step) => {
    const json = step.toJSON() as Record<string, unknown>;
    return jsonContainsIdentityNode(json.slice);
  });
}

function addNodeIdentityToSets(
  node: { attrs?: Record<string, unknown> },
  clientIds: Set<string>,
  blockIds: Set<string>,
): void {
  const identity = readIdentityFromAttrs(node.attrs);
  if (identity.clientId) clientIds.add(identity.clientId);
  if (identity.blockId) blockIds.add(identity.blockId);
}

function collectTopLevelSyncIdentitiesInRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): {
  clientIds: Set<string>;
  blockIds: Set<string>;
  touchedCount: number;
} {
  const clientIds = new Set<string>();
  const blockIds = new Set<string>();
  let touchedCount = 0;
  const rangeFrom = Math.max(0, Math.min(from, to));
  const rangeTo = Math.max(rangeFrom, Math.max(from, to));

  doc.forEach((node, offset) => {
    if (!IDENTITY_NODE_TYPES.has(node.type.name)) return;

    const nodeStart = offset;
    const nodeEnd = offset + node.nodeSize;
    const overlaps =
      rangeFrom === rangeTo
        ? nodeStart <= rangeFrom && nodeEnd >= rangeFrom
        : nodeStart < rangeTo && nodeEnd > rangeFrom;
    if (!overlaps) return;

    touchedCount += 1;
    addNodeIdentityToSets(node, clientIds, blockIds);
  });

  return { clientIds, blockIds, touchedCount };
}

function collectSelectionSyncIdentity(editor: Editor): {
  clientIds: string[];
  blockIds: string[];
} {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth);
    if (!IDENTITY_NODE_TYPES.has(node.type.name)) continue;
    const identity = readIdentityFromAttrs(node.attrs);
    return {
      clientIds: identity.clientId ? [identity.clientId] : [],
      blockIds: identity.blockId ? [identity.blockId] : [],
    };
  }
  return { clientIds: [], blockIds: [] };
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function mergeSyncDiffHints(
  left: SyncDiffHint | null,
  right: SyncDiffHint | null,
): SyncDiffHint | null {
  if (!left) return right;
  if (!right) return left;
  return {
    source: "editor-transaction",
    changedClientIds: uniqueValues([
      ...left.changedClientIds,
      ...right.changedClientIds,
    ]),
    changedBlockIds: uniqueValues([
      ...left.changedBlockIds,
      ...right.changedBlockIds,
    ]),
    structureChanged: left.structureChanged || right.structureChanged,
    identityChanged: left.identityChanged || right.identityChanged,
    reason: uniqueValues(
      [left.reason, right.reason].filter((value): value is string =>
        Boolean(value),
      ),
    ).join("+"),
  };
}

function deriveTransactionSyncDiffHint(
  editor: Editor,
  transaction: import("@tiptap/pm/state").Transaction,
  identityChanged: boolean,
): SyncDiffHint | null {
  if (!transaction.docChanged) return null;

  const changedClientIds = new Set<string>();
  const changedBlockIds = new Set<string>();
  let touchedBefore = 0;
  let touchedAfter = 0;

  transaction.mapping.maps.forEach((map) => {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      const before = collectTopLevelSyncIdentitiesInRange(
        transaction.before,
        oldStart,
        oldEnd,
      );
      const after = collectTopLevelSyncIdentitiesInRange(
        editor.state.doc,
        newStart,
        newEnd,
      );

      touchedBefore += before.touchedCount;
      touchedAfter += after.touchedCount;
      before.clientIds.forEach((id) => changedClientIds.add(id));
      after.clientIds.forEach((id) => changedClientIds.add(id));
      before.blockIds.forEach((id) => changedBlockIds.add(id));
      after.blockIds.forEach((id) => changedBlockIds.add(id));
    });
  });

  if (changedClientIds.size === 0 && changedBlockIds.size === 0) {
    const selection = collectSelectionSyncIdentity(editor);
    selection.clientIds.forEach((id) => changedClientIds.add(id));
    selection.blockIds.forEach((id) => changedBlockIds.add(id));
  }

  const hasIdentity = changedClientIds.size > 0 || changedBlockIds.size > 0;
  const structureChanged =
    identityChanged ||
    transaction.before.childCount !== editor.state.doc.childCount ||
    touchedBefore > 1 ||
    touchedAfter > 1;

  return {
    source: "editor-transaction",
    changedClientIds: uniqueValues([...changedClientIds]),
    changedBlockIds: uniqueValues([...changedBlockIds]),
    structureChanged: hasIdentity ? structureChanged : true,
    identityChanged: identityChanged || !hasIdentity,
    reason: hasIdentity
      ? structureChanged
        ? "structure-change"
        : "content-change"
      : "unknown-range",
  };
}

const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(function MarkdownEditor({
  content = "",
  onChange,
  editable = true,
  placeholder = "开始记录你的知识吧…",
  theme: themeProp,
  showToolbar = true,
  toolbarItemIds,
  floatingToolbarEnabled = false,
  floatingToolbarItemIds = [],
  floatingToolbarDelayMs = 180,
  showTOC = false,
  onTOCToggle,
  className,
  style,
  minHeight = "460px",
  autofocus = false,
  loading = false,
  defaultFontSize = 15,
  contentWidth = 750,
  title = "",
  showTitle = true,
  onTitleChange,
  onUploadImage,
}, ref) {
  const [systemThemeMode, setSystemThemeMode] = useState<CodeThemeMode>("light");
  const themeMode = themeProp ?? systemThemeMode;
  const [shikiHighlighter, setShikiHighlighter] = useState<ShikiHighlighter | null>(null);
  const [shikiReady, setShikiReady] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleSavedRef = useRef(title);
  const lastEmittedContentRef = useRef<EditorContentType | null>(null);
  const emittedContentRefs = useRef<WeakSet<object>>(new WeakSet());
  const onChangeRef = useRef(onChange);
  const pendingChangeEditorRef = useRef<Editor | null>(null);
  const changeEmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIdentityPatchRef = useRef(false);
  const pendingSyncDiffHintRef = useRef<SyncDiffHint | null>(null);
  const floatingToolbarItemSet = useMemo(
    () => new Set(floatingToolbarItemIds),
    [floatingToolbarItemIds],
  );
  const toolbarItemSet = useMemo(
    () => (toolbarItemIds ? new Set(toolbarItemIds) : undefined),
    [toolbarItemIds],
  );

  const handleTitleBlur = useCallback(() => {
    const el = titleRef.current;
    if (!el) return;
    const next = el.textContent?.trim() ?? "";
    if (next !== titleSavedRef.current) {
      titleSavedRef.current = next;
      onTitleChange?.(next);
    }
  }, [onTitleChange]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const flushPendingChange = useCallback(() => {
    if (changeEmitTimerRef.current) {
      clearTimeout(changeEmitTimerRef.current);
      changeEmitTimerRef.current = null;
    }

    const ed = pendingChangeEditorRef.current;
    pendingChangeEditorRef.current = null;
    const syncDiffHint = pendingSyncDiffHintRef.current;
    pendingSyncDiffHintRef.current = null;
    if (!ed) return;

    if (pendingIdentityPatchRef.current) {
      pendingIdentityPatchRef.current = false;
      patchEditorDocumentIdentity(ed);
    }

    const emitChange = onChangeRef.current;
    if (!emitChange) return;

    const nextContent = ed.getJSON() as EditorContentType;
    lastEmittedContentRef.current = nextContent;
    if (nextContent && typeof nextContent === "object") {
      emittedContentRefs.current.add(nextContent);
    }
    emitChange(nextContent, syncDiffHint ?? undefined);
  }, []);

  const schedulePendingChange = useCallback((ed: Editor) => {
    pendingChangeEditorRef.current = ed;
    if (changeEmitTimerRef.current) return;
    changeEmitTimerRef.current = setTimeout(flushPendingChange, CHANGE_EMIT_DELAY_MS);
  }, [flushPendingChange]);

  useEffect(() => {
    return () => {
      if (changeEmitTimerRef.current) {
        clearTimeout(changeEmitTimerRef.current);
        changeEmitTimerRef.current = null;
      }
      pendingSyncDiffHintRef.current = null;
    };
  }, []);

  // 主题检测
  useEffect(() => {
    if (themeProp) return;

    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = (matches: boolean) => {
      setSystemThemeMode(matches ? "dark" : "light");
    };

    applyTheme(media.matches);

    const onThemeChange = (event: MediaQueryListEvent) => {
      applyTheme(event.matches);
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onThemeChange);
      return () => media.removeEventListener("change", onThemeChange);
    }

    media.addListener(onThemeChange);
    return () => media.removeListener(onThemeChange);
  }, [themeProp]);

  // Shiki 高亮初始化
  useEffect(() => {
    let active = true;
    void getShikiHighlighter()
      .then((highlighter) => {
        if (!active) return;
        setShikiHighlighter(highlighter);
        setShikiReady(true);
      })
      .catch((error) => {
        if (!active) return;
        setShikiReady(true);
        const msg = error instanceof Error ? error.message : "Shiki 初始化失败";
        console.warn(`代码高亮初始化失败，将回退基础代码块：${msg}`);
      });

    return () => {
      active = false;
    };
  }, []);

  const codeBlockExtension = useMemo(() => {
    if (shikiHighlighter) {
      return createShikiCodeBlockExtension({
        highlighter: shikiHighlighter,
        getThemeMode: () => themeMode,
        defaultLanguage: DEFAULT_CODE_LANGUAGE,
      });
    }

    return CodeBlock.configure({
      defaultLanguage: DEFAULT_CODE_LANGUAGE,
      languageClassPrefix: "language-",
    });
  }, [shikiHighlighter, themeMode]);

  const handleUpdate = useCallback(
    ({
      editor: ed,
      transaction,
    }: {
      editor: import("@tiptap/core").Editor;
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      if (!onChangeRef.current || transaction.getMeta(BLOCK_IDENTITY_PATCH_META)) return;

      const needsIdentityPatch = transactionMayNeedIdentityPatch(
        ed as Editor,
        transaction,
      );
      if (needsIdentityPatch) {
        pendingIdentityPatchRef.current = true;
      }
      pendingSyncDiffHintRef.current = mergeSyncDiffHints(
        pendingSyncDiffHintRef.current,
        deriveTransactionSyncDiffHint(ed as Editor, transaction, needsIdentityPatch),
      );
      schedulePendingChange(ed as Editor);
    },
    [schedulePendingChange],
  );

  const handleUploadImageFile = useCallback(
    async (file: File) => {
      if (!onUploadImage) {
        throw new Error("未选择工作空间");
      }
      return onUploadImage(file);
    },
    [onUploadImage],
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          // 禁用内置行内格式扩展的 inputRule，统一由 markdownShortcuts 空格触发
          code: false,
          bold: false,
          italic: false,
          strike: false,
          horizontalRule: false,
          heading: {
            levels: [1, 2, 3, 4, 5, 6],
          },
          dropcursor: {
            width: 2,
            color: '#2563eb',
          },
        }),
        codeBlockExtension,
        // 行内格式扩展（禁用 inputRule，保留 mark/command 能力）
        // 排除 '_'（所有 mark）改为 ''（不排除），允许 TextStyle/Color/Highlight 与 code 共存
        Code.extend({ addInputRules: () => [], excludes: "" }),
        Bold.extend({ addInputRules: () => [] }),
        Italic.extend({ addInputRules: () => [] }),
        Strike.extend({ addInputRules: () => [] }),
        HorizontalRule.extend({ addInputRules: () => [] }),
        // 空格触发的 Markdown 快捷输入
        createMarkdownShortcutsExtension(),
        Placeholder.configure({
          placeholder,
        }),
        Underline,
        TaskList.configure({
          HTMLAttributes: {
            class: "task-list",
          },
        }),
        TaskItem.configure({
          nested: true,
        }).extend({
          addNodeView() {
            return ReactNodeViewRenderer(TaskItemView);
          },
        }),
        LinkExtension.configure(),
        TextStyle,
        ListTypography,
        Color,
        Highlight.configure({
          multicolor: true,
        }),
        TextAlign.configure({
          types: ["heading", "paragraph"],
        }),
        Table.configure({
          resizable: true,
          handleWidth: 5,
          cellMinWidth: 25,
          lastColumnResizable: true,
        }),
        TableRow,
        TableCell,
        TableHeader,
        TableIndexColumn,
        createPasteHandlerExtension({
          uploadImage: async (file) => {
            const image = await handleUploadImageFile(file);
            return {
              imageId: image.imageId,
              src: image.publicUrl || image.url,
              filename: image.filename,
              mimeType: image.mimeType,
              size: image.size,
              naturalWidth: image.width,
              naturalHeight: image.height,
              width: image.width,
              height: image.height,
              alt: image.filename,
            };
          },
        }),
        createFontSizeExtension(),
        OrderedListStyle,
        LineHeight.configure({
          types: ["paragraph", "heading"],
          defaultLineHeight: null,
        }),
        HighlightBlock.extend({
          addNodeView() {
            return ReactNodeViewRenderer(HighlightBlockView);
          },
        }),
        ImageBlock.extend({
          addNodeView() {
            return ReactNodeViewRenderer(ImageBlockView);
          },
        }),
        Indent.configure({
          types: ["paragraph", "heading"],
          maxLevel: 8,
        }),
        BlockIdAttribute,
        HeadingAnchor,
        MultiCursor,
      ],
      content: content || "<p></p>",
      immediatelyRender: false,
      autofocus,
      editable,
      editorProps: {
        attributes: {
          class: "tiptap-editor",
        },
      },
      onUpdate: handleUpdate,
    },
    [codeBlockExtension, handleUploadImageFile],
  );

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        editor?.commands.focus("start");
      }
    },
    [editor],
  );

  useEffect(() => {
    titleSavedRef.current = title;
    if (titleRef.current && titleRef.current.textContent !== title) {
      titleRef.current.textContent = title;
    }
  }, [title]);

  // 同步 themeMode 到代码高亮
  useEffect(() => {
    if (!editor || !shikiHighlighter) return;
    const tr = editor.state.tr.setMeta(SHIKI_CODE_BLOCK_PLUGIN_KEY, true);
    editor.view.dispatch(tr);
  }, [editor, shikiHighlighter, themeMode]);

  // 同步 editable
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  // 同步外部 content 变化
  useEffect(() => {
    if (!editor || !editor.schema) return;
    if (content === lastEmittedContentRef.current) return;
    if (content && typeof content === "object" && emittedContentRefs.current.has(content)) return;

    if (typeof content === "string") {
      // HTML 字符串模式（旧文档回退）
      const current = editor.getHTML();
      const normalizedCurrent = current === "<p></p>" ? "" : current;
      const normalizedContent = content || "";
      if (normalizedCurrent === normalizedContent) return;
      editor.commands.setContent(content || "<p></p>", { emitUpdate: false });
    } else if (content && typeof content === "object") {
      // Tiptap JSON 模式（新文档）
      if (patchEditorBlockIdentityFromMatchingDoc(editor, content)) return;
      const editorContent = stripUnsupportedSyncAttrs(content) as EditorContentType;
      // 避免重复设置相同内容导致光标重置：先比较文档子节点数，再比较 JSON
      const currentJSON = stripUnsupportedSyncAttrs(editor.getJSON()) as Record<string, unknown>;
      const currentChildren = currentJSON.content ?? [];
      const newChildren = (editorContent as unknown as Record<string, unknown>).content ?? [];
      if (
        Array.isArray(currentChildren) &&
        Array.isArray(newChildren) &&
        currentChildren.length === newChildren.length &&
        JSON.stringify(currentChildren) === JSON.stringify(newChildren)
      ) {
        return;
      }
      editor.commands.setContent(editorContent, { emitUpdate: false });
    }
  }, [content, editor]);

  // 暴露编辑器 API
  useImperativeHandle(ref, () => ({
    getJSON: () => editor?.getJSON() ?? {},
    getHTML: () => editor?.getHTML() ?? "",
    getText: () => editor?.getText() ?? "",
    getEditor: () => editor,
    patchBlockIdentityFromDoc: (doc: TiptapDoc) =>
      editor ? patchEditorBlockIdentityFromDoc(editor, doc) : false,
    scrollToBlock: (blockId: string) => {
      if (!editor) return false;
      let el = editor.view.dom.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null;
      if (!el) {
        el = editor.view.dom.querySelector(`[data-anchor="${blockId}"]`) as HTMLElement | null;
      }
      if (!el) return false;
      scrollElementIntoEditorView(el);
      return true;
    },
    getSelectionBlockPosition: () => {
      if (!editor) return null;
      return readSelectionBlockPosition(editor);
    },
    getViewportBlockPosition: () => {
      if (!editor) return null;
      return readViewportBlockPosition(editor);
    },
  }), [editor]);

  if (!editor || !shikiReady) {
    return (
      <div className="tiptap-shell" style={style}>
        <div className="tiptap-card" style={{ minHeight }}>
          <EditorLoader variant="inline" label="Initializing editor" />
        </div>
      </div>
    );
  }

  return (
    <div className={`tiptap-shell ${className || ""}`} style={style}>
      <div className="tiptap-card" data-code-theme={themeMode}>
        <EditorContextProvider
          value={{
            editor,
            defaultFontSize: `${defaultFontSize}px`,
            uploadImage: onUploadImage ?? null,
          }}
        >
          {showToolbar && <Toolbar enabledItemIds={toolbarItemSet} />}
          {editable && floatingToolbarEnabled && (
            <FloatingSelectionToolbar
              enabledItemIds={floatingToolbarItemSet}
              delayMs={floatingToolbarDelayMs}
            />
          )}
          <div
            ref={wrapperRef}
            className="tiptap-editor-wrapper"
            style={{
              minHeight,
              position: "relative",
              maxWidth: `${contentWidth}px`,
            }}
          >
            {!loading && editable && showTitle && (
              <h1
                ref={titleRef}
                className="doc-title-input"
                contentEditable
                suppressContentEditableWarning
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                dangerouslySetInnerHTML={{ __html: title }}
              />
            )}
            {loading ? (
              <EditorSkeleton />
            ) : (
              <>
              <EditorContent editor={editor} />
              {editable && <TableInteractions wrapperRef={wrapperRef} />}
              {editable && <BlockToolbar wrapperRef={wrapperRef} />}
              {editable && <LinkToolbar editor={editor} />}
            </>
          )}
          </div>
          {showTOC && <TableOfContents onClose={() => onTOCToggle?.(false)} />}
        </EditorContextProvider>
      </div>
    </div>
  );
});

export default MarkdownEditor;

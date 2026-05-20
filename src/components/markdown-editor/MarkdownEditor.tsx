import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { EditorContent as EditorContentType } from "@/services/document";
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
import Link from "@tiptap/extension-link";
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
import { OrderedListStyle } from "./extensions/orderedListStyle";
import { LineHeight } from "./extensions/lineHeight";
import { createMarkdownShortcutsExtension } from "./extensions/markdownShortcuts";
import { HighlightBlock } from "./extensions/highlightBlock";
import HighlightBlockView from "./HighlightBlockView";
import { Indent } from "./extensions/indent";
import { BlockIdAttribute } from "./extensions/blockIdAttribute";
import TaskItemView from "./TaskItemView";
import { EditorContextProvider } from "./EditorContext";
import Toolbar from "./Toolbar";
import BlockToolbar from "./BlockToolbar";
import TableOfContents from "./TableOfContents";
import {
  BLOCK_IDENTITY_PATCH_META,
  patchEditorBlockIdentityFromDoc,
  patchEditorDocumentIdentity,
} from "./editorIdentity";
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
}

export interface MarkdownEditorProps {
  /** 内容（HTML 字符串或 Tiptap JSON） */
  content?: EditorContentType;
  /** 内容变化回调（输出 Tiptap JSON） */
  onChange?: (content: EditorContentType) => void;
  /** 是否可编辑，默认 true */
  editable?: boolean;
  /** 占位文字 */
  placeholder?: string;
  /** 代码块主题，默认跟随系统 */
  theme?: "light" | "dark";
  /** 是否显示工具栏，默认 true */
  showToolbar?: boolean;
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
}

function EditorSkeleton() {
  return (
    <div className="skeleton-container" style={{ margin: 0, boxShadow: "none", width: "100%" }}>
      <div className="skeleton-item skeleton-title" />
      <div className="skeleton-item skeleton-text" />
      <div className="skeleton-item skeleton-text-mid" />
      <div className="skeleton-item skeleton-text" />
      <div className="skeleton-item skeleton-text-short" />
      <div className="skeleton-item skeleton-text" style={{ marginTop: 40 }} />
      <div className="skeleton-item skeleton-text-mid" />
      <div className="skeleton-item skeleton-text" />
    </div>
  );
}

const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(function MarkdownEditor({
  content = "",
  onChange,
  editable = true,
  placeholder = "开始记录你的知识吧…",
  theme: themeProp,
  showToolbar = true,
  showTOC = false,
  onTOCToggle,
  className,
  style,
  minHeight = "460px",
  autofocus = false,
  loading = false,
}, ref) {
  const [systemThemeMode, setSystemThemeMode] = useState<CodeThemeMode>("light");
  const themeMode = themeProp ?? systemThemeMode;
  const [shikiHighlighter, setShikiHighlighter] = useState<ShikiHighlighter | null>(null);
  const [shikiReady, setShikiReady] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

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
      if (!onChange || transaction.getMeta(BLOCK_IDENTITY_PATCH_META)) return;

      patchEditorDocumentIdentity(ed);
      onChange(ed.getJSON() as EditorContentType);
    },
    [onChange],
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
        Link.configure({
          openOnClick: false,
          HTMLAttributes: {
            class: "tiptap-link",
          },
        }),
        TextStyle,
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
        createPasteHandlerExtension(),
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
        Indent.configure({
          types: ["paragraph", "heading"],
          maxLevel: 8,
        }),
        BlockIdAttribute,
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
    [codeBlockExtension],
  );

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

    if (typeof content === "string") {
      // HTML 字符串模式（旧文档回退）
      const current = editor.getHTML();
      const normalizedCurrent = current === "<p></p>" ? "" : current;
      const normalizedContent = content || "";
      if (normalizedCurrent === normalizedContent) return;
      editor.commands.setContent(content || "<p></p>", { emitUpdate: false });
    } else if (content && typeof content === "object") {
      // Tiptap JSON 模式（新文档）
      if (patchEditorBlockIdentityFromDoc(editor, content)) return;
      // 避免重复设置相同内容导致光标重置：先比较文档子节点数，再比较 JSON
      const currentJSON = editor.getJSON();
      const currentChildren = currentJSON.content ?? [];
      const newChildren = (content as unknown as Record<string, unknown>).content ?? [];
      if (
        Array.isArray(currentChildren) &&
        Array.isArray(newChildren) &&
        currentChildren.length === newChildren.length &&
        JSON.stringify(currentChildren) === JSON.stringify(newChildren)
      ) {
        return;
      }
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  // 暴露编辑器 API
  useImperativeHandle(ref, () => ({
    getJSON: () => editor?.getJSON() ?? {},
    getHTML: () => editor?.getHTML() ?? "",
    getText: () => editor?.getText() ?? "",
    getEditor: () => editor,
  }), [editor]);

  if (!editor || !shikiReady) {
    return (
      <div className="tiptap-shell" style={style}>
        <div className="tiptap-card" style={{ position: "relative", minHeight }}>
          <div className="editor-init-mask">
            <div className="init-loader" />
            <div className="init-text">正在初始化编辑器与高亮引擎...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`tiptap-shell ${className || ""}`} style={style}>
      <div className="tiptap-card" data-code-theme={themeMode}>
        <EditorContextProvider value={{ editor }}>
          {showToolbar && <Toolbar />}
          <div ref={wrapperRef} className="tiptap-editor-wrapper" style={{ minHeight, position: "relative" }}>
            {loading ? (
              <EditorSkeleton />
            ) : (
              <>
                <EditorContent editor={editor} />
                {editable && <BlockToolbar wrapperRef={wrapperRef} />}
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

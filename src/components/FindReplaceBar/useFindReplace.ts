import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as ProseMirrorNode } from "prosemirror-model";

/** 单个匹配结果 */
export interface FindMatch {
  from: number;
  to: number;
  text: string;
  /** 所在块的类型标签，如 "正文"、"代码块"、"表格" */
  blockLabel: string;
}

/** hook 选项 */
interface UseFindReplaceOptions {
  editor: Editor | null;
  /** 普通匹配高亮色 */
  highlightColor?: string;
  /** 当前激活匹配高亮色 */
  activeHighlightColor?: string;
}

/** 转义正则特殊字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 判断块类型标签 */
function getBlockLabel(node: ProseMirrorNode): string {
  const type = node.type.name;
  switch (type) {
    case "codeBlock":
      return "代码块";
    case "table":
      return "表格";
    case "blockquote":
      return "引用";
    case "heading": {
      const level = node.attrs.level;
      return `标题 ${level}`;
    }
    case "taskList":
      return "任务列表";
    case "bulletList":
      return "无序列表";
    case "orderedList":
      return "有序列表";
    case "imageBlock":
      return "图片";
    case "horizontalRule":
      return "分割线";
    case "highlightBlock":
      return "高亮块";
    default:
      return "正文";
  }
}

/** 在 doc 中查找所有匹配 */
function collectMatches(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
): FindMatch[] {
  if (!query) return [];
  const matches: FindMatch[] = [];
  const flags = caseSensitive ? "g" : "gi";
  let re: RegExp;
  try {
    re = new RegExp(escapeRegExp(query), flags);
  } catch {
    return [];
  }

  // 构建 pos → 所属顶层块的映射
  const blockRanges: Array<{ from: number; to: number; label: string }> = [];
  doc.forEach((node, offset) => {
    blockRanges.push({
      from: offset,
      to: offset + node.nodeSize,
      label: getBlockLabel(node),
    });
  });

  /** 根据 pos 找到所属块标签 */
  const findBlockLabel = (pos: number): string => {
    for (const br of blockRanges) {
      if (pos >= br.from && pos < br.to) return br.label;
    }
    return "正文";
  };

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node.text)) !== null) {
      const matchFrom = pos + m.index;
      matches.push({
        from: matchFrom,
        to: matchFrom + m[0].length,
        text: m[0],
        blockLabel: findBlockLabel(matchFrom),
      });
      if (m[0].length === 0) break;
    }
  });
  return matches;
}

/** 构建 DecorationSet */
function buildDecorations(
  doc: ProseMirrorNode,
  matches: FindMatch[],
  currentIndex: number,
  highlightColor: string,
  activeHighlightColor: string,
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = matches.map((m, i) => {
    const color = i === currentIndex ? activeHighlightColor : highlightColor;
    return Decoration.inline(m.from, m.to, {
      style: `background-color: ${color}; border-radius: 2px;`,
      class: i === currentIndex ? "find-match find-match--active" : "find-match",
    });
  });
  return DecorationSet.create(doc, decos);
}

/** ProseMirror plugin key */
const FIND_REPLACE_KEY = new PluginKey("findReplace");

/** 创建搜索高亮 plugin */
function createFindReplacePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: FIND_REPLACE_KEY,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(FIND_REPLACE_KEY);
        if (meta?.decorations) return meta.decorations;
        if (tr.docChanged) return old.map(tr.mapping, tr.doc);
        return old;
      },
    },
    props: {
      decorations(state) {
        return FIND_REPLACE_KEY.getState(state);
      },
    },
  });
}

function getPluginKeyName(key: PluginKey | undefined): string | undefined {
  return (key as unknown as { key?: string } | undefined)?.key;
}

function hasFindReplacePlugin(editor: Editor): boolean {
  const findReplaceKeyName = getPluginKeyName(FIND_REPLACE_KEY);
  return editor.state.plugins.some((plugin) => {
    const key = plugin.spec.key;
    return key === FIND_REPLACE_KEY || getPluginKeyName(key) === findReplaceKeyName;
  });
}

export function useFindReplace({
  editor,
  highlightColor = "#fff3a8",
  activeHighlightColor = "#ff9833",
}: UseFindReplaceOptions) {
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const registeredEditorRef = useRef<Editor | null>(null);
  const colorsRef = useRef({ highlightColor, activeHighlightColor });

  useEffect(() => {
    colorsRef.current = { highlightColor, activeHighlightColor };
  }, [highlightColor, activeHighlightColor]);

  // ── 注册 plugin ──
  useEffect(() => {
    if (!editor) return;
    if (registeredEditorRef.current === editor) return;
    registeredEditorRef.current = editor;

    if (hasFindReplacePlugin(editor)) {
      return () => {
        registeredEditorRef.current = null;
      };
    }

    const plugin = createFindReplacePlugin();
    editor.registerPlugin(plugin);

    return () => {
      try {
        editor.unregisterPlugin(FIND_REPLACE_KEY);
      } catch {
        // ignore
      }
      registeredEditorRef.current = null;
    };
  }, [editor]);

  // ── 执行搜索并更新 decorations ──
  const doSearch = useCallback(
    (q: string, cs: boolean, keepIndex?: number) => {
      if (!editor) return;
      const view = editor.view;
      const doc = view.state.doc;
      const { highlightColor: hl, activeHighlightColor: ahl } =
        colorsRef.current;

      const newMatches = collectMatches(doc, q, cs);
      setMatches(newMatches);

      let newIndex = -1;
      if (newMatches.length > 0) {
        if (keepIndex !== undefined && keepIndex >= 0) {
          newIndex = keepIndex < newMatches.length ? keepIndex : 0;
        } else {
          newIndex = 0;
        }
      }
      setCurrentIndex(newIndex);

      const decos = buildDecorations(doc, newMatches, newIndex, hl, ahl);
      const tr = view.state.tr.setMeta(FIND_REPLACE_KEY, { decorations: decos });
      view.dispatch(tr);
    },
    [editor],
  );

  // ── query / caseSensitive 变化时重新搜索 ──
  useEffect(() => {
    doSearch(query, caseSensitive);
  }, [query, caseSensitive, editor]);

  // ── 文档内容变化时重新搜索（保持 currentIndex） ──
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      requestAnimationFrame(() => {
        doSearch(query, caseSensitive, currentIndex);
      });
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, query, caseSensitive, currentIndex, doSearch]);

  // ── 滚动到当前匹配 ──
  const scrollToMatch = useCallback(
    (index: number) => {
      if (!editor || index < 0 || index >= matches.length) return;
      const match = matches[index];
      const view = editor.view;
      try {
        const sel = TextSelection.create(view.state.doc, match.from, match.to);
        view.dispatch(view.state.tr.setSelection(sel));
      } catch {
        // pos 可能越界
      }
      try {
        const domInfo = view.domAtPos(match.from);
        const el =
          domInfo.node instanceof HTMLElement
            ? domInfo.node
            : domInfo.node.parentElement;
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        // ignore
      }
    },
    [editor, matches],
  );

  // ── currentIndex 变化时更新高亮 + 滚动 ──
  useEffect(() => {
    if (!editor || currentIndex < 0 || currentIndex >= matches.length) return;
    const { highlightColor: hl, activeHighlightColor: ahl } = colorsRef.current;
    const doc = editor.view.state.doc;
    const decos = buildDecorations(doc, matches, currentIndex, hl, ahl);
    const tr = editor.view.state.tr.setMeta(FIND_REPLACE_KEY, { decorations: decos });
    editor.view.dispatch(tr);
    scrollToMatch(currentIndex);
  }, [currentIndex]);

  // ── 导航 ──
  const goToNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  const goToPrev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const goToIndex = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  // ── 替换当前匹配 ──
  const replaceCurrent = useCallback(() => {
    if (!editor || currentIndex < 0 || currentIndex >= matches.length) return;
    const match = matches[currentIndex];
    const { tr } = editor.view.state;
    tr.insertText(replaceText, match.from, match.to);
    editor.view.dispatch(tr);
  }, [editor, currentIndex, matches, replaceText]);

  // ── 全部替换 ──
  const replaceAll = useCallback(() => {
    if (!editor || matches.length === 0) return;
    const { tr } = editor.view.state;
    for (let i = matches.length - 1; i >= 0; i--) {
      tr.insertText(replaceText, matches[i].from, matches[i].to);
    }
    editor.view.dispatch(tr);
  }, [editor, matches, replaceText]);

  // ── 清除高亮 ──
  const clearDecorations = useCallback(() => {
    if (!editor) return;
    const tr = editor.view.state.tr.setMeta(FIND_REPLACE_KEY, {
      decorations: DecorationSet.empty,
    });
    editor.view.dispatch(tr);
    setMatches([]);
    setCurrentIndex(-1);
  }, [editor]);

  // ── 重置所有状态 ──
  const reset = useCallback(() => {
    setQuery("");
    setReplaceText("");
    setCaseSensitive(false);
    clearDecorations();
  }, [clearDecorations]);

  return {
    query,
    setQuery,
    replaceText,
    setReplaceText,
    caseSensitive,
    setCaseSensitive,
    matches,
    matchCount: matches.length,
    currentIndex,
    goToNext,
    goToPrev,
    goToIndex,
    replaceCurrent,
    replaceAll,
    clearDecorations,
    reset,
  };
}

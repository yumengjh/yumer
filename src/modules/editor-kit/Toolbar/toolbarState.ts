import type { Editor } from "@tiptap/core";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

export type TextAlignValue = "left" | "center" | "right" | "justify";

export interface ToolbarState {
  marks: {
    bold: boolean;
    italic: boolean;
    strike: boolean;
    underline: boolean;
    code: boolean;
    link: boolean;
    highlight: boolean;
  };
  nodes: {
    bulletList: boolean;
    orderedList: boolean;
    taskList: boolean;
    blockquote: boolean;
    codeBlock: boolean;
    horizontalRule: boolean;
    highlightBlock: boolean;
  };
  headingLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  textAlign: TextAlignValue;
  fontSize: string;
  lineHeight: string;
  orderedListType: string;
  codeLanguage: string;
}

interface ToolbarStateOptions {
  defaultFontSize?: string;
}

const EMPTY_STATE: ToolbarState = {
  marks: {
    bold: false,
    italic: false,
    strike: false,
    underline: false,
    code: false,
    link: false,
    highlight: false,
  },
  nodes: {
    bulletList: false,
    orderedList: false,
    taskList: false,
    blockquote: false,
    codeBlock: false,
    horizontalRule: false,
    highlightBlock: false,
  },
  headingLevel: 0,
  textAlign: "left",
  fontSize: "15px",
  lineHeight: "",
  orderedListType: "decimal",
  codeLanguage: "text",
};

function attrsInclude(
  actual: Record<string, unknown>,
  expected?: Record<string, unknown>,
): boolean {
  if (!expected) return true;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function markMatches(
  mark: Mark,
  markName: string,
  attrs?: Record<string, unknown>,
): boolean {
  return mark.type.name === markName && attrsInclude(mark.attrs, attrs);
}

function getCursorMarks(state: EditorState): readonly Mark[] {
  return state.storedMarks ?? state.selection.$from.marks();
}

export function selectionContainsMark(
  editor: Editor | null,
  markName: string,
  attrs?: Record<string, unknown>,
): boolean {
  if (!editor) return false;

  const { state } = editor;
  const { selection } = state;

  if (selection.empty) {
    return getCursorMarks(state).some((mark) => markMatches(mark, markName, attrs));
  }

  let found = false;
  const { from, to } = selection;

  state.doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (!node.isText) return;

    found = node.marks.some((mark) => markMatches(mark, markName, attrs));
    return !found;
  });

  return found;
}

function getAncestorNode(
  state: EditorState,
  names: readonly string[],
): ProseMirrorNode | null {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (names.includes(node.type.name)) {
      return node;
    }
  }

  return null;
}

function hasAncestorNode(state: EditorState, name: string): boolean {
  return Boolean(getAncestorNode(state, [name]));
}

function selectionContainsNode(editor: Editor, nodeName: string): boolean {
  const { state } = editor;

  if (hasAncestorNode(state, nodeName)) {
    return true;
  }

  if (state.selection.empty) {
    return false;
  }

  let found = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (found) return false;
    found = node.type.name === nodeName;
    return !found;
  });

  return found;
}

function getFirstMarkAttr(
  editor: Editor,
  markName: string,
  attrName: string,
): unknown {
  const { state } = editor;
  const { selection } = state;

  if (selection.empty) {
    return getCursorMarks(state).find((mark) => mark.type.name === markName)?.attrs[attrName];
  }

  let value: unknown;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (value !== undefined || !node.isText) return value === undefined;
    const mark = node.marks.find((item) => item.type.name === markName);
    value = mark?.attrs[attrName];
    return value === undefined;
  });

  return value;
}

function normalizeFontSize(value: unknown, fallback: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback;
  }
  const text = `${value}`;
  return text.endsWith("px") ? text : `${text}px`;
}

function normalizeTextAlign(value: unknown): TextAlignValue {
  if (value === "center" || value === "right" || value === "justify") {
    return value;
  }
  return "left";
}

export function getToolbarState(
  editor: Editor | null,
  options?: ToolbarStateOptions,
): ToolbarState {
  const defaultFontSize = options?.defaultFontSize ?? EMPTY_STATE.fontSize;

  if (!editor) {
    return {
      ...EMPTY_STATE,
      fontSize: defaultFontSize,
    };
  }

  const { state } = editor;
  const currentTextBlock = getAncestorNode(state, ["paragraph", "heading"]);
  const headingLevel =
    currentTextBlock?.type.name === "heading"
      ? (currentTextBlock.attrs.level as ToolbarState["headingLevel"])
      : 0;
  const orderedList = getAncestorNode(state, ["orderedList"]);
  const codeBlock = getAncestorNode(state, ["codeBlock"]);

  return {
    marks: {
      bold: selectionContainsMark(editor, "bold"),
      italic: selectionContainsMark(editor, "italic"),
      strike: selectionContainsMark(editor, "strike"),
      underline: selectionContainsMark(editor, "underline"),
      code: selectionContainsMark(editor, "code"),
      link: selectionContainsMark(editor, "link"),
      highlight: selectionContainsMark(editor, "highlight"),
    },
    nodes: {
      bulletList: selectionContainsNode(editor, "bulletList"),
      orderedList: selectionContainsNode(editor, "orderedList"),
      taskList: selectionContainsNode(editor, "taskList"),
      blockquote: selectionContainsNode(editor, "blockquote"),
      codeBlock: selectionContainsNode(editor, "codeBlock"),
      horizontalRule: selectionContainsNode(editor, "horizontalRule"),
      highlightBlock: selectionContainsNode(editor, "highlightBlock"),
    },
    headingLevel,
    textAlign: normalizeTextAlign(currentTextBlock?.attrs.textAlign),
    fontSize: normalizeFontSize(
      getFirstMarkAttr(editor, "textStyle", "fontSize"),
      defaultFontSize,
    ),
    lineHeight:
      typeof currentTextBlock?.attrs.lineHeight === "string"
        ? currentTextBlock.attrs.lineHeight
        : "",
    orderedListType:
      typeof orderedList?.attrs.listStyleType === "string"
        ? orderedList.attrs.listStyleType
        : "decimal",
    codeLanguage:
      typeof codeBlock?.attrs.language === "string" && codeBlock.attrs.language.trim()
        ? codeBlock.attrs.language.trim().toLowerCase()
        : "text",
  };
}

export function isToolbarItemActive(state: ToolbarState, id: string): boolean {
  switch (id) {
    case "bold":
      return state.marks.bold;
    case "italic":
      return state.marks.italic;
    case "strike":
      return state.marks.strike;
    case "underline":
      return state.marks.underline;
    case "align-left":
      return state.textAlign === "left";
    case "align-center":
      return state.textAlign === "center";
    case "align-right":
      return state.textAlign === "right";
    case "align-justify":
      return state.textAlign === "justify";
    case "bullet-list":
      return state.nodes.bulletList;
    case "check-list":
      return state.nodes.taskList;
    case "ordered-list":
      return state.nodes.orderedList;
    case "blockquote":
      return state.nodes.blockquote;
    case "code-block":
    case "code-language":
      return state.nodes.codeBlock;
    case "divider":
      return state.nodes.horizontalRule;
    case "link":
      return state.marks.link;
    case "highlight-block":
      return state.nodes.highlightBlock;
    default:
      return false;
  }
}

export function runInlineMarkCommand(
  editor: Editor | null,
  markName: "bold" | "italic" | "strike" | "underline" | "code",
): boolean {
  if (!editor) return false;

  if (selectionContainsMark(editor, markName)) {
    return editor.chain().focus().unsetMark(markName).run();
  }

  return editor.chain().focus().setMark(markName).run();
}

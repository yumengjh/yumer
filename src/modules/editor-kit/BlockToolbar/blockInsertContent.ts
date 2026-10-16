import type { JSONContent } from "@tiptap/core";
import type { BlockInsertType } from "./blockInsertMenuItems";

function paragraph(): JSONContent {
  return { type: "paragraph" };
}

function heading(level: 1 | 2 | 3): JSONContent {
  return { type: "heading", attrs: { level } };
}

function listItem(): JSONContent {
  return { type: "listItem", content: [paragraph()] };
}

function taskItem(): JSONContent {
  return {
    type: "taskItem",
    attrs: { checked: false },
    content: [paragraph()],
  };
}

function tableCell(type: "tableHeader" | "tableCell"): JSONContent {
  return { type, content: [paragraph()] };
}

function tableRow(header = false): JSONContent {
  return {
    type: "tableRow",
    content: [
      tableCell(header ? "tableHeader" : "tableCell"),
      tableCell(header ? "tableHeader" : "tableCell"),
      tableCell(header ? "tableHeader" : "tableCell"),
    ],
  };
}

/** 指定行列的表格（首行为表头） */
export function createTableContent(rows: number, cols: number): JSONContent {
  return {
    type: "table",
    content: Array.from({ length: rows }, (_, row) => ({
      type: "tableRow",
      content: Array.from({ length: cols }, () => tableCell(row === 0 ? "tableHeader" : "tableCell")),
    })),
  };
}

export function createBlockInsertContent(type: BlockInsertType): JSONContent {
  switch (type) {
    case "paragraph":
      return paragraph();
    case "heading1":
      return heading(1);
    case "heading2":
      return heading(2);
    case "heading3":
      return heading(3);
    case "heading4":
      return { type: "heading", attrs: { level: 4 } };
    case "heading5":
      return { type: "heading", attrs: { level: 5 } };
    case "heading6":
      return { type: "heading", attrs: { level: 6 } };
    case "bulletList":
      return { type: "bulletList", content: [listItem()] };
    case "orderedList":
      return { type: "orderedList", attrs: { start: 1 }, content: [listItem()] };
    case "taskList":
      return { type: "taskList", content: [taskItem()] };
    case "blockquote":
      return { type: "blockquote", content: [paragraph()] };
    case "codeBlock":
      return { type: "codeBlock", attrs: { language: "plaintext" } };
    case "link":
      return {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "链接",
            marks: [
              {
                type: "link",
                attrs: { href: "https://" },
              },
            ],
          },
        ],
      };
    case "divider":
      return { type: "horizontalRule" };
    case "table":
      return {
        type: "table",
        content: [tableRow(true), tableRow(), tableRow()],
      };
  }
}

/**
 * 执行插入面板（BlockInsertPanel）的卡片插入。
 * at 为空时在当前选区插入（工具栏「+」），否则插入到指定文档位置（块菜单「在下方添加」）。
 * 图片需要先上传，由调用方处理。
 */
export function runInsertCard(
  editor: import("@tiptap/core").Editor,
  id: Exclude<import("./BlockInsertPanel").InsertCardId, "image">,
  options?: { rows?: number; cols?: number },
  at?: number,
): boolean {
  const rows = options?.rows ?? 3;
  const cols = options?.cols ?? 3;
  const chain = editor.chain().focus();
  if (typeof at === "number") {
    switch (id) {
      case "table":
        return chain.insertContentAt(at, createTableContent(rows, cols)).run();
      case "codeBlock":
        return chain.insertContentAt(at, { type: "codeBlock", attrs: { language: "plaintext" } }).run();
      case "highlightBlock":
        return chain.insertContentAt(at, { type: "highlightBlock", content: [paragraph()] }).run();
      case "blockquote":
        return chain.insertContentAt(at, createBlockInsertContent("blockquote")).run();
      case "divider":
        return chain.insertContentAt(at, [{ type: "horizontalRule" }, paragraph()]).run();
    }
  }
  switch (id) {
    case "table":
      return chain.insertTable({ rows, cols, withHeaderRow: true }).run();
    case "codeBlock":
      return chain.setCodeBlock({ language: "plaintext" }).run();
    case "highlightBlock":
      return editor.state.selection.empty
        ? chain.insertHighlightBlock().run()
        : chain.toggleHighlightBlockFromSelection().run();
    case "blockquote":
      return chain.toggleBlockquote().run();
    case "divider":
      return chain.setHorizontalRule().run();
  }
  return false;
}

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

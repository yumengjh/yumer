/**
 * 序列化用 Tiptap extensions 列表
 * 与编辑器 MarkdownEditor.tsx 的 schema 保持一致
 * 用于 generateHTML（客户端/服务端）做 JSON → HTML 转换
 */
import StarterKit from "@tiptap/starter-kit";
import CodeBlock from "@tiptap/extension-code-block";
import Code from "@tiptap/extension-code";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
import Underline from "@tiptap/extension-underline";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import {
  BlockIdAttribute,
  createFontSizeExtension,
  HeadingAnchor,
  HighlightBlock,
  ImageBlock,
  Indent,
  LineHeight,
  OrderedListStyle,
} from "@/modules/editor-kit/shared";

export const serializationExtensions = [
  StarterKit.configure({
    codeBlock: false,
    code: false,
    bold: false,
    italic: false,
    strike: false,
    horizontalRule: false,
    link: false,
    underline: false,
    heading: { levels: [1, 2, 3, 4, 5, 6] },
  }),
  CodeBlock,
  Code.extend({ excludes: "" }),
  Bold,
  Italic,
  Strike,
  HorizontalRule,
  Underline,
  TaskList,
  TaskItem.configure({ nested: true }),
  Link.configure({ openOnClick: false }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  createFontSizeExtension(),
  OrderedListStyle,
  LineHeight.configure({ types: ["paragraph", "heading"], defaultLineHeight: null }),
  HighlightBlock,
  ImageBlock,
  Indent.configure({ types: ["paragraph", "heading"], maxLevel: 8 }),
  BlockIdAttribute,
  HeadingAnchor,
];

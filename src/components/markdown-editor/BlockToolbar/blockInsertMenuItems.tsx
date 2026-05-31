import {
  CheckSquareOutlined,
  CodeOutlined,
  FileTextOutlined,
  MessageOutlined,
  MinusOutlined,
  OrderedListOutlined,
  TableOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";

export type BlockInsertType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "link"
  | "divider"
  | "table";

export const BLOCK_INSERT_MENU_ITEMS: NonNullable<MenuProps["items"]> = [
  { key: "paragraph", icon: <FileTextOutlined />, label: "文本" },
  { key: "heading1", label: "标题 1" },
  { key: "heading2", label: "标题 2" },
  { key: "heading3", label: "标题 3" },
  { type: "divider" },
  { key: "bulletList", icon: <UnorderedListOutlined />, label: "无序列表" },
  { key: "orderedList", icon: <OrderedListOutlined />, label: "有序列表" },
  { key: "taskList", icon: <CheckSquareOutlined />, label: "代办列表" },
  { key: "blockquote", icon: <MessageOutlined />, label: "引用" },
  { key: "codeBlock", icon: <CodeOutlined />, label: "代码块" },
  { key: "divider", icon: <MinusOutlined />, label: "分割线" },
  { key: "table", icon: <TableOutlined />, label: "表格" },
];

export function getBlockInsertMenuKeys(items: NonNullable<MenuProps["items"]>): string[] {
  return items.flatMap((item) => {
    if (!item || !("key" in item) || typeof item.key !== "string") return [];
    return [item.key];
  });
}

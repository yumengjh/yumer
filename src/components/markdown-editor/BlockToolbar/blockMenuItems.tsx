import {
  DeleteOutlined,
  CopyOutlined,
  ScissorOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ClearOutlined,
  PlusCircleOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";

interface CreateBlockMenuItemsOptions {
  canMoveUp: boolean;
  canMoveDown: boolean;
  headingAnchorId: string | null;
}

export function getHeadingAnchorIdFromBlock(block: HTMLElement | null): string | null {
  if (!block || !/^H[1-6]$/.test(block.tagName)) return null;

  const dataAnchor = block.dataset.anchor?.trim();
  if (dataAnchor) return dataAnchor;

  const id = block.getAttribute("id")?.trim();
  return id || null;
}

export function createBlockMenuItems({
  canMoveUp,
  canMoveDown,
  headingAnchorId,
}: CreateBlockMenuItemsOptions): NonNullable<MenuProps["items"]> {
  const items: NonNullable<MenuProps["items"]> = [
    { key: "delete", icon: <DeleteOutlined />, label: "删除" },
    { key: "copy", icon: <CopyOutlined />, label: "复制" },
    { key: "cut", icon: <ScissorOutlined />, label: "剪切" },
  ];

  if (headingAnchorId) {
    items.push({ key: "copyAnchorLink", icon: <LinkOutlined />, label: "复制锚点链接" });
  }

  items.push(
    { type: "divider" },
    { key: "clear", icon: <ClearOutlined />, label: "清除格式" },
    { type: "divider" },
    { key: "addAbove", icon: <PlusCircleOutlined />, label: "在上方添加" },
    { key: "addBelow", icon: <PlusCircleOutlined />, label: "在下方添加" },
    { type: "divider" },
    { key: "moveUp", icon: <ArrowUpOutlined />, label: "上移", disabled: !canMoveUp },
    { key: "moveDown", icon: <ArrowDownOutlined />, label: "下移", disabled: !canMoveDown },
  );

  return items;
}

import { useCallback, useEffect, useState } from "react";
import {
  BorderOutlined,
  CheckSquareOutlined,
  ClearOutlined,
  ColumnWidthOutlined,
  CopyOutlined,
  DeleteOutlined,
  InsertRowAboveOutlined,
  InsertRowBelowOutlined,
  PlusOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { Menu, message } from "antd";
import type { MenuProps } from "antd";
import { useMarkdownEditor } from "./EditorContext";
import {
  clearSelectedTableCells,
  getCurrentTableDisplayState,
  deleteSelectedTableCells,
  insertIndexColumn,
  insertTableRelativeColumn,
  insertTableRelativeRow,
  mergeSelectedTableCells,
  pasteTableFromClipboard,
  setTableCellSelection,
  toggleTableDisplayFeature,
  writeTableToClipboard,
} from "./table/tableCommands";

interface TableInteractionsProps {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}

type TableMenuKey =
  | "copy"
  | "paste"
  | "row-before"
  | "row-after"
  | "col-before"
  | "col-after"
  | "index-col"
  | "delete-table"
  | "delete-row"
  | "delete-col"
  | "merge"
  | "clear"
  | "toggle-hide-outer-border"
  | "toggle-equal-width"
  | "toggle-header-row"
  | "toggle-header-column";

type TableDisplayState = {
  hideOuterBorder: boolean;
  equalWidth: boolean;
  headerRow: boolean;
  headerColumn: boolean;
};

export const TABLE_CONTEXT_MENU_WIDTH = 232;
export const TABLE_CONTEXT_MENU_MIN_HEIGHT = 336;

function getToggleLabel(label: string, enabled: boolean) {
  return `${label} · ${enabled ? "开" : "关"}`;
}

export function createTableMenuItems(displayState: TableDisplayState): MenuProps["items"] {
  return [
    { key: "copy", icon: <CopyOutlined />, label: "复制区域" },
    { key: "paste", icon: <CopyOutlined />, label: "粘贴表格" },
    { type: "divider" },
    { key: "row-before", icon: <InsertRowAboveOutlined />, label: "上方插行" },
    { key: "row-after", icon: <InsertRowBelowOutlined />, label: "下方插行" },
    { key: "col-before", icon: <PlusOutlined />, label: "左侧插列" },
    { key: "col-after", icon: <PlusOutlined />, label: "右侧插列" },
    { key: "index-col", icon: <PlusOutlined />, label: "插入序号列" },
    { type: "divider" },
    {
      key: "toggle-hide-outer-border",
      icon: <BorderOutlined />,
      label: getToggleLabel("隐藏外框", displayState.hideOuterBorder),
    },
    {
      key: "toggle-equal-width",
      icon: <ColumnWidthOutlined />,
      label: getToggleLabel("等宽排列", displayState.equalWidth),
    },
    {
      key: "toggle-header-row",
      icon: <TableOutlined />,
      label: getToggleLabel("标题行", displayState.headerRow),
    },
    {
      key: "toggle-header-column",
      icon: <CheckSquareOutlined />,
      label: getToggleLabel("标题列", displayState.headerColumn),
    },
    { type: "divider" },
    { key: "delete-table", icon: <DeleteOutlined />, danger: true, label: "删除表格" },
    { key: "delete-row", icon: <DeleteOutlined />, danger: true, label: "删除行" },
    { key: "delete-col", icon: <DeleteOutlined />, danger: true, label: "删除列" },
    { type: "divider" },
    { key: "merge", icon: <ClearOutlined />, label: "合并单元格" },
    { key: "clear", icon: <ClearOutlined />, label: "清空内容" },
  ];
}

export default function TableInteractions({ wrapperRef }: TableInteractionsProps) {
  const editor = useMarkdownEditor();
  const [menuState, setMenuState] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });

  const closeMenu = useCallback(() => {
    setMenuState((current) => ({ ...current, open: false }));
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !editor) return;

    const handleContextMenu = (event: MouseEvent) => {
      if (editor.isDestroyed) return;
      const target = event.target as Node | null;
      const element =
        target instanceof Element
          ? target
          : target instanceof Text
            ? target.parentElement
            : null;
      const cell = element?.closest("td,th") as HTMLTableCellElement | null;
      if (!cell || !wrapper.contains(cell)) return;

      event.preventDefault();
      void setTableCellSelection(editor, cell);
      setMenuState({ open: true, x: event.clientX, y: event.clientY });
    };

    document.addEventListener("contextmenu", handleContextMenu, true);
    return () => document.removeEventListener("contextmenu", handleContextMenu, true);
  }, [editor, wrapperRef]);

  useEffect(() => {
    if (!menuState.open) return;

    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".table-context-menu")) closeMenu();
    };

    const closeOnEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("keydown", closeOnEsc);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEsc);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [closeMenu, menuState.open]);

  const handleCopy = useCallback(async () => {
    if (!editor) return;
    const ok = await writeTableToClipboard(editor);
    message[ok ? "success" : "warning"](ok ? "已复制表格区域" : "复制失败");
  }, [editor]);

  const handlePaste = useCallback(async () => {
    if (!editor) return;
    const ok = await pasteTableFromClipboard(editor);
    message[ok ? "success" : "warning"](ok ? "已粘贴表格" : "粘贴失败");
    if (ok) closeMenu();
  }, [closeMenu, editor]);

  const handleClick = useCallback<NonNullable<MenuProps["onClick"]>>(async ({ key }) => {
    if (!editor || editor.isDestroyed) return;
    const action = key as TableMenuKey;
    let handled = true;

    switch (action) {
      case "copy":
        await handleCopy();
        break;
      case "paste":
        await handlePaste();
        break;
      case "row-before":
        handled = insertTableRelativeRow(editor, "before");
        break;
      case "row-after":
        handled = insertTableRelativeRow(editor, "after");
        break;
      case "col-before":
        handled = insertTableRelativeColumn(editor, "before");
        break;
      case "col-after":
        handled = insertTableRelativeColumn(editor, "after");
        break;
      case "index-col":
        handled = insertIndexColumn(editor);
        break;
      case "delete-table":
        handled = deleteSelectedTableCells(editor, "table");
        break;
      case "delete-row":
        handled = deleteSelectedTableCells(editor, "row");
        break;
      case "delete-col":
        handled = deleteSelectedTableCells(editor, "column");
        break;
      case "merge":
        handled = mergeSelectedTableCells(editor);
        break;
      case "clear":
        handled = clearSelectedTableCells(editor);
        break;
      case "toggle-hide-outer-border":
        handled = toggleTableDisplayFeature(editor, "hideOuterBorder");
        break;
      case "toggle-equal-width":
        handled = toggleTableDisplayFeature(editor, "equalWidth");
        break;
      case "toggle-header-row":
        handled = toggleTableDisplayFeature(editor, "headerRow");
        break;
      case "toggle-header-column":
        handled = toggleTableDisplayFeature(editor, "headerColumn");
        break;
      default:
        handled = false;
    }

    if (!handled) {
      message.warning("操作不可用");
    }
    closeMenu();
  }, [closeMenu, editor, handleCopy, handlePaste]);

  const displayState: TableDisplayState = getCurrentTableDisplayState(editor) ?? {
    hideOuterBorder: false,
    equalWidth: false,
    headerRow: false,
    headerColumn: false,
  };

  const items = createTableMenuItems(displayState);

  if (!menuState.open) return null;

  const width = typeof window === "undefined" ? TABLE_CONTEXT_MENU_WIDTH : window.innerWidth;
  const height = typeof window === "undefined" ? TABLE_CONTEXT_MENU_MIN_HEIGHT : window.innerHeight;
  const left = Math.max(8, Math.min(menuState.x, width - (TABLE_CONTEXT_MENU_WIDTH + 8)));
  const top = Math.max(8, Math.min(menuState.y, height - TABLE_CONTEXT_MENU_MIN_HEIGHT));

  return (
    <div
      className="table-context-menu"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 1300,
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Menu
        className="table-context-menu__panel"
        items={items}
        selectable={false}
        onClick={handleClick}
        style={{ width: TABLE_CONTEXT_MENU_WIDTH, borderRadius: 8 }}
      />
    </div>
  );
}

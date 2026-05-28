import { useCallback, useEffect, useMemo, useState } from "react";
import { ClearOutlined, CopyOutlined, DeleteOutlined, InsertRowAboveOutlined, InsertRowBelowOutlined, PlusOutlined } from "@ant-design/icons";
import { Menu, message } from "antd";
import type { MenuProps } from "antd";
import { useMarkdownEditor } from "./EditorContext";
import {
  clearSelectedTableCells,
  deleteSelectedTableCells,
  insertIndexColumn,
  insertTableRelativeColumn,
  insertTableRelativeRow,
  mergeSelectedTableCells,
  pasteTableFromClipboard,
  setTableCellSelection,
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
  | "clear";

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
    message[ok ? "success" : "warning"](ok ? "Table region copied" : "Copy failed");
  }, [editor]);

  const handlePaste = useCallback(async () => {
    if (!editor) return;
    const ok = await pasteTableFromClipboard(editor);
    message[ok ? "success" : "warning"](ok ? "Table pasted" : "Paste failed");
    if (ok) closeMenu();
  }, [closeMenu, editor]);

  const handleClick = useCallback<NonNullable<MenuProps["onClick"]>>(async ({ key }) => {
    if (!editor) return;
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
      default:
        handled = false;
    }

    if (!handled) {
      message.warning("Action unavailable");
    }
    closeMenu();
  }, [closeMenu, editor, handleCopy, handlePaste]);

  const items: MenuProps["items"] = useMemo(() => [
    { key: "copy", icon: <CopyOutlined />, label: "Copy table region" },
    { key: "paste", icon: <CopyOutlined />, label: "Paste table" },
    { type: "divider" },
    { key: "row-before", icon: <InsertRowAboveOutlined />, label: "Insert row above" },
    { key: "row-after", icon: <InsertRowBelowOutlined />, label: "Insert row below" },
    { key: "col-before", icon: <PlusOutlined />, label: "Insert column left" },
    { key: "col-after", icon: <PlusOutlined />, label: "Insert column right" },
    { key: "index-col", icon: <PlusOutlined />, label: "Insert index column" },
    { type: "divider" },
    { key: "delete-table", icon: <DeleteOutlined />, danger: true, label: "Delete table" },
    { key: "delete-row", icon: <DeleteOutlined />, danger: true, label: "Delete row" },
    { key: "delete-col", icon: <DeleteOutlined />, danger: true, label: "Delete column" },
    { type: "divider" },
    { key: "merge", icon: <ClearOutlined />, label: "Merge cells" },
    { key: "clear", icon: <ClearOutlined />, label: "Clear content" },
  ], []);

  if (!menuState.open) return null;

  const width = typeof window === "undefined" ? 280 : window.innerWidth;
  const height = typeof window === "undefined" ? 420 : window.innerHeight;
  const left = Math.max(8, Math.min(menuState.x, width - 288));
  const top = Math.max(8, Math.min(menuState.y, height - 420));

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
      <Menu items={items} selectable={false} onClick={handleClick} style={{ width: 280, borderRadius: 8 }} />
    </div>
  );
}

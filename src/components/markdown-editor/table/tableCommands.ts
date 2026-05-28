import { DOMParser as ProseMirrorDOMParser, type Node as ProseMirrorNode, type Slice } from "prosemirror-model";
import type { Editor } from "@tiptap/react";
import { CellSelection, TableMap, findTable, isInTable, selectedRect } from "@tiptap/pm/tables";
import {
  buildTableHtmlFromTextGrid,
  createClipboardPayloadFromGrid,
  extractFirstTableHtml,
  parseHtmlTableToGrid,
  parseTabularPlainText,
  serializeCellContent,
  type TableClipboardGrid,
  type TableClipboardPayload,
} from "./tableClipboard";

const INDEX_COLUMN_ATTR = "indexColumn";
const TABLE_DISPLAY_FEATURES = [
  "hideOuterBorder",
  "equalWidth",
  "headerRow",
  "headerColumn",
] as const;

export type TableDisplayFeature = (typeof TABLE_DISPLAY_FEATURES)[number];

function getEmptyParagraph(editor: Editor): ProseMirrorNode {
  return editor.state.schema.nodes.paragraph.create();
}

function getParagraphWithText(editor: Editor, text: string): ProseMirrorNode {
  const { schema } = editor.state;
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
}

function getTableCellNodeAt(editor: Editor, tableStart: number, cellPos: number): ProseMirrorNode | null {
  return editor.state.doc.nodeAt(tableStart + cellPos) ?? null;
}

function getTableRect(editor: Editor) {
  if (!isInTable(editor.state)) return null;
  return selectedRect(editor.state);
}

function isIndexedTable(tableNode: ProseMirrorNode): boolean {
  return tableNode.attrs?.[INDEX_COLUMN_ATTR] === true;
}

function isTableDisplayFeature(value: string): value is TableDisplayFeature {
  return TABLE_DISPLAY_FEATURES.includes(value as TableDisplayFeature);
}

function getTablePos(tableRect: ReturnType<typeof selectedRect>): number {
  return tableRect.tableStart - 1;
}

function updateTableAttrs(
  editor: Editor,
  tableRect: ReturnType<typeof selectedRect>,
  attrsPatch: Record<string, unknown>,
): boolean {
  const tr = editor.state.tr;
  tr.setNodeMarkup(getTablePos(tableRect), undefined, {
    ...tableRect.table.attrs,
    ...attrsPatch,
  });
  editor.view.dispatch(tr);
  return true;
}

function getUniqueCellsFromRect(editor: Editor, rect = getTableRect(editor)) {
  if (!rect) return null;

  const cells: Array<{
    row: number;
    col: number;
    cellPos: number;
    cellNode: ProseMirrorNode;
  }> = [];
  const seen = new Set<number>();

  for (let row = rect.top; row < rect.bottom; row += 1) {
    for (let col = rect.left; col < rect.right; col += 1) {
      const cellPos = rect.map.positionAt(row, col, rect.table);
      if (seen.has(cellPos)) continue;
      const cellNode = getTableCellNodeAt(editor, rect.tableStart, cellPos);
      if (!cellNode) continue;
      seen.add(cellPos);
      cells.push({ row, col, cellPos, cellNode });
    }
  }

  return { rect, cells };
}

function buildContentFromHtml(editor: Editor, html: string): Slice {
  const parser = ProseMirrorDOMParser.fromSchema(editor.state.schema);
  const parsed = new DOMParser().parseFromString(`<body>${html || "<p></p>"}</body>`, "text/html");
  return parser.parseSlice(parsed.body);
}

function getCellHtml(editor: Editor, cellNode: ProseMirrorNode): string {
  return serializeCellContent(editor.state.schema, cellNode, editor.view.dom.ownerDocument);
}

function applyIndexColumn(editor: Editor, tableRect: ReturnType<typeof selectedRect>): boolean {
  const tableMap = TableMap.get(tableRect.table);
  const tr = editor.state.tr;

  tr.setNodeMarkup(getTablePos(tableRect), undefined, { ...tableRect.table.attrs, [INDEX_COLUMN_ATTR]: true });

  const replacements: Array<{ from: number; to: number; text: string }> = [];

  for (let row = 0; row < tableMap.height; row += 1) {
    const cellPos = tableMap.positionAt(row, 0, tableRect.table);
    const cellNode = getTableCellNodeAt(editor, tableRect.tableStart, cellPos);
    if (!cellNode) continue;

    replacements.push({
      from: tableRect.tableStart + cellPos + 1,
      to: tableRect.tableStart + cellPos + cellNode.nodeSize - 1,
      text: row === 0 ? "" : String(row),
    });
  }

  replacements
    .sort((a, b) => b.from - a.from)
    .forEach(({ from, to, text }) => {
      tr.replaceWith(from, to, getParagraphWithText(editor, text));
    });

  editor.view.dispatch(tr);
  return true;
}

function renumberIndexedTable(editor: Editor): boolean {
  const rect = getTableRect(editor);
  if (!rect || !isIndexedTable(rect.table)) return false;
  return applyIndexColumn(editor, rect);
}

function runWithIndexedTableMaintenance(editor: Editor, command: () => boolean): boolean {
  const rectBefore = getTableRect(editor);
  const shouldMaintain = rectBefore ? isIndexedTable(rectBefore.table) : false;
  const handled = command();
  if (!handled || !shouldMaintain) return handled;
  renumberIndexedTable(editor);
  return true;
}

export function setTableCellSelection(editor: Editor, cell: HTMLTableCellElement): boolean {
  try {
    if (editor.isDestroyed) return false;
    const pos = editor.view.posAtDOM(cell, 0);
    return editor.chain().focus().setCellSelection({ anchorCell: pos }).run();
  } catch {
    return false;
  }
}

export function getCurrentTableDisplayState(editor: Editor): Record<TableDisplayFeature, boolean> | null {
  const rect = getTableRect(editor);
  if (!rect) return null;

  return {
    hideOuterBorder: rect.table.attrs.hideOuterBorder === true,
    equalWidth: rect.table.attrs.equalWidth === true,
    headerRow: rect.table.attrs.headerRow === true,
    headerColumn: rect.table.attrs.headerColumn === true,
  };
}

export function toggleTableDisplayFeature(editor: Editor, feature: TableDisplayFeature): boolean {
  const rect = getTableRect(editor);
  if (!rect || !isTableDisplayFeature(feature)) return false;
  const currentValue = rect.table.attrs?.[feature] === true;
  return updateTableAttrs(editor, rect, { [feature]: !currentValue });
}

export function copySelectedTableRegion(editor: Editor): TableClipboardPayload | null {
  const selection = getUniqueCellsFromRect(editor);
  if (!selection) return null;

  const { rect, cells } = selection;
  const grid: TableClipboardGrid = {
    rows: Array.from({ length: rect.bottom - rect.top }, () =>
      Array.from({ length: rect.right - rect.left }, () => ({
        tag: "td" as const,
        html: "<p></p>",
        text: "",
        colspan: 1,
        rowspan: 1,
        align: null,
      })),
    ),
  };

  for (const cell of cells) {
    const tableCell = cell.cellNode.type.name === "tableHeader" ? "th" : "td";
    const clippedRowspan = Math.max(1, Math.min(cell.cellNode.attrs.rowspan ?? 1, rect.bottom - cell.row));
    const clippedColspan = Math.max(1, Math.min(cell.cellNode.attrs.colspan ?? 1, rect.right - cell.col));
    grid.rows[cell.row - rect.top][cell.col - rect.left] = {
      tag: tableCell,
      html: getCellHtml(editor, cell.cellNode),
      text: cell.cellNode.textContent || "",
      colspan: clippedColspan,
      rowspan: clippedRowspan,
      align: cell.cellNode.attrs.align ?? null,
    };
  }

  return createClipboardPayloadFromGrid(grid);
}

export async function writeTableToClipboard(editor: Editor): Promise<boolean> {
  const payload = copySelectedTableRegion(editor);
  if (!payload) return false;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([payload.html], { type: "text/html" }),
        "text/plain": new Blob([payload.text], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(payload.text);
      return true;
    } catch {
      return false;
    }
  }
}

export function insertIndexColumn(editor: Editor): boolean {
  const rect = getTableRect(editor);
  if (!rect) return false;

  const firstCellPos = rect.map.positionAt(rect.top, rect.left, rect.table);
  editor.view.dispatch(
    editor.state.tr.setSelection(CellSelection.create(editor.state.doc, rect.tableStart + firstCellPos)),
  );

  const added = editor.chain().focus().addColumnBefore().run();
  if (!added) return false;

  const currentRect = getTableRect(editor);
  if (!currentRect) return false;
  return applyIndexColumn(editor, currentRect);
}

export function clearSelectedTableCells(editor: Editor): boolean {
  const selection = getUniqueCellsFromRect(editor);
  if (!selection) return false;

  const tr = editor.view.state.tr;
  const replacements: Array<{ from: number; to: number }> = [];

  for (const cell of selection.cells) {
    const from = selection.rect.tableStart + cell.cellPos + 1;
    const to = selection.rect.tableStart + cell.cellPos + cell.cellNode.nodeSize - 1;
    replacements.push({ from, to });
  }

  replacements
    .sort((a, b) => b.from - a.from)
    .forEach(({ from, to }) => {
      tr.replaceWith(from, to, getEmptyParagraph(editor));
    });

  editor.view.dispatch(tr);
  return true;
}

export function deleteSelectedTableCells(editor: Editor, kind: "table" | "row" | "column"): boolean {
  if (!isInTable(editor.state)) return false;
  if (kind === "table") return editor.chain().focus().deleteTable().run();
  if (kind === "row") {
    return runWithIndexedTableMaintenance(editor, () => editor.chain().focus().deleteRow().run());
  }
  return editor.chain().focus().deleteColumn().run();
}

export function mergeSelectedTableCells(editor: Editor): boolean {
  if (!isInTable(editor.state)) return false;
  return editor.chain().focus().mergeCells().run();
}

export function insertTableRelativeRow(editor: Editor, direction: "before" | "after"): boolean {
  if (!isInTable(editor.state)) return false;
  return runWithIndexedTableMaintenance(editor, () => {
    const chain = editor.chain().focus();
    return direction === "before" ? chain.addRowBefore().run() : chain.addRowAfter().run();
  });
}

export function insertTableRelativeColumn(editor: Editor, direction: "before" | "after"): boolean {
  if (!isInTable(editor.state)) return false;
  const chain = editor.chain().focus();
  return direction === "before" ? chain.addColumnBefore().run() : chain.addColumnAfter().run();
}

function insertTableHtml(editor: Editor, html: string): boolean {
  const tableInfo = editor.state.selection.$from ? findTable(editor.state.selection.$from) : null;
  if (tableInfo) {
    return editor.chain().focus().insertContentAt(tableInfo.pos + tableInfo.node.nodeSize, html).run();
  }
  return editor.chain().focus().insertContent(html).run();
}

export async function pasteTableFromClipboard(editor: Editor): Promise<boolean> {
  let html: string | null = null;
  let text: string | null = null;

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!html && item.types.includes("text/html")) {
        const blob = await item.getType("text/html");
        html = await blob.text();
      }
      if (!text && item.types.includes("text/plain")) {
        const blob = await item.getType("text/plain");
        text = await blob.text();
      }
    }
  } catch {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return false;
    }
  }

  const tableHtml = html ? extractFirstTableHtml(html) : null;
  const tableGrid = tableHtml ? parseHtmlTableToGrid(tableHtml) : null;
  const textGrid = !tableHtml && text ? parseTabularPlainText(text) : null;

  if (tableGrid) {
    const rect = getTableRect(editor);
    if (rect) {
      const width = rect.right - rect.left;
      const height = rect.bottom - rect.top;
      const sourceWidth = tableGrid.rows[0]?.length ?? 0;
      const sourceHeight = tableGrid.rows.length;
      if (width === sourceWidth && height === sourceHeight) {
        const tr = editor.view.state.tr;
        for (let row = 0; row < height; row += 1) {
          for (let col = 0; col < width; col += 1) {
            const cellPos = rect.map.positionAt(rect.top + row, rect.left + col, rect.table);
            const cellNode = getTableCellNodeAt(editor, rect.tableStart, cellPos);
            const sourceCell = tableGrid.rows[row][col];
            if (!cellNode || !sourceCell) continue;
            const from = rect.tableStart + cellPos + 1;
            const to = rect.tableStart + cellPos + cellNode.nodeSize - 1;
            tr.replace(from, to, buildContentFromHtml(editor, sourceCell.html));
          }
        }
        editor.view.dispatch(tr);
        return true;
      }
    }

    return insertTableHtml(editor, tableHtml);
  }

  if (textGrid) {
    return insertTableHtml(editor, buildTableHtmlFromTextGrid(textGrid));
  }

  if (html) {
    const tableInsert = extractFirstTableHtml(html);
    if (tableInsert) {
      return insertTableHtml(editor, tableInsert);
    }
  }

  return false;
}

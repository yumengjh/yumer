// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { CellSelection, TableMap, findTable } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";
import { TableIndexColumn } from "../extensions/tableIndexColumn";
import {
  deleteSelectedTableCells,
  insertIndexColumn,
  insertTableRelativeRow,
  toggleTableDisplayFeature,
} from "./tableCommands";

const editors: Editor[] = [];

function createEditor() {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        table: false,
      }),
      TableIndexColumn,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "r1c1" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "r1c2" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "r2c1" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "r2c2" }] }] },
              ],
            },
          ],
        },
      ],
    },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

function selectCell(editor: Editor, row: number, col: number) {
  const tableInfo = findTable(editor.state.selection.$from);
  if (!tableInfo) throw new Error("table not found");
  const map = TableMap.get(tableInfo.node);
  const cellPos = map.positionAt(row, col, tableInfo.node);
  editor.view.dispatch(
    editor.state.tr.setSelection(CellSelection.create(editor.state.doc, tableInfo.start + cellPos)),
  );
}

function readTable(editor: Editor) {
  return editor.getJSON().content?.[0] as {
    attrs?: Record<string, unknown>;
    content: Array<{
      content: Array<{
        content?: Array<{ content?: Array<{ text?: string }> }>;
      }>;
    }>;
  };
}

function readFirstColumn(editor: Editor) {
  const table = readTable(editor);

  return {
    tableAttrs: table.attrs ?? {},
    values: table.content.map((row) => row.content[0]?.content?.[0]?.content?.[0]?.text ?? ""),
  };
}

function getRenderedTable(editor: Editor) {
  const table = editor.view.dom.querySelector("table");
  if (!(table instanceof HTMLTableElement)) {
    throw new Error("rendered table not found");
  }
  return table;
}

describe("tableCommands index column", () => {
  it("inserts an index column with an empty first header cell and sequence values", () => {
    const editor = createEditor();
    selectCell(editor, 1, 0);

    expect(insertIndexColumn(editor)).toBe(true);

    const firstColumn = readFirstColumn(editor);
    expect(firstColumn.tableAttrs.indexColumn).toBe(true);
    expect(firstColumn.values).toEqual(["", "1", "2"]);
    expect(editor.getHTML()).toContain('data-index-column="true"');
    expect(getRenderedTable(editor).getAttribute("data-index-column")).toBe("true");
  });

  it("renumbers the first column after inserting a row in an indexed table", () => {
    const editor = createEditor();
    selectCell(editor, 1, 0);
    insertIndexColumn(editor);

    selectCell(editor, 1, 1);

    expect(insertTableRelativeRow(editor, "after")).toBe(true);

    const firstColumn = readFirstColumn(editor);
    expect(firstColumn.values).toEqual(["", "1", "2", "3"]);
  });

  it("renumbers the first column after deleting a middle row in an indexed table", () => {
    const editor = createEditor();
    selectCell(editor, 1, 0);
    insertIndexColumn(editor);

    selectCell(editor, 1, 1);
    insertTableRelativeRow(editor, "after");

    selectCell(editor, 2, 1);

    expect(deleteSelectedTableCells(editor, "row")).toBe(true);

    const firstColumn = readFirstColumn(editor);
    expect(firstColumn.values).toEqual(["", "1", "2"]);
  });
});

describe("tableCommands display features", () => {
  it("toggles whole-table display attrs on the current table", () => {
    const editor = createEditor();
    selectCell(editor, 1, 0);

    expect(toggleTableDisplayFeature(editor, "hideOuterBorder")).toBe(true);
    expect(toggleTableDisplayFeature(editor, "equalWidth")).toBe(true);
    expect(toggleTableDisplayFeature(editor, "headerRow")).toBe(true);
    expect(toggleTableDisplayFeature(editor, "headerColumn")).toBe(true);

    expect(readTable(editor).attrs).toMatchObject({
      hideOuterBorder: true,
      equalWidth: true,
      headerRow: true,
      headerColumn: true,
    });
    const renderedTable = getRenderedTable(editor);
    expect(renderedTable.getAttribute("data-hide-outer-border")).toBe("true");
    expect(renderedTable.getAttribute("data-equal-width")).toBe("true");
    expect(renderedTable.getAttribute("data-header-row")).toBe("true");
    expect(renderedTable.getAttribute("data-header-column")).toBe("true");
  });

  it("preserves existing table display attrs when inserting an index column", () => {
    const editor = createEditor();
    selectCell(editor, 1, 0);
    toggleTableDisplayFeature(editor, "headerColumn");
    toggleTableDisplayFeature(editor, "headerRow");

    expect(insertIndexColumn(editor)).toBe(true);

    expect(readTable(editor).attrs).toMatchObject({
      indexColumn: true,
      headerColumn: true,
      headerRow: true,
    });
  });
});

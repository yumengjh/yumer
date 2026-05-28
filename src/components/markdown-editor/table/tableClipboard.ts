import { DOMSerializer } from "prosemirror-model";
import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";

export interface TableClipboardCell {
  tag: "td" | "th";
  html: string;
  text: string;
  colspan: number;
  rowspan: number;
  align: string | null;
}

export interface TableClipboardGrid {
  rows: TableClipboardCell[][];
}

export interface TableClipboardPayload {
  html: string;
  text: string;
  grid: TableClipboardGrid;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isTabularPlainText(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return false;
  const rows = normalized.split("\n").filter((row) => row.length > 0);
  if (rows.length === 0) return false;
  return rows.some((row) => row.includes("\t")) && rows.length >= 1;
}

export function parseTabularPlainText(text: string): string[][] | null {
  if (!isTabularPlainText(text)) return null;

  const rows = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((row) => row.length > 0)
    .map((row) => row.split("\t"));

  if (rows.length === 0) return null;

  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (maxColumns === 0) return null;

  return rows.map((row) => {
    if (row.length === maxColumns) return row;
    return [...row, ...Array.from({ length: maxColumns - row.length }, () => "")];
  });
}

export function buildTableHtmlFromTextGrid(grid: string[][]): string {
  const body = grid
    .map((row) => {
      const cells = row
        .map((cell) => `<td><p>${escapeHtml(cell)}</p></td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table><tbody>${body}</tbody></table>`;
}

export function buildTableTextFromGrid(grid: TableClipboardGrid): string {
  return grid.rows
    .map((row) => row.map((cell) => cell.text).join("\t"))
    .join("\n");
}

export function buildTableHtmlFromGrid(grid: TableClipboardGrid): string {
  const body = grid.rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const attrs: string[] = [];
          if (cell.colspan > 1) attrs.push(`colspan="${cell.colspan}"`);
          if (cell.rowspan > 1) attrs.push(`rowspan="${cell.rowspan}"`);
          if (cell.align) attrs.push(`style="text-align: ${escapeHtml(cell.align)}"`);
          const attrString = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
          const content = cell.html.trim() ? cell.html : "<p></p>";
          return `<${cell.tag}${attrString}>${content}</${cell.tag}>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table><tbody>${body}</tbody></table>`;
}

export function extractFirstTableHtml(html: string): string | null {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const table = parsed.body.querySelector("table");
  return table ? table.outerHTML : null;
}

export function parseHtmlTableToGrid(html: string): TableClipboardGrid | null {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const table = parsed.body.querySelector("table");
  if (!table) return null;

  const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
    Array.from(row.children)
      .filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement)
      .map((cell) => ({
        tag: cell.tagName.toLowerCase() === "th" ? "th" : "td",
        html: cell.innerHTML.trim(),
        text: cell.textContent?.trim() ?? "",
        colspan: Math.max(1, Number(cell.getAttribute("colspan") || "1")),
        rowspan: Math.max(1, Number(cell.getAttribute("rowspan") || "1")),
        align: cell.style.textAlign || cell.getAttribute("align"),
      })),
  );

  return rows.length > 0 ? { rows } : null;
}

export function createClipboardPayloadFromGrid(grid: TableClipboardGrid): TableClipboardPayload {
  return {
    grid,
    html: buildTableHtmlFromGrid(grid),
    text: buildTableTextFromGrid(grid),
  };
}

export function serializeCellContent(
  schema: Schema,
  cellNode: ProseMirrorNode,
  ownerDocument: Document,
): string {
  const serializer = DOMSerializer.fromSchema(schema);
  const shell = ownerDocument.createElement("div");
  shell.appendChild(serializer.serializeFragment(cellNode.content, { document: ownerDocument }));
  return shell.innerHTML.trim();
}

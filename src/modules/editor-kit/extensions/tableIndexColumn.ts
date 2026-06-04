import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const TABLE_DATA_ATTRS = [
  "indexColumn",
  "hideOuterBorder",
  "equalWidth",
  "headerRow",
  "headerColumn",
] as const;

function toDataAttributeName(attr: (typeof TABLE_DATA_ATTRS)[number]) {
  return `data-${attr.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

function syncTableDataAttributes(view: EditorView) {
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "table") return;

    const domNode = view.nodeDOM(pos);
    if (!(domNode instanceof HTMLElement)) return;

    const tableElement =
      domNode instanceof HTMLTableElement ? domNode : domNode.querySelector("table");

    if (!(tableElement instanceof HTMLTableElement)) return;

    for (const attr of TABLE_DATA_ATTRS) {
      const value = node.attrs?.[attr] === true;
      const dataAttr = toDataAttributeName(attr);
      if (value) {
        tableElement.setAttribute(dataAttr, "true");
      } else {
        tableElement.removeAttribute(dataAttr);
      }
    }
  });
}

export const TableIndexColumn = Extension.create({
  name: "tableIndexColumn",

  addGlobalAttributes() {
    return [
      {
        types: ["table"],
        attributes: {
          indexColumn: {
            default: false,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-index-column") === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.indexColumn ? { "data-index-column": "true" } : {},
          },
          hideOuterBorder: {
            default: false,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-hide-outer-border") === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.hideOuterBorder ? { "data-hide-outer-border": "true" } : {},
          },
          equalWidth: {
            default: false,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-equal-width") === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.equalWidth ? { "data-equal-width": "true" } : {},
          },
          headerRow: {
            default: false,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-header-row") === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.headerRow ? { "data-header-row": "true" } : {},
          },
          headerColumn: {
            default: false,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-header-column") === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.headerColumn ? { "data-header-column": "true" } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: (view) => {
          syncTableDataAttributes(view);

          return {
            update: (updatedView) => {
              syncTableDataAttributes(updatedView);
            },
          };
        },
      }),
    ];
  },
});

import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const DEFAULT_LIST_FONT_SIZE_PX = 15;
const listTypographyPluginKey = new PluginKey<DecorationSet>("listTypography");
const LIST_ITEM_NODE_TYPES = new Set(["listItem", "taskItem"]);
const LIST_CONTAINER_NODE_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function normalizeFontSize(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const text = `${value}`.trim();
  if (!text) return null;
  if (text.endsWith("px")) return text;
  return /^\d+(\.\d+)?$/.test(text) ? `${text}px` : null;
}

export function findListContentFontSize(node: ProseMirrorNode): string | null {
  let fontSize: string | null = null;

  node.descendants((child) => {
    if (fontSize || !child.isText) return fontSize === null;

    for (const mark of child.marks) {
      if (mark.type.name !== "textStyle") continue;
      const normalized = normalizeFontSize(mark.attrs?.fontSize);
      if (normalized) {
        fontSize = normalized;
        return false;
      }
    }

    return true;
  });

  return fontSize;
}

export function getListTypographyVars(node: ProseMirrorNode): Record<string, string> | null {
  const fontSize = findListContentFontSize(node);
  if (!fontSize) return null;

  const fontSizeNumber = Number.parseFloat(fontSize);
  const scale = Number.isFinite(fontSizeNumber)
    ? Math.max(1, fontSizeNumber / DEFAULT_LIST_FONT_SIZE_PX)
    : 1;
  const checkboxSize = `${Math.round(16 * scale * 100) / 100}px`;
  const checkboxOffset = `${Math.round((fontSizeNumber * 1.74) * 100) / 100}px`;
  const checkboxGap = `${Math.round(12 * scale * 100) / 100}px`;
  const checkmarkWidth = `${Math.round(4 * scale * 100) / 100}px`;
  const checkmarkHeight = `${Math.round(8 * scale * 100) / 100}px`;
  const checkmarkLeft = `${Math.round(4.5 * scale * 100) / 100}px`;
  const checkmarkTop = `${Math.round(1 * scale * 100) / 100}px`;
  const checkmarkBorder = `${Math.round(2 * scale * 100) / 100}px`;
  const checkboxRadius = `${Math.round(6 * scale * 100) / 100}px`;
  const checkStroke = `${Math.round(4 * scale * 100) / 100}px`;
  const checkLength = `${Math.round(100 * scale * 100) / 100}`;

  return {
    "--list-font-size": fontSize,
    "--task-checkbox-size": checkboxSize,
    "--task-checkbox-offset": checkboxOffset,
    "--task-checkbox-gap": checkboxGap,
    "--task-checkmark-width": checkmarkWidth,
    "--task-checkmark-height": checkmarkHeight,
    "--task-checkmark-left": checkmarkLeft,
    "--task-checkmark-top": checkmarkTop,
    "--task-checkmark-border": checkmarkBorder,
    "--task-checkbox-radius": checkboxRadius,
    "--task-check-stroke": checkStroke,
    "--task-check-length": checkLength,
  };
}

function serializeVars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

function collectListTypographyDecorations(
  node: ProseMirrorNode,
  pos: number,
  decorations: Decoration[],
): void {
  if (LIST_ITEM_NODE_TYPES.has(node.type.name)) {
    const vars = getListTypographyVars(node);
    if (vars) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          "data-list-font-size": vars["--list-font-size"],
          style: serializeVars(vars),
        }),
      );
    }
  }

  node.forEach((child, offset) => {
    if (!LIST_ITEM_NODE_TYPES.has(child.type.name) && !LIST_CONTAINER_NODE_TYPES.has(child.type.name)) {
      return;
    }
    collectListTypographyDecorations(child, pos + offset + 1, decorations);
  });
}

export function buildListTypographyDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.forEach((node, offset) => {
    if (!LIST_ITEM_NODE_TYPES.has(node.type.name) && !LIST_CONTAINER_NODE_TYPES.has(node.type.name)) {
      return;
    }
    collectListTypographyDecorations(node, offset, decorations);
  });

  return decorations.length > 0
    ? DecorationSet.create(doc, decorations)
    : DecorationSet.empty;
}

export const ListTypography = Extension.create({
  name: "listTypography",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: listTypographyPluginKey,
        state: {
          init: (_, state) => buildListTypographyDecorations(state.doc),
          apply: (tr, old) => {
            if (!tr.docChanged) return old.map(tr.mapping, tr.doc);
            return buildListTypographyDecorations(tr.doc);
          },
        },
        props: {
          decorations: (state) => listTypographyPluginKey.getState(state) ?? null,
        },
      }),
    ];
  },
});

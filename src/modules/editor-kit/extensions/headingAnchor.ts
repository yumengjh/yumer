import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { createHeadingAnchorPatchPlan } from "../utils/anchorId";

const headingAnchorPluginKey = new PluginKey("headingAnchor");

function rangeHasHeading(state: EditorState, from: number, to: number): boolean {
  let found = false;
  const safeFrom = Math.max(0, Math.min(from, state.doc.content.size));
  const safeTo = Math.max(safeFrom, Math.min(to, state.doc.content.size));
  state.doc.nodesBetween(safeFrom, safeTo, (node) => {
    if (node.type.name === "heading") {
      found = true;
      return false;
    }
    return !found;
  });
  return found;
}

function transactionsTouchHeading(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): boolean {
  for (const tr of transactions) {
    if (!tr.docChanged) continue;
    let touched = false;
    tr.mapping.maps.forEach((map) => {
      if (touched) return;
      map.forEach((oldStart, oldEnd, newStart, newEnd) => {
        if (touched) return;
        touched =
          rangeHasHeading(oldState, oldStart, oldEnd) ||
          rangeHasHeading(newState, newStart, newEnd);
      });
    });
    if (touched) return true;
  }
  return false;
}

export const HeadingAnchor = Extension.create({
  name: "headingAnchor",

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          anchorId: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-anchor") ?? element.getAttribute("id") ?? null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const anchorId = attributes.anchorId as string | null;
              if (!anchorId) return {};
              return {
                id: anchorId,
                "data-anchor": anchorId,
              };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: headingAnchorPluginKey,
        appendTransaction(transactions, oldState, newState) {
          const meta = transactions.some((tr) => tr.getMeta(headingAnchorPluginKey));
          if (meta) return null;
          if (!transactionsTouchHeading(transactions, oldState, newState)) return null;

          const headings: Array<{ pos: number; anchorId: string | null }> = [];
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "heading") {
              headings.push({
                pos,
                anchorId: typeof node.attrs.anchorId === "string" ? node.attrs.anchorId : null,
              });
            }
          });

          const patches = createHeadingAnchorPatchPlan(headings);
          if (patches.length === 0) return null;

          const tr = newState.tr;
          for (const patch of patches) {
            const node = newState.doc.nodeAt(patch.pos);
            if (!node) continue;
            tr.setNodeMarkup(patch.pos, undefined, { ...node.attrs, anchorId: patch.anchorId });
          }
          tr.setMeta(headingAnchorPluginKey, true);
          return tr;
        },
      }),
    ];
  },
});

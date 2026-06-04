import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createHeadingAnchorPatchPlan } from "../utils/anchorId";

const headingAnchorPluginKey = new PluginKey("headingAnchor");

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

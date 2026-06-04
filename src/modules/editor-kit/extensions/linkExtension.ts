/**
 * Custom Link Extension
 * =====================
 * Extends @tiptap/extension-link with:
 * 1. `inclusive: false` — fixes the boundary bug where all text typed after a URL
 *    inherits the link mark.
 * 2. Hover detection plugin — tracks which link the mouse is over.
 *    The plugin ONLY adds state on mouseover. All hide/timer logic
 *    is handled by the React LinkToolbar component.
 */

import { Link, type LinkOptions } from "@tiptap/extension-link";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/* ------------------------------------------------------------------ */
/*  Hover state types                                                  */
/* ------------------------------------------------------------------ */

export interface HoveredLink {
  href: string;
  text: string;
  from: number;
  to: number;
  rect: DOMRect;
}

export interface LinkHoverPluginState {
  hoveredLink: HoveredLink | null;
}

/* ------------------------------------------------------------------ */
/*  Plugin key                                                         */
/* ------------------------------------------------------------------ */

export const linkHoverPluginKey = new PluginKey<LinkHoverPluginState>("linkHover");

/* ------------------------------------------------------------------ */
/*  Helper: find the link mark range at a given document position       */
/* ------------------------------------------------------------------ */

function findLinkRangeAtPos(view: EditorView, pos: number): { from: number; to: number } | null {
  const { state } = view;
  const linkMark = state.schema.marks.link;
  if (!linkMark) return null;

  const safePos = Math.max(0, Math.min(pos, state.doc.content.size - 1));
  if (safePos < 0) return null;

  const $pos = state.doc.resolve(safePos);
  const marks = $pos.marks();
  const linkMarkInstance = marks.find(m => m.type === linkMark);
  if (!linkMarkInstance) return null;

  const parent = $pos.parent;
  const parentStart = $pos.start($pos.depth);
  let from = parentStart;
  let to = parentStart;

  parent.forEach((child, offset) => {
    if (!child.isText) return;
    if (child.marks.find(m => m.eq(linkMarkInstance))) {
      const childFrom = parentStart + offset;
      const childTo = childFrom + child.nodeSize;
      if (childFrom <= safePos && childTo > safePos) {
        from = childFrom;
        to = childTo;
        let checkFrom = childFrom;
        while (checkFrom > parentStart) {
          const $check = state.doc.resolve(checkFrom - 1);
          if (!$check.marks().find(m => m.eq(linkMarkInstance))) break;
          checkFrom--;
        }
        from = checkFrom;
        let checkTo = childTo;
        while (checkTo < parentStart + parent.content.size) {
          const $check = state.doc.resolve(checkTo);
          if (!$check.marks().find(m => m.eq(linkMarkInstance))) break;
          checkTo++;
        }
        to = checkTo;
      }
    }
  });

  if (from === to) return null;
  return { from, to };
}

/* ------------------------------------------------------------------ */
/*  Hover detection plugin                                             */
/* ------------------------------------------------------------------ */

function createLinkHoverPlugin(): Plugin<LinkHoverPluginState> {
  return new Plugin<LinkHoverPluginState>({
    key: linkHoverPluginKey,

    state: {
      init(): LinkHoverPluginState {
        return { hoveredLink: null };
      },
      apply(tr, value): LinkHoverPluginState {
        const meta = tr.getMeta(linkHoverPluginKey);
        if (meta !== undefined) return meta as LinkHoverPluginState;
        return value;
      },
    },

    props: {
      handleDOMEvents: {
        mouseover(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement | null;
          if (!target) return false;

          // Ignore toolbar events
          if (target.closest(".link-hover-toolbar")) return false;

          const linkEl = target.closest("a.tiptap-link") as HTMLAnchorElement | null;
          if (!linkEl) return false;

          const href = linkEl.getAttribute("href") || "";
          if (!href) return false;

          const text = linkEl.textContent || "";
          const rect = linkEl.getBoundingClientRect();

          // Use rect center for reliable position detection
          const posAtCoords = view.posAtCoords({
            left: rect.left + rect.width / 2,
            top: rect.top + rect.height / 2,
          });

          if (!posAtCoords) return false;

          const range = findLinkRangeAtPos(view, posAtCoords.pos);
          if (!range) return false;

          const currentState = linkHoverPluginKey.getState(view.state);
          if (
            currentState?.hoveredLink &&
            currentState.hoveredLink.from === range.from &&
            currentState.hoveredLink.to === range.to
          ) {
            return false;
          }

          const tr = view.state.tr;
          tr.setMeta(linkHoverPluginKey, {
            hoveredLink: { href, text, from: range.from, to: range.to, rect },
          });
          view.dispatch(tr);

          return false;
        },
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Custom Link Extension                                              */
/* ------------------------------------------------------------------ */

export const LinkExtension = Link.extend({
  name: "link",

  addOptions() {
    return {
      ...(this.parent?.() || {}),
      openOnClick: false,
      autolink: true,
      HTMLAttributes: {
        class: "tiptap-link",
      },
    } as LinkOptions;
  },

  inclusive() {
    return false;
  },

  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() || [];
    return [...parentPlugins, createLinkHoverPlugin()];
  },
});

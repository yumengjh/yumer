import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { generateAnchorId } from "../utils/anchorId";

const headingAnchorPluginKey = new PluginKey("headingAnchor");

function createAnchorIcon(anchorId: string): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "heading-anchor-icon";
  icon.setAttribute("data-anchor-id", anchorId);
  icon.setAttribute("role", "button");
  icon.setAttribute("aria-label", "复制链接");
  icon.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  return icon;
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
              element.getAttribute("data-anchor") ?? element.getAttribute("id")?.replace(/^h-/, "") ?? null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const anchorId = attributes.anchorId as string | null;
              if (!anchorId) return {};
              return {
                id: `h-${anchorId}`,
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
        // 自动为缺少 anchorId 的标题补生成（切换文档、粘贴等场景）
        appendTransaction(transactions, oldState, newState) {
          const meta = transactions.some((tr) => tr.getMeta(headingAnchorPluginKey));
          if (meta) return null;

          let needPatch = false;
          const tr = newState.tr;
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "heading" && !node.attrs.anchorId) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, anchorId: generateAnchorId() });
              needPatch = true;
            }
          });
          if (!needPatch) return null;
          tr.setMeta(headingAnchorPluginKey, true);
          return tr;
        },
        props: {
          decorations: ({ doc }) => {
            const decorations: Decoration[] = [];
            doc.descendants((node, pos) => {
              if (node.type.name === "heading" && node.attrs.anchorId) {
                const anchorId = node.attrs.anchorId as string;
                const lastContentPos = pos + node.nodeSize - 1;
                decorations.push(
                  Decoration.widget(lastContentPos, createAnchorIcon(anchorId), { side: -1, ignoreSelection: true }),
                );
              }
            });
            return DecorationSet.create(doc, decorations);
          },
        },
        view: (editorView) => {
          let activeIcon: HTMLElement | null = null;

          const handleMouseOver = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const heading = target.closest("h1, h2, h3, h4, h5, h6") as HTMLElement | null;
            if (!heading || !editorView.dom.contains(heading)) return;
            const icon = heading.querySelector(".heading-anchor-icon") as HTMLElement | null;
            if (icon && icon !== activeIcon) {
              if (activeIcon) activeIcon.classList.remove("is-visible");
              icon.classList.add("is-visible");
              activeIcon = icon;
            }
          };

          const handleMouseOut = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const heading = target.closest("h1, h2, h3, h4, h5, h6") as HTMLElement | null;
            if (!heading || !editorView.dom.contains(heading)) return;
            const related = event.relatedTarget as HTMLElement | null;
            if (!related || !heading.contains(related)) {
              if (activeIcon) {
                activeIcon.classList.remove("is-visible");
                activeIcon = null;
              }
            }
          };

          const handleClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const icon = target.closest(".heading-anchor-icon") as HTMLElement | null;
            if (!icon) return;
            const anchorId = icon.getAttribute("data-anchor-id");
            if (!anchorId) return;

            event.preventDefault();
            event.stopPropagation();

            const heading = icon.closest("h1, h2, h3, h4, h5, h6") as HTMLElement | null;
            if (heading) {
              const HEADER_OFFSET = 96 + 20;
              const rect = heading.getBoundingClientRect();
              const targetY = window.scrollY + rect.top - HEADER_OFFSET;
              window.scrollTo({ top: targetY, behavior: "smooth" });
            }

            const url = new URL(window.location.href);
            url.hash = `h-${anchorId}`;
            window.history.replaceState(null, "", url.toString());
            navigator.clipboard.writeText(url.toString()).catch(() => {});
          };

          editorView.dom.addEventListener("mouseover", handleMouseOver);
          editorView.dom.addEventListener("mouseout", handleMouseOut);
          editorView.dom.addEventListener("click", handleClick);
          return {
            destroy() {
              editorView.dom.removeEventListener("mouseover", handleMouseOver);
              editorView.dom.removeEventListener("mouseout", handleMouseOut);
              editorView.dom.removeEventListener("click", handleClick);
            },
          };
        },
      }),
    ];
  },
});

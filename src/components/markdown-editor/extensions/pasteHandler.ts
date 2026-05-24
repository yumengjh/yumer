import { Extension } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import { DOMParser as ProseMirrorDOMParser, Slice } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { marked } from "marked";

type CodeBlockSelectionLike = {
  state?: {
    selection?: {
      $from?: {
        parent?: {
          type?: {
            name?: string;
          };
        };
      };
    };
  };
};

export const isCodeBlockSelection = (view: CodeBlockSelectionLike): boolean => {
  return view.state?.selection?.$from?.parent?.type?.name === "codeBlock";
};

const cleanPastedHTML = (html: string): string => {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  const unwantedTags = ["script", "style", "meta", "link", "iframe", "object", "embed"];
  unwantedTags.forEach((tag) => {
    const elements = tempDiv.querySelectorAll(tag);
    elements.forEach((el) => el.remove());
  });

  const links = tempDiv.querySelectorAll("a");
  links.forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("javascript:") || href.startsWith("data:")) {
      const parent = link.parentNode;
      if (parent) {
        while (link.firstChild) {
          parent.insertBefore(link.firstChild, link);
        }
        parent.removeChild(link);
      }
    }
  });

  const paragraphs = tempDiv.querySelectorAll("p");
  paragraphs.forEach((p) => {
    const brs = p.querySelectorAll("br");
    const hasOnlyBr = brs.length > 0 && p.textContent?.trim() === "";
    const hasTrailingBreak = Array.from(brs).some((br) =>
      br.classList.contains("ProseMirror-trailingBreak"),
    );

    if (hasOnlyBr || hasTrailingBreak) {
      p.remove();
    }
  });

  const trailingBreaks = tempDiv.querySelectorAll("br.ProseMirror-trailingBreak");
  trailingBreaks.forEach((br) => br.remove());

  let cleanedHtml = tempDiv.innerHTML;
  cleanedHtml = cleanedHtml.replace(/^<p>\s*<br[^>]*>\s*<\/p>/i, "");
  cleanedHtml = cleanedHtml.replace(/^<p>\s*<\/p>/i, "");
  cleanedHtml = cleanedHtml.replace(/<p>\s*<br[^>]*>\s*<\/p>$/i, "");
  cleanedHtml = cleanedHtml.replace(/<p>\s*<\/p>$/i, "");

  return cleanedHtml;
};

export const createPasteHandlerExtension = () => {
  return Extension.create({
    name: "pasteHandler",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handlePaste: (view: EditorView, event: ClipboardEvent) => {
              const html = event.clipboardData?.getData("text/html");
              const text = event.clipboardData?.getData("text/plain");

              if (!html && !text) return false;

              if (text && isCodeBlockSelection(view)) {
                event.preventDefault();
                const { from, to } = view.state.selection;
                view.dispatch(view.state.tr.insertText(text, from, to));
                return true;
              }

              if (html && html.trim()) {
                const hasHtmlTags = /<\/?[a-z][\s\S]*>/i.test(html);

                if (hasHtmlTags) {
                  event.preventDefault();

                  try {
                    const cleanHtml = cleanPastedHTML(html);

                    const editorInstance = this.editor;
                    if (editorInstance) {
                      editorInstance.commands.insertContent(cleanHtml, {
                        parseOptions: {
                          preserveWhitespace: false,
                        },
                      });

                      requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                          const currentHtml = editorInstance.getHTML();

                          if (currentHtml.includes("ProseMirror-trailingBreak")) {
                            const cleaned = currentHtml
                              .replace(
                                /^<p[^>]*>\s*<br[^>]*class="ProseMirror-trailingBreak"[^>]*>\s*<\/p>/i,
                                "",
                              )
                              .replace(
                                /<p[^>]*>[\s\S]*?<br[^>]*class="ProseMirror-trailingBreak"[^>]*>[\s\S]*?<\/p>/gi,
                                "",
                              )
                              .replace(
                                /<br[^>]*class="ProseMirror-trailingBreak"[^>]*>/gi,
                                "",
                              )
                              .replace(/^<p>\s*<br[^>]*>\s*<\/p>/i, "")
                              .replace(/^<p>\s*<\/p>/i, "");

                            if (cleaned !== currentHtml && cleaned.trim() !== "") {
                              const { from } = editorInstance.state.selection;

                              editorInstance.commands.setContent(cleaned, {
                                emitUpdate: false,
                              });

                              setTimeout(() => {
                                try {
                                  const newDoc = editorInstance.state.doc;
                                  const newFrom = Math.min(from, newDoc.content.size);
                                  editorInstance.commands.setTextSelection(newFrom);
                                } catch {
                                  // ignore cursor position errors
                                }
                              }, 0);
                            }
                          }
                        });
                      });

                      return true;
                    } else {
                      const parser = ProseMirrorDOMParser.fromSchema(view.state.schema);
                      const dom = new DOMParser().parseFromString(cleanHtml, "text/html");
                      const fragment = parser.parse(dom.body);
                      const { from, to } = view.state.selection;
                      const slice = new Slice(fragment.content, 0, 0);
                      const transaction = view.state.tr.replace(from, to, slice);
                      view.dispatch(transaction);
                      return true;
                    }
                  } catch {
                    return false;
                  }
                }
              }

              if (text) {
                const looksLikeMarkdown =
                  /(^#{1,6}\s)|(\*\*.*\*\*)|(\*.*\*)|(^-\s)|(^\*\s)|(^\d+\.\s)|(^>\s)|(\[.*\]\(.*\))|(```)/m.test(
                    text,
                  );

                if (looksLikeMarkdown) {
                  event.preventDefault();

                  try {
                    const parsedHtml = marked.parse(text, {
                      breaks: true,
                      gfm: true,
                    }) as string;

                    const editorInstance = this.editor;
                    if (editorInstance) {
                      editorInstance.commands.insertContent(parsedHtml);
                      return true;
                    } else {
                      const parser = ProseMirrorDOMParser.fromSchema(view.state.schema);
                      const dom = new DOMParser().parseFromString(parsedHtml, "text/html");
                      const fragment = parser.parse(dom.body);
                      const { from, to } = view.state.selection;
                      const slice = new Slice(fragment.content, 0, 0);
                      const transaction = view.state.tr.replace(from, to, slice);
                      view.dispatch(transaction);
                      return true;
                    }
                  } catch {
                    return false;
                  }
                }
              }

              return false;
            },
          },
        }),
      ];
    },
  });
};

import CodeBlock from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "prosemirror-state";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { TokenStyles } from "shiki";
import {
  DEFAULT_CODE_LANGUAGE,
  getCodeThemeByName,
  getCodeThemeByMode,
  resolveCodeLanguageForShiki,
  type CodeThemeMode,
  type ShikiHighlighter,
} from "./codeHighlight";
import { normalizeCodeBlockAttrs } from "./codeBlockOptions";
import {
  dispatchSelectAllCodeBlockText,
  isSelectAllKey,
  selectAllCodeBlockText,
} from "./codeBlockSelection";
import CodeBlockView from "./CodeBlockView";

const CODE_BLOCK_SELECT_ALL_KEY = new PluginKey("code-block-select-all");

export const SHIKI_CODE_BLOCK_PLUGIN_KEY = new PluginKey<DecorationSet>(
  "shiki-code-block-highlight",
);

type CreateShikiCodeBlockExtensionOptions = {
  highlighter: ShikiHighlighter;
  getThemeMode: () => CodeThemeMode;
  defaultLanguage?: string;
};

const fontStyleToCss = (fontStyle?: number): string[] => {
  if (typeof fontStyle !== "number" || fontStyle <= 0) return [];
  const styles: string[] = [];
  if (fontStyle & 1) styles.push("font-style: italic");
  if (fontStyle & 2) styles.push("font-weight: 600");
  if (fontStyle & 4) styles.push("text-decoration: underline");
  return styles;
};

const tokenStylesToCssText = (token: TokenStyles): string => {
  if (token.htmlStyle && typeof token.htmlStyle === "object") {
    return Object.entries(token.htmlStyle)
      .map(([key, value]) => `${key}: ${value}`)
      .join("; ");
  }

  const styles: string[] = [];
  if (token.color) styles.push(`color: ${token.color}`);
  if (token.bgColor) styles.push(`background-color: ${token.bgColor}`);
  styles.push(...fontStyleToCss(token.fontStyle));
  return styles.join("; ");
};

const buildDecorations = (
  doc: ProseMirrorNode,
  highlighter: ShikiHighlighter,
  getThemeMode: () => CodeThemeMode,
  fallbackLanguage: string,
): DecorationSet => {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return true;

    const attrs = normalizeCodeBlockAttrs(node.attrs);
    const explicitTheme = getCodeThemeByName(attrs.codeTheme);
    const theme = explicitTheme || getCodeThemeByMode(getThemeMode());
    const nodeLanguage = attrs.language || fallbackLanguage;
    const lang = resolveCodeLanguageForShiki(highlighter, nodeLanguage);
    const code = node.textContent || "";

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: "tiptap-codeblock-node",
        "data-language": nodeLanguage || fallbackLanguage,
      }),
    );

    if (!code.trim()) {
      return true;
    }

    let tokens;
    try {
      tokens = highlighter.codeToTokens(code, {
        lang,
        theme,
      }).tokens;
    } catch {
      tokens = highlighter.codeToTokens(code, {
        lang: DEFAULT_CODE_LANGUAGE,
        theme,
      }).tokens;
    }

    for (const line of tokens) {
      for (const token of line) {
        const length = token.content.length;
        if (length <= 0) continue;
        const from = pos + 1 + token.offset;
        const to = from + length;
        const style = tokenStylesToCssText(token);
        if (!style) continue;
        decorations.push(
          Decoration.inline(from, to, {
            class: "tiptap-shiki-token",
            style,
          }),
        );
      }
    }

    return true;
  });

  return DecorationSet.create(doc, decorations);
};

export const createShikiCodeBlockExtension = ({
  highlighter,
  getThemeMode,
  defaultLanguage = DEFAULT_CODE_LANGUAGE,
}: CreateShikiCodeBlockExtensionOptions) => {
  return CodeBlock.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        codeTheme: { default: "auto" },
        fontSize: { default: "inherit" },
        indentMode: { default: "space" },
        indentSize: { default: 2 },
        wordWrap: { default: false },
        lineNumbers: { default: true },
        autoIndent: { default: true },
        title: { default: "" },
        statusBarCollapsed: { default: false },
        codeCollapsed: { default: false },
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView);
    },
    addKeyboardShortcuts() {
      const parentShortcuts = this.parent?.() ?? {};
      return {
        ...parentShortcuts,
        "Mod-a": () => selectAllCodeBlockText(this.editor),
      };
    },
    addProseMirrorPlugins() {
      const parentPlugins = this.parent?.() ?? [];
      return [
        ...parentPlugins,
        new Plugin<DecorationSet>({
          key: SHIKI_CODE_BLOCK_PLUGIN_KEY,
          state: {
            init: (_, state) =>
              buildDecorations(state.doc, highlighter, getThemeMode, defaultLanguage),
            apply: (tr, old, _oldState, newState) => {
              const force = Boolean(tr.getMeta(SHIKI_CODE_BLOCK_PLUGIN_KEY));
              if (!tr.docChanged && !force) {
                return old.map(tr.mapping, tr.doc);
              }
              return buildDecorations(newState.doc, highlighter, getThemeMode, defaultLanguage);
            },
          },
          props: {
            decorations: (state) => SHIKI_CODE_BLOCK_PLUGIN_KEY.getState(state) || null,
          },
        }),
        new Plugin({
          key: CODE_BLOCK_SELECT_ALL_KEY,
          props: {
            handleDOMEvents: {
              keydown: (view, event) => {
                if (!isSelectAllKey(event)) return false;
                if (!dispatchSelectAllCodeBlockText(view)) return false;
                event.preventDefault();
                return true;
              },
            },
          },
        }),
      ];
    },
  }).configure({
    defaultLanguage,
    languageClassPrefix: "language-",
  });
};

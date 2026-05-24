import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import langBash from "@shikijs/langs/bash";
import langCss from "@shikijs/langs/css";
import langGo from "@shikijs/langs/go";
import langHtml from "@shikijs/langs/html";
import langJava from "@shikijs/langs/java";
import langJavascript from "@shikijs/langs/javascript";
import langJsx from "@shikijs/langs/jsx";
import langJson from "@shikijs/langs/json";
import langMarkdown from "@shikijs/langs/markdown";
import langPython from "@shikijs/langs/python";
import langRust from "@shikijs/langs/rust";
import langSql from "@shikijs/langs/sql";
import langTsx from "@shikijs/langs/tsx";
import langTypescript from "@shikijs/langs/typescript";
import langYaml from "@shikijs/langs/yaml";
import themeGithubDark from "@shikijs/themes/github-dark";
import themeGithubLight from "@shikijs/themes/github-light";

export type CodeThemeMode = "light" | "dark";

export const SHIKI_LIGHT_THEME = "github-light";
export const SHIKI_DARK_THEME = "github-dark";
export const DEFAULT_CODE_LANGUAGE = "text";

const COMMON_LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  md: "markdown",
  yml: "yaml",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  plain: "text",
  plaintext: "text",
  txt: "text",
};

export type ShikiHighlighter = HighlighterCore;

let highlighterPromise: Promise<ShikiHighlighter> | null = null;

export const normalizeCodeLanguage = (lang?: string): string => {
  const raw = (lang || "").trim().toLowerCase();
  if (!raw) return DEFAULT_CODE_LANGUAGE;
  return COMMON_LANG_ALIASES[raw] || raw;
};

export const getCodeThemeByMode = (mode: CodeThemeMode): string => {
  return mode === "dark" ? SHIKI_DARK_THEME : SHIKI_LIGHT_THEME;
};

export const getCodeThemeByName = (theme: string): string | null => {
  if (theme === SHIKI_LIGHT_THEME || theme === SHIKI_DARK_THEME) return theme;
  return null;
};

export const resolveCodeLanguageForShiki = (
  highlighter: ShikiHighlighter,
  lang?: string,
): string => {
  const normalized = normalizeCodeLanguage(lang);
  const alias = highlighter.resolveLangAlias(normalized);
  const loaded = new Set(highlighter.getLoadedLanguages().map((item) => item.toLowerCase()));

  if (loaded.has(alias.toLowerCase())) {
    return alias;
  }
  if (loaded.has(normalized.toLowerCase())) {
    return normalized;
  }
  return DEFAULT_CODE_LANGUAGE;
};

export const getShikiHighlighter = async (): Promise<ShikiHighlighter> => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [themeGithubLight, themeGithubDark],
      langs: [
        langJavascript,
        langJsx,
        langTypescript,
        langTsx,
        langJson,
        langBash,
        langMarkdown,
        langHtml,
        langCss,
        langSql,
        langYaml,
        langPython,
        langJava,
        langGo,
        langRust,
      ],
      langAlias: {
        js: "javascript",
        ts: "typescript",
        yml: "yaml",
      },
    });
  }
  return highlighterPromise;
};

import type { TiptapNode } from "../types";
import { DEFAULT_CODE_LANGUAGE, normalizeCodeLanguage } from "./codeHighlight";

export type CodeBlockTheme = "auto" | "github-light" | "github-dark";
export type CodeBlockFontSize = "inherit" | "12px" | "13px" | "14px" | "16px";
export type CodeBlockIndentMode = "space" | "tab";
export type CodeBlockIndentSize = 2 | 4 | 8;

export interface CodeBlockAttrs {
  language: string;
  codeTheme: CodeBlockTheme;
  fontSize: CodeBlockFontSize;
  indentMode: CodeBlockIndentMode;
  indentSize: CodeBlockIndentSize;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoIndent: boolean;
  title: string;
  statusBarCollapsed: boolean;
  codeCollapsed: boolean;
}

export const CODE_BLOCK_DEFAULTS: CodeBlockAttrs = {
  language: DEFAULT_CODE_LANGUAGE,
  codeTheme: "auto",
  fontSize: "inherit",
  indentMode: "space",
  indentSize: 2,
  wordWrap: false,
  lineNumbers: true,
  autoIndent: true,
  title: "",
  statusBarCollapsed: false,
  codeCollapsed: false,
};

export const codeBlockThemeItems: Array<{ key: CodeBlockTheme; label: string }> = [
  { key: "auto", label: "跟随正文" },
  { key: "github-light", label: "Yuque Light Pro" },
  { key: "github-dark", label: "Yuque Dark Pro" },
];

export const codeBlockFontSizeItems: Array<{ key: CodeBlockFontSize; label: string }> = [
  { key: "inherit", label: "跟随正文" },
  { key: "12px", label: "12px" },
  { key: "13px", label: "13px" },
  { key: "14px", label: "14px" },
  { key: "16px", label: "16px" },
];

export const codeBlockIndentModeItems: Array<{ key: CodeBlockIndentMode; label: string }> = [
  { key: "space", label: "Space" },
  { key: "tab", label: "Tab" },
];

export const codeBlockIndentSizeItems: Array<{ key: CodeBlockIndentSize; label: string }> = [
  { key: 2, label: "2" },
  { key: 4, label: "4" },
  { key: 8, label: "8" },
];

const themes = new Set<CodeBlockTheme>(["auto", "github-light", "github-dark"]);
const fontSizes = new Set<CodeBlockFontSize>(["inherit", "12px", "13px", "14px", "16px"]);
const indentModes = new Set<CodeBlockIndentMode>(["space", "tab"]);
const indentSizes = new Set<CodeBlockIndentSize>([2, 4, 8]);

export function normalizeCodeBlockAttrs(attrs?: Record<string, unknown> | null): CodeBlockAttrs {
  const raw = attrs || {};
  const language =
    typeof raw.language === "string" && raw.language.trim()
      ? normalizeCodeLanguage(raw.language)
      : CODE_BLOCK_DEFAULTS.language;
  const codeTheme = themes.has(raw.codeTheme as CodeBlockTheme)
    ? (raw.codeTheme as CodeBlockTheme)
    : CODE_BLOCK_DEFAULTS.codeTheme;
  const fontSize = fontSizes.has(raw.fontSize as CodeBlockFontSize)
    ? (raw.fontSize as CodeBlockFontSize)
    : CODE_BLOCK_DEFAULTS.fontSize;
  const indentMode = indentModes.has(raw.indentMode as CodeBlockIndentMode)
    ? (raw.indentMode as CodeBlockIndentMode)
    : CODE_BLOCK_DEFAULTS.indentMode;
  const indentSize = indentSizes.has(raw.indentSize as CodeBlockIndentSize)
    ? (raw.indentSize as CodeBlockIndentSize)
    : CODE_BLOCK_DEFAULTS.indentSize;
  const title = typeof raw.title === "string" ? raw.title : CODE_BLOCK_DEFAULTS.title;

  return {
    language,
    codeTheme,
    fontSize,
    indentMode,
    indentSize,
    wordWrap: typeof raw.wordWrap === "boolean" ? raw.wordWrap : CODE_BLOCK_DEFAULTS.wordWrap,
    lineNumbers:
      typeof raw.lineNumbers === "boolean" ? raw.lineNumbers : CODE_BLOCK_DEFAULTS.lineNumbers,
    autoIndent:
      typeof raw.autoIndent === "boolean" ? raw.autoIndent : CODE_BLOCK_DEFAULTS.autoIndent,
    title,
    statusBarCollapsed:
      typeof raw.statusBarCollapsed === "boolean"
        ? raw.statusBarCollapsed
        : CODE_BLOCK_DEFAULTS.statusBarCollapsed,
    codeCollapsed:
      typeof raw.codeCollapsed === "boolean" ? raw.codeCollapsed : CODE_BLOCK_DEFAULTS.codeCollapsed,
  };
}

export function extractCodeText(node: TiptapNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map((child) => extractCodeText(child)).join("");
}

export function escapeCodeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

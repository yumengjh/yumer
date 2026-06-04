import type { ThemedToken } from "shiki";
import { escapeCodeHtml } from "./codeBlockOptions";

export function splitCodeLines(code: string): string[] {
  if (code === "") return [""];
  return code.split("\n");
}

export function countCodeLines(code: string): number {
  return splitCodeLines(code).length;
}

const fontStyleToCss = (fontStyle?: number): string[] => {
  if (typeof fontStyle !== "number" || fontStyle <= 0) return [];
  const styles: string[] = [];
  if (fontStyle & 1) styles.push("font-style: italic");
  if (fontStyle & 2) styles.push("font-weight: 600");
  if (fontStyle & 4) styles.push("text-decoration: underline");
  return styles;
};

export const tokenStylesToCssText = (token: ThemedToken): string => {
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

export const tokenLineToHtml = (line: ThemedToken[]): string => {
  return line
    .map((token) => {
      const style = tokenStylesToCssText(token);
      const content = escapeCodeHtml(token.content);
      if (!style) return content;
      return `<span class="tiptap-shiki-token" style="${style}">${content}</span>`;
    })
    .join("");
};

export type RenderCodeBlockBodyOptions = {
  code: string;
  lineNumbers: boolean;
  /** HTML per line; length must match `splitCodeLines(code)`. */
  lineContents?: string[];
};

/**
 * Renders the code body for static / client-rendered code blocks.
 * Uses one flex row per line so line numbers stay aligned with highlighted code.
 */
export function renderCodeBlockBodyHtml({
  code,
  lineNumbers,
  lineContents,
}: RenderCodeBlockBodyOptions): string {
  const lines = splitCodeLines(code);
  const contents = lineContents ?? lines.map((line) => escapeCodeHtml(line));
  const rowCount = lineContents ? Math.max(lines.length, lineContents.length) : lines.length;

  if (!lineNumbers) {
    const inner =
      lineContents && lineContents.length > 0
        ? contents.join("\n")
        : escapeCodeHtml(code);
    return [
      `<div class="code-block-body">`,
      `<div class="code-block-content"><code>${inner}</code></div>`,
      `</div>`,
    ].join("");
  }

  const rows = Array.from({ length: rowCount }, (_, index) => {
      const lineHtml = contents[index] ?? "";
      return [
        `<div class="code-block-line">`,
        `<div class="code-block-line-number" aria-hidden="true">${index + 1}</div>`,
        `<code class="code-block-line-content">${lineHtml}</code>`,
        `</div>`,
      ].join("");
    }).join("");

  return [
    `<div class="code-block-body has-line-numbers">`,
    `<div class="code-block-lines">${rows}</div>`,
    `</div>`,
  ].join("");
}

import { describe, expect, it } from "vitest";
import {
  CODE_BLOCK_DEFAULTS,
  escapeCodeHtml,
  extractCodeText,
  normalizeCodeBlockAttrs,
} from "./codeBlockOptions";
import { getCodeThemeByName } from "./codeHighlight";

describe("codeBlockOptions", () => {
  it("normalizes missing and invalid attrs to defaults", () => {
    expect(
      normalizeCodeBlockAttrs({
        language: "",
        codeTheme: "unknown",
        fontSize: "48px",
        indentMode: "weird",
        indentSize: 6,
        wordWrap: "yes",
        lineNumbers: "no",
        autoIndent: null,
        title: 42,
        statusBarCollapsed: "false",
        codeCollapsed: 1,
      }),
    ).toEqual(CODE_BLOCK_DEFAULTS);
  });

  it("keeps valid attrs and normalizes language while preserving title text", () => {
    expect(
      normalizeCodeBlockAttrs({
        language: " TypeScript ",
        codeTheme: "github-dark",
        fontSize: "14px",
        indentMode: "tab",
        indentSize: 4,
        wordWrap: true,
        lineNumbers: false,
        autoIndent: false,
        title: "  Example  ",
        statusBarCollapsed: true,
        codeCollapsed: true,
      }),
    ).toEqual({
      language: "typescript",
      codeTheme: "github-dark",
      fontSize: "14px",
      indentMode: "tab",
      indentSize: 4,
      wordWrap: true,
      lineNumbers: false,
      autoIndent: false,
      title: "  Example  ",
      statusBarCollapsed: true,
      codeCollapsed: true,
    });
  });

  it("extracts text from a Tiptap code block node", () => {
    expect(
      extractCodeText({
        type: "codeBlock",
        content: [
          { type: "text", text: "const a = 1;" },
          { type: "text", text: "\nconsole.log(a);" },
        ],
      }),
    ).toBe("const a = 1;\nconsole.log(a);");
  });

  it("escapes HTML-sensitive code text", () => {
    expect(escapeCodeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });

  it("accepts only loaded Shiki code block themes by name", () => {
    expect(getCodeThemeByName("github-light")).toBe("github-light");
    expect(getCodeThemeByName("github-dark")).toBe("github-dark");
    expect(getCodeThemeByName("auto")).toBeNull();
    expect(getCodeThemeByName("unknown")).toBeNull();
  });
});

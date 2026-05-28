import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import CodeBlock from "@tiptap/extension-code-block";
import {
  cleanupCodeBlocks,
  isCodeBlockEmpty,
  removeTrailingBlankLines,
} from "./codeBlockCleanup";

const TestCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      statusBarCollapsed: {
        default: null,
      },
      lineNumbers: {
        default: null,
      },
      title: {
        default: null,
      },
      codeCollapsed: {
        default: null,
      },
      language: {
        default: null,
      },
    };
  },
});

function createEditor(content: Record<string, unknown>) {
  return new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), TestCodeBlock],
    content,
  });
}

describe("removeTrailingBlankLines", () => {
  it("removes one trailing blank line", () => {
    expect(removeTrailingBlankLines("const a = 1;\n")).toBe("const a = 1;");
  });

  it("removes multiple trailing blank lines and trailing whitespace-only lines", () => {
    expect(removeTrailingBlankLines("line 1\nline 2\n   \n\t\n")).toBe("line 1\nline 2");
  });

  it("preserves internal blank lines", () => {
    expect(removeTrailingBlankLines("line 1\n\nline 3\n")).toBe("line 1\n\nline 3");
  });

  it("keeps content unchanged when no trailing blank line exists", () => {
    expect(removeTrailingBlankLines("line 1\n\nline 3")).toBe("line 1\n\nline 3");
  });
});

describe("isCodeBlockEmpty", () => {
  it("treats whitespace-only content as empty", () => {
    expect(isCodeBlockEmpty("   \n\t ")).toBe(true);
  });

  it("treats visible content as non-empty", () => {
    expect(isCodeBlockEmpty("const a = 1;\n")).toBe(false);
  });
});

describe("cleanupCodeBlocks", () => {
  it("removes trailing blank lines across all code blocks", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "codeBlock", content: [{ type: "text", text: "a\n" }] },
        { type: "paragraph", content: [{ type: "text", text: "x" }] },
        { type: "codeBlock", content: [{ type: "text", text: "b\n\n" }] },
      ],
    });

    const result = cleanupCodeBlocks(editor, "removeTrailingBlankLines");

    expect(result).toEqual({ changed: true, affectedCount: 2 });
    expect(editor.getJSON()).toMatchObject({
      content: [
        { type: "codeBlock", content: [{ type: "text", text: "a" }] },
        { type: "paragraph", content: [{ type: "text", text: "x" }] },
        { type: "codeBlock", content: [{ type: "text", text: "b" }] },
      ],
    });
    editor.destroy();
  });

  it("deletes whitespace-only code blocks", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "codeBlock", content: [{ type: "text", text: "   \n" }] },
        { type: "codeBlock", content: [{ type: "text", text: "keep me" }] },
        { type: "codeBlock", content: [{ type: "text", text: "\n\t" }] },
      ],
    });

    const result = cleanupCodeBlocks(editor, "removeEmptyCodeBlocks");

    expect(result).toEqual({ changed: true, affectedCount: 2 });
    expect(editor.getJSON()).toMatchObject({
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "codeBlock", content: [{ type: "text", text: "keep me" }] },
      ],
    });
    editor.destroy();
  });

  it("returns unchanged result when nothing matches", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "plain" }] },
        { type: "codeBlock", content: [{ type: "text", text: "const a = 1;" }] },
      ],
    });

    expect(cleanupCodeBlocks(editor, "removeEmptyCodeBlocks")).toEqual({
      changed: false,
      affectedCount: 0,
    });
    editor.destroy();
  });

  it("collapses all code block status bars while preserving unrelated attrs", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: {
            language: "typescript",
            title: "A",
            statusBarCollapsed: false,
            codeCollapsed: true,
          },
          content: [{ type: "text", text: "a" }],
        },
        {
          type: "codeBlock",
          attrs: {
            language: "javascript",
            title: "B",
            statusBarCollapsed: true,
            codeCollapsed: false,
          },
          content: [{ type: "text", text: "b" }],
        },
      ],
    });

    const result = cleanupCodeBlocks(editor, "collapseStatusBars");

    expect(result).toEqual({ changed: true, affectedCount: 1 });
    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          type: "codeBlock",
          attrs: {
            language: "typescript",
            title: "A",
            statusBarCollapsed: true,
            codeCollapsed: true,
          },
        },
        {
          type: "codeBlock",
          attrs: {
            language: "javascript",
            title: "B",
            statusBarCollapsed: true,
            codeCollapsed: false,
          },
        },
      ],
    });
    editor.destroy();
  });

  it("expands all code block status bars and reports unchanged when already expanded", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "codeBlock", attrs: { statusBarCollapsed: true }, content: [{ type: "text", text: "x" }] },
        { type: "codeBlock", attrs: { statusBarCollapsed: false }, content: [{ type: "text", text: "y" }] },
      ],
    });

    expect(cleanupCodeBlocks(editor, "expandStatusBars")).toEqual({
      changed: true,
      affectedCount: 1,
    });
    expect(cleanupCodeBlocks(editor, "expandStatusBars")).toEqual({
      changed: false,
      affectedCount: 0,
    });
    editor.destroy();
  });

  it("enables line numbers for all code blocks currently disabled", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "codeBlock", attrs: { lineNumbers: false, title: "off" }, content: [{ type: "text", text: "a" }] },
        { type: "codeBlock", attrs: { lineNumbers: true, title: "on" }, content: [{ type: "text", text: "b" }] },
      ],
    });

    const result = cleanupCodeBlocks(editor, "enableLineNumbers");

    expect(result).toEqual({ changed: true, affectedCount: 1 });
    expect(editor.getJSON()).toMatchObject({
      content: [
        { type: "codeBlock", attrs: { lineNumbers: true, title: "off" } },
        { type: "codeBlock", attrs: { lineNumbers: true, title: "on" } },
      ],
    });
    editor.destroy();
  });

  it("disables line numbers for all code blocks and reports unchanged when already disabled", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "codeBlock", attrs: { lineNumbers: true }, content: [{ type: "text", text: "a" }] },
        { type: "codeBlock", attrs: { lineNumbers: false }, content: [{ type: "text", text: "b" }] },
      ],
    });

    expect(cleanupCodeBlocks(editor, "disableLineNumbers")).toEqual({
      changed: true,
      affectedCount: 1,
    });
    expect(cleanupCodeBlocks(editor, "disableLineNumbers")).toEqual({
      changed: false,
      affectedCount: 0,
    });
    editor.destroy();
  });
});

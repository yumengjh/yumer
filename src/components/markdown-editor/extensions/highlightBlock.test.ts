// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { HighlightBlock, DEFAULT_HIGHLIGHT_BLOCK_COLOR } from "./highlightBlock";

const editors: Editor[] = [];

function createEditor(content: Record<string, unknown>) {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        bold: false,
      }),
      Bold.extend({ addInputRules: () => [] }),
      HighlightBlock,
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

describe("HighlightBlock", () => {
  afterEach(() => {
    while (editors.length > 0) {
      editors.pop()?.destroy();
    }
  });

  it("wraps a whole selected paragraph into a highlight block", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "hello world" }],
        },
      ],
    });

    editor.commands.setTextSelection({ from: 1, to: 12 });

    expect(editor.commands.toggleHighlightBlockFromSelection()).toBe(true);

    const json = editor.getJSON();
    expect(json.type).toBe("doc");
    expect(json.content?.[0]).toMatchObject({
      type: "highlightBlock",
      attrs: { backgroundColor: DEFAULT_HIGHLIGHT_BLOCK_COLOR },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "hello world" }],
        },
      ],
    });
  });

  it("splits a selected range in a paragraph into before/highlight/after blocks", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ab" },
            { type: "text", text: "cd", marks: [{ type: "bold" }] },
            { type: "text", text: "ef" },
          ],
        },
      ],
    });

    editor.commands.setTextSelection({ from: 3, to: 5 });

    expect(editor.commands.toggleHighlightBlockFromSelection()).toBe(true);

    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "ab" }],
        },
        {
          type: "highlightBlock",
          attrs: { backgroundColor: DEFAULT_HIGHLIGHT_BLOCK_COLOR },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "cd", marks: [{ type: "bold" }] }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "ef" }],
        },
      ],
    });
  });

  it("unwraps a selected range from an existing highlight block", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "highlightBlock",
          attrs: { backgroundColor: "#FDE68A" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "abcdef" }],
            },
          ],
        },
      ],
    });

    editor.commands.setTextSelection({ from: 4, to: 6 });

    expect(editor.commands.toggleHighlightBlockFromSelection()).toBe(true);

    const json = editor.getJSON();
    expect(json.type).toBe("doc");
    expect(json.content?.slice(0, 3)).toMatchObject([
      {
        type: "highlightBlock",
        attrs: { backgroundColor: "#FDE68A" },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "ab" }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "cd" }],
      },
      {
        type: "highlightBlock",
        attrs: { backgroundColor: "#FDE68A" },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "ef" }],
          },
        ],
      },
    ]);
  });

  it("converts a fully selected highlight block back to a normal paragraph", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "highlightBlock",
          attrs: { backgroundColor: "#FDE68A" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "abcdef" }],
            },
          ],
        },
      ],
    });

    editor.commands.setTextSelection({ from: 2, to: 8 });

    expect(editor.commands.toggleHighlightBlockFromSelection()).toBe(true);

    const json = editor.getJSON();
    expect(json.type).toBe("doc");
    expect(json.content?.[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "abcdef" }],
    });
  });
});

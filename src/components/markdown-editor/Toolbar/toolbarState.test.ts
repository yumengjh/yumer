// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Bold from "@tiptap/extension-bold";
import TextAlign from "@tiptap/extension-text-align";
import { describe, expect, it } from "vitest";
import {
  getToolbarState,
  isToolbarItemActive,
  runInlineMarkCommand,
} from "./toolbarState";

function createEditor(content: Record<string, unknown>): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        bold: false,
      }),
      Bold.extend({ addInputRules: () => [] }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
    ],
    content,
  });
}

describe("toolbarState", () => {
  it("marks bold active when any part of a text selection is bold", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " plain" },
          ],
        },
      ],
    });

    editor.commands.setTextSelection({ from: 1, to: 17 });

    expect(isToolbarItemActive(getToolbarState(editor), "bold")).toBe(true);

    editor.destroy();
  });

  it("unsets a mark from a mixed selection instead of adding it to the whole selection", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " plain" },
          ],
        },
      ],
    });

    editor.commands.setTextSelection({ from: 1, to: 17 });

    runInlineMarkCommand(editor, "bold");

    expect(isToolbarItemActive(getToolbarState(editor), "bold")).toBe(false);
    expect(editor.getHTML()).toBe("<p>plain bold plain</p>");

    editor.destroy();
  });

  it("uses cursor marks and block context for collapsed selections", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, textAlign: "center" },
          content: [{ type: "text", text: "Title", marks: [{ type: "bold" }] }],
        },
      ],
    });

    editor.commands.setTextSelection(3);

    const state = getToolbarState(editor);

    expect(isToolbarItemActive(state, "bold")).toBe(true);
    expect(state.headingLevel).toBe(2);
    expect(state.textAlign).toBe("center");

    editor.destroy();
  });

  it("tracks list and quote context from the current block", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "quoted item" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    editor.commands.setTextSelection(5);

    const state = getToolbarState(editor);

    expect(isToolbarItemActive(state, "blockquote")).toBe(true);
    expect(isToolbarItemActive(state, "bullet-list")).toBe(true);

    editor.destroy();
  });
});

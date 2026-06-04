import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { convertSelectedListsToInlineParagraph } from "./listInlineCleanup";

function createEditor(content: Record<string, unknown>): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    content,
  });

  editor.commands.selectAll();
  return editor;
}

describe("convertSelectedListsToInlineParagraph", () => {
  it("converts a bullet list to a paragraph joined by Chinese commas", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "苹果" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "香蕉" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "橘子" }] }],
            },
          ],
        },
      ],
    });

    const result = convertSelectedListsToInlineParagraph(editor);

    expect(result).toEqual({ changed: true, affectedCount: 1 });
    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "苹果，香蕉，橘子" },
          ],
        },
      ],
    });

    editor.destroy();
  });

  it("flattens nested task and bullet lists while preserving inline marks", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", marks: [{ type: "bold" }], text: "父项" },
                  ],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            {
                              type: "text",
                              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
                              text: "子项链接",
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", marks: [{ type: "code" }], text: "code" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const result = convertSelectedListsToInlineParagraph(editor);

    expect(result).toEqual({ changed: true, affectedCount: 1 });
    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "父项" },
            {
              type: "text",
              text: "，",
            },
            {
              type: "text",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
              text: "子项链接",
            },
            {
              type: "text",
              text: "，",
            },
            { type: "text", marks: [{ type: "code" }], text: "code" },
          ],
        },
      ],
    });

    editor.destroy();
  });

  it("returns unchanged when the selection contains no list", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "普通段落" }],
        },
      ],
    });

    expect(convertSelectedListsToInlineParagraph(editor)).toEqual({
      changed: false,
      affectedCount: 0,
    });

    editor.destroy();
  });
});

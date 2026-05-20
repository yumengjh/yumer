// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockIdAttribute } from "../extensions/blockIdAttribute";
import { patchEditorBlockIdentityFromDoc, patchEditorDocumentIdentity } from "../editorIdentity";

describe("markdown editor identity patching", () => {
  it("patches missing block identity without moving the current selection", () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        BlockIdAttribute,
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { blockId: null, clientId: null },
            content: [{ type: "text", text: "# 标题" }],
          },
          {
            type: "paragraph",
            attrs: { blockId: null, clientId: null },
            content: [{ type: "text", text: "正文" }],
          },
        ],
      },
    });

    editor.commands.setTextSelection(5);
    const selectionBeforePatch = editor.state.selection.from;

    const patched = patchEditorDocumentIdentity(editor);

    expect(patched).toBe(true);
    expect(editor.state.selection.from).toBe(selectionBeforePatch);
    const json = editor.getJSON() as any;
    expect(json.content[0].attrs.clientId).toMatch(/^cid_/);
    expect(json.content[1].attrs.clientId).toMatch(/^cid_/);

    editor.destroy();
  });

  it("applies synced block ids from external content without moving selection", () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        BlockIdAttribute,
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { blockId: null, clientId: "client-current" },
            content: [{ type: "text", text: "typing" }],
          },
          {
            type: "paragraph",
            attrs: { blockId: null, clientId: "client-empty-next" },
          },
        ],
      },
    });

    editor.commands.setTextSelection(3);
    const selectionBeforePatch = editor.state.selection.from;

    const patched = patchEditorBlockIdentityFromDoc(editor, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            blockId: "server-current",
            "data-block-id": "server-current",
            clientId: "client-current",
          },
          content: [{ type: "text", text: "typing" }],
        },
        {
          type: "paragraph",
          attrs: {
            blockId: "server-empty-next",
            "data-block-id": "server-empty-next",
            clientId: "client-empty-next",
          },
        },
      ],
    } as any);

    expect(patched).toBe(true);
    expect(editor.state.selection.from).toBe(selectionBeforePatch);
    const json = editor.getJSON() as any;
    expect(json.content[0].attrs.blockId).toBe("server-current");
    expect(json.content[1].attrs.blockId).toBe("server-empty-next");

    editor.destroy();
  });

});

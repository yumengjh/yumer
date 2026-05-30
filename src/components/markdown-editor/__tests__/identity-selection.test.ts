// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { TiptapDoc } from "@/services/tiptap-converter";
import { BlockIdAttribute } from "../extensions/blockIdAttribute";
import {
  patchEditorBlockIdentityFromDoc,
  patchEditorDocumentIdentity,
} from "../editorIdentity";

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
    const json = editor.getJSON() as TiptapDoc;
    expect(json.content[0]?.attrs?.clientId).toMatch(/^cid_/);
    expect(json.content[1]?.attrs?.clientId).toMatch(/^cid_/);

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
    } as TiptapDoc);

    expect(patched).toBe(true);
    expect(editor.state.selection.from).toBe(selectionBeforePatch);
    const json = editor.getJSON() as TiptapDoc;
    expect(json.content[0]?.attrs?.blockId).toBe("server-current");
    expect(json.content[1]?.attrs?.blockId).toBe("server-empty-next");

    editor.destroy();
  });

  it("applies synced block ids and sort keys without moving selection", () => {
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
            attrs: {
              blockId: null,
              clientId: "client-new-blank",
              sortKey: null,
            },
          },
          {
            type: "paragraph",
            attrs: {
              blockId: "server-1",
              clientId: "client-1",
              sortKey: "001000",
            },
            content: [{ type: "text", text: "1" }],
          },
          {
            type: "paragraph",
            attrs: {
              blockId: "server-2",
              clientId: "client-2",
              sortKey: "002000",
            },
            content: [{ type: "text", text: "2" }],
          },
          {
            type: "paragraph",
            attrs: {
              blockId: "server-3",
              clientId: "client-3",
              sortKey: "003000",
            },
            content: [{ type: "text", text: "3" }],
          },
        ],
      },
    });

    editor.commands.setTextSelection(1);
    const selectionBeforePatch = editor.state.selection.from;

    const patched = patchEditorBlockIdentityFromDoc(editor, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            blockId: "server-new-blank",
            "data-block-id": "server-new-blank",
            clientId: "client-new-blank",
            sortKey: "000500",
          },
        },
        {
          type: "paragraph",
          attrs: {
            blockId: "server-1",
            clientId: "client-1",
            sortKey: "001000",
          },
          content: [{ type: "text", text: "1" }],
        },
        {
          type: "paragraph",
          attrs: {
            blockId: "server-2",
            clientId: "client-2",
            sortKey: "002000",
          },
          content: [{ type: "text", text: "2" }],
        },
        {
          type: "paragraph",
          attrs: {
            blockId: "server-3",
            clientId: "client-3",
            sortKey: "003000",
          },
          content: [{ type: "text", text: "3" }],
        },
      ],
    } as TiptapDoc);

    expect(patched).toBe(true);
    expect(editor.state.selection.from).toBe(selectionBeforePatch);
    const json = editor.getJSON() as TiptapDoc;
    expect(json.content[0]?.attrs?.blockId).toBe("server-new-blank");
    expect(json.content[0]?.attrs?.sortKey).toBe("000500");

    editor.destroy();
  });

  it("clears inherited sort keys when assigning a fresh identity to a duplicated block", () => {
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
            attrs: {
              blockId: "server-1",
              clientId: "client-1",
              sortKey: "001000",
              "data-sort-key": "001000",
            },
            content: [{ type: "text", text: "first" }],
          },
          {
            type: "paragraph",
            attrs: {
              blockId: "server-1",
              clientId: "client-1",
              sortKey: "001000",
              "data-sort-key": "001000",
            },
            content: [{ type: "text", text: "split" }],
          },
        ],
      },
    });

    const patched = patchEditorDocumentIdentity(editor);

    expect(patched).toBe(true);
    const json = editor.getJSON() as TiptapDoc;
    expect(json.content[1]?.attrs?.clientId).toMatch(/^cid_/);
    expect(json.content[1]?.attrs?.clientId).not.toBe("client-1");
    expect(json.content[1]?.attrs?.blockId).toBeNull();
    expect(json.content[1]?.attrs?.sortKey).toBeNull();
    expect(json.content[1]?.attrs?.["data-sort-key"]).toBeUndefined();

    editor.destroy();
  });
});

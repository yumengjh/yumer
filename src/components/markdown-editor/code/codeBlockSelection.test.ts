import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import CodeBlock from "@tiptap/extension-code-block";
import { getCodeBlockTextRange, selectAllCodeBlockText } from "./codeBlockSelection";

describe("codeBlockSelection", () => {
  const createEditor = (code: string) => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        CodeBlock,
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "codeBlock",
            content: code ? [{ type: "text", text: code }] : [],
          },
        ],
      },
    });
    editor.commands.focus("end");
    return editor;
  };

  it("returns the inner text range for a code block", () => {
    const editor = createEditor("hello\nworld");
    const range = getCodeBlockTextRange(editor.state);
    expect(range).not.toBeNull();
    const selected = editor.state.doc.textBetween(range!.from, range!.to, "\n");
    expect(selected).toBe("hello\nworld");
    editor.destroy();
  });

  it("selects only code block text on Mod-a", () => {
    const editor = createEditor("alpha");
    const ok = selectAllCodeBlockText(editor);
    expect(ok).toBe(true);

    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("alpha");
    editor.destroy();
  });
});

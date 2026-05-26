import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export const CODE_BLOCK_NODE_NAME = "codeBlock";

export function getCodeBlockTextRange(
  state: EditorState,
  anchorPos?: number,
): { from: number; to: number } | null {
  const $pos = state.doc.resolve(anchorPos ?? state.selection.from);

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name !== CODE_BLOCK_NODE_NAME) continue;

    const blockPos = $pos.before(depth);
    return {
      from: blockPos + 1,
      to: blockPos + node.nodeSize - 1,
    };
  }

  return null;
}

export function selectAllCodeBlockText(editor: Editor): boolean {
  const range = getCodeBlockTextRange(editor.state);
  if (!range) return false;
  return editor.commands.setTextSelection(range);
}

export function dispatchSelectAllCodeBlockText(view: EditorView): boolean {
  const range = getCodeBlockTextRange(view.state);
  if (!range) return false;

  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to));
  view.dispatch(tr);
  return true;
}

export function isSelectAllKey(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
}

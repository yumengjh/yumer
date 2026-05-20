import type { Editor } from "@tiptap/core";
import { BLOCK_IDENTITY_NODE_TYPES, createClientId, readIdentityFromAttrs } from "@/services/sync/identity";

export const BLOCK_IDENTITY_PATCH_META = "markdownEditor:blockIdentityPatch";

const IDENTITY_BLOCK_NODE_TYPES = new Set<string>(BLOCK_IDENTITY_NODE_TYPES);

type EditorLike = Pick<Editor, "state" | "view">;

/**
 * 为顶层块补齐同步身份，但只修改节点 attrs，不重建整篇文档。
 *
 * 之前在 onUpdate 中通过 setContent(ensureDocumentIdentity(json)) 回写整篇文档，
 * ProseMirror 会把 selection 重新映射到文档末尾；在 `# `、列表、引用等 Markdown
 * input rule 生效时表现为光标自动跳到下一行/下一块。
 */
export function patchEditorDocumentIdentity(editor: EditorLike): boolean {
  const { state, view } = editor;
  const tr = state.tr;
  const seenClientIds = new Set<string>();
  const seenBlockIds = new Set<string>();

  state.doc.forEach((node, offset) => {
    if (!IDENTITY_BLOCK_NODE_TYPES.has(node.type.name)) return;

    const identity = readIdentityFromAttrs(node.attrs);
    const attrs = { ...node.attrs };
    let changed = false;

    let clientId = identity.clientId;
    if (!clientId || seenClientIds.has(clientId)) {
      clientId = createClientId();
      attrs.clientId = clientId;
      changed = true;
    } else if (attrs.clientId !== clientId) {
      attrs.clientId = clientId;
      changed = true;
    }
    seenClientIds.add(clientId);

    const blockId = identity.blockId;
    if (blockId) {
      if (seenBlockIds.has(blockId)) {
        if (attrs.blockId !== null || attrs["data-block-id"] !== undefined) {
          attrs.blockId = null;
          delete attrs["data-block-id"];
          changed = true;
        }
      } else {
        seenBlockIds.add(blockId);
        if (attrs.blockId !== blockId) {
          attrs.blockId = blockId;
          changed = true;
        }
      }
    }

    if (changed) {
      tr.setNodeMarkup(offset, undefined, attrs, node.marks);
    }
  });

  if (!tr.docChanged) return false;

  tr.setMeta(BLOCK_IDENTITY_PATCH_META, true);
  tr.setMeta("addToHistory", false);
  tr.setSelection(state.selection.map(tr.doc, tr.mapping));
  view.dispatch(tr);
  return true;
}

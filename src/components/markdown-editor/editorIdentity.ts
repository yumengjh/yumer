import type { Editor } from "@tiptap/core";
import type { TiptapDoc, TiptapNode } from "@/services/tiptap-converter";
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

function stripIdentityAttrs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripIdentityAttrs(item));
  if (!value || typeof value !== "object") return value;

  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    const next = stripIdentityAttrs(raw[key]);
    if (next === undefined) continue;
    out[key] = next;
  }

  if (out.attrs && typeof out.attrs === "object" && !Array.isArray(out.attrs)) {
    const attrs = { ...(out.attrs as Record<string, unknown>) };
    delete attrs.blockId;
    delete attrs.clientId;
    delete attrs["data-block-id"];
    delete attrs["data-client-id"];
    out.attrs = attrs;
  }

  return out;
}

function sameNodeWithoutIdentity(left: TiptapNode, right: TiptapNode): boolean {
  return JSON.stringify(stripIdentityAttrs(left)) === JSON.stringify(stripIdentityAttrs(right));
}

/**
 * 将服务端同步确认返回的 blockId 写回编辑器，但只在内容本身完全一致时处理。
 *
 * 自动同步 create ack 只会补齐 blockId。如果直接让 React 外部 content 触发
 * editor.commands.setContent，会重建文档并把光标推到后续空块；这里用事务只更新 attrs。
 */
export function patchEditorBlockIdentityFromDoc(editor: EditorLike, nextDoc: TiptapDoc): boolean {
  const nextNodes = Array.isArray(nextDoc.content) ? nextDoc.content : [];
  if (editor.state.doc.childCount !== nextNodes.length) return false;

  const tr = editor.state.tr;

  for (let index = 0; index < nextNodes.length; index += 1) {
    const currentNode = editor.state.doc.child(index);
    const nextNode = nextNodes[index];
    if (currentNode.type.name !== nextNode.type) return false;

    const currentJson = currentNode.toJSON() as TiptapNode;
    if (!sameNodeWithoutIdentity(currentJson, nextNode)) return false;

    const currentIdentity = readIdentityFromAttrs(currentNode.attrs);
    const nextIdentity = readIdentityFromAttrs(nextNode.attrs);

    if (
      currentIdentity.clientId &&
      nextIdentity.clientId &&
      currentIdentity.clientId !== nextIdentity.clientId
    ) {
      return false;
    }

    const nextAttrs = { ...currentNode.attrs };
    let changed = false;

    if (nextIdentity.clientId && currentNode.attrs.clientId !== nextIdentity.clientId) {
      nextAttrs.clientId = nextIdentity.clientId;
      changed = true;
    }

    const nextBlockId = nextIdentity.blockId ?? null;
    if ((currentNode.attrs.blockId ?? null) !== nextBlockId) {
      nextAttrs.blockId = nextBlockId;
      changed = true;
    }

    if (changed) {
      tr.setNodeMarkup(tr.doc.resolve(0).posAtIndex(index, 0), undefined, nextAttrs, currentNode.marks);
    }
  }

  if (!tr.docChanged) return false;

  tr.setMeta(BLOCK_IDENTITY_PATCH_META, true);
  tr.setMeta("addToHistory", false);
  tr.setSelection(editor.state.selection.map(tr.doc, tr.mapping));
  editor.view.dispatch(tr);
  return true;
}

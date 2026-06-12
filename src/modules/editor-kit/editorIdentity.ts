import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PmNode } from "@tiptap/pm/model";
import {
  BLOCK_IDENTITY_NODE_TYPES,
  createClientId,
  readIdentityFromAttrs,
} from "./utils/identity";
import type { TiptapDoc, TiptapNode } from "./types";

export const BLOCK_IDENTITY_PATCH_META = "markdownEditor:blockIdentityPatch";

const IDENTITY_BLOCK_NODE_TYPES = new Set<string>(BLOCK_IDENTITY_NODE_TYPES);

type EditorLike = Pick<Editor, "state" | "view">;

function clearTransientSyncAttrs(attrs: Record<string, unknown>) {
  delete attrs.syncCreateId;
  delete attrs.clientBatchId;
  delete attrs["data-sync-create-id"];
}

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

  state.doc.descendants((node, pos) => {
    if (!IDENTITY_BLOCK_NODE_TYPES.has(node.type.name)) return;

    const identity = readIdentityFromAttrs(node.attrs);
    const attrs = { ...node.attrs };
    let changed = false;
    let freshIdentity = false;

    let clientId = identity.clientId;
    if (!clientId || seenClientIds.has(clientId)) {
      clientId = createClientId();
      attrs.clientId = clientId;
      changed = true;
      freshIdentity = true;
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
          freshIdentity = true;
        }
      } else {
        seenBlockIds.add(blockId);
        if (attrs.blockId !== blockId) {
          attrs.blockId = blockId;
          changed = true;
        }
      }
    }

    if (freshIdentity) {
      if (attrs.sortKey !== null) {
        attrs.sortKey = null;
        changed = true;
      }
      if (attrs["data-sort-key"] !== undefined) {
        delete attrs["data-sort-key"];
        changed = true;
      }
    }

    if (changed) {
      tr.setNodeMarkup(pos, undefined, attrs, node.marks);
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
  if (Array.isArray(value))
    return value.map((item) => stripIdentityAttrs(item));
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
    delete attrs.sortKey;
    delete attrs.syncCreateId;
    delete attrs.clientBatchId;
    delete attrs["data-block-id"];
    delete attrs["data-client-id"];
    delete attrs["data-sort-key"];
    delete attrs["data-sync-create-id"];
    out.attrs = attrs;
  }

  return out;
}

function sameNodeWithoutIdentity(left: TiptapNode, right: TiptapNode): boolean {
  return (
    JSON.stringify(stripIdentityAttrs(left)) ===
    JSON.stringify(stripIdentityAttrs(right))
  );
}

function hasMatchingDocumentContent(
  editor: EditorLike,
  nextNodes: TiptapNode[],
): boolean {
  if (editor.state.doc.childCount !== nextNodes.length) return false;

  for (let index = 0; index < nextNodes.length; index += 1) {
    const currentNode = editor.state.doc.child(index);
    const nextNode = nextNodes[index];
    if (currentNode.type.name !== nextNode.type) return false;
    if (!sameNodeWithoutIdentity(currentNode.toJSON() as TiptapNode, nextNode)) {
      return false;
    }

    const currentIdentity = readIdentityFromAttrs(currentNode.attrs);
    const nextIdentity = readIdentityFromAttrs(nextNode.attrs);
    if (
      currentIdentity.clientId &&
      nextIdentity.clientId &&
      currentIdentity.clientId !== nextIdentity.clientId
    ) {
      return false;
    }
  }

  return true;
}

function patchEditorBlockIdentityByClientIdFromDoc(
  editor: EditorLike,
  nextNodes: TiptapNode[],
): boolean {
  const nextByClientId = new Map<string, TiptapNode>();
  for (const node of nextNodes) {
    const identity = readIdentityFromAttrs(node.attrs);
    if (identity.clientId) nextByClientId.set(identity.clientId, node);
  }
  if (nextByClientId.size === 0) return false;

  const tr = editor.state.tr;
  let matched = 0;

  editor.state.doc.forEach((currentNode, offset) => {
    const currentIdentity = readIdentityFromAttrs(currentNode.attrs);
    if (!currentIdentity.clientId) return;
    const nextNode = nextByClientId.get(currentIdentity.clientId);
    if (!nextNode) return;
    if (currentNode.type.name !== nextNode.type) return;

    matched += 1;
    const nextIdentity = readIdentityFromAttrs(nextNode.attrs);
    const currentBlockId = currentIdentity.blockId ?? null;
    const nextBlockId = nextIdentity.blockId ?? null;
    const nextSortKey =
      typeof nextNode.attrs?.sortKey === "string"
        ? nextNode.attrs.sortKey
        : null;
    const nextAttrs = { ...currentNode.attrs };
    let changed = false;

    if (nextBlockId && currentBlockId !== nextBlockId) {
      nextAttrs.blockId = nextBlockId;
      nextAttrs["data-block-id"] = nextBlockId;
      clearTransientSyncAttrs(nextAttrs);
      changed = true;
    }

    if (
      !currentBlockId &&
      nextBlockId &&
      nextSortKey &&
      (currentNode.attrs.sortKey ?? null) !== nextSortKey
    ) {
      nextAttrs.sortKey = nextSortKey;
      nextAttrs["data-sort-key"] = nextSortKey;
      changed = true;
    }

    if (
      currentBlockId &&
      nextSortKey &&
      (currentNode.attrs.sortKey ?? null) !== nextSortKey
    ) {
      nextAttrs.sortKey = nextSortKey;
      nextAttrs["data-sort-key"] = nextSortKey;
      changed = true;
    }

    if (changed) {
      tr.setNodeMarkup(offset, undefined, nextAttrs, currentNode.marks);
    }
  });

  if (tr.docChanged) {
    tr.setMeta(BLOCK_IDENTITY_PATCH_META, true);
    tr.setMeta("addToHistory", false);
    tr.setSelection(editor.state.selection.map(tr.doc, tr.mapping));
    editor.view.dispatch(tr);
    return true;
  }

  return matched > 0;
}

function mergeIdentityAttrsFromNextNode(
  currentAttrs: Record<string, unknown>,
  nextNode: TiptapNode,
): Record<string, unknown> {
  const nextIdentity = readIdentityFromAttrs(nextNode.attrs);
  const nextAttrs = { ...currentAttrs };
  let changed = false;

  if (
    nextIdentity.clientId &&
    nextAttrs.clientId !== nextIdentity.clientId
  ) {
    nextAttrs.clientId = nextIdentity.clientId;
    changed = true;
  }

  const nextBlockId = nextIdentity.blockId ?? null;
  const currentBlockId =
    typeof nextAttrs.blockId === "string" ? nextAttrs.blockId : null;
  if (currentBlockId !== nextBlockId) {
    nextAttrs.blockId = nextBlockId;
    if (nextBlockId) {
      nextAttrs["data-block-id"] = nextBlockId;
      clearTransientSyncAttrs(nextAttrs);
    } else {
      delete nextAttrs["data-block-id"];
    }
    changed = true;
  }

  const nextSortKey =
    typeof nextNode.attrs?.sortKey === "string" ? nextNode.attrs.sortKey : null;
  if (nextSortKey && (nextAttrs.sortKey ?? null) !== nextSortKey) {
    nextAttrs.sortKey = nextSortKey;
    nextAttrs["data-sort-key"] = nextSortKey;
    changed = true;
  }

  return changed ? nextAttrs : currentAttrs;
}

function reorderEditorTopLevelToMatchDoc(
  editor: EditorLike,
  nextDoc: TiptapDoc,
): boolean {
  const nextNodes = Array.isArray(nextDoc.content) ? nextDoc.content : [];
  const { doc } = editor.state;
  if (doc.childCount !== nextNodes.length || nextNodes.length === 0) {
    return false;
  }

  const currentOrder = Array.from({ length: doc.childCount }, (_, index) => {
    const identity = readIdentityFromAttrs(doc.child(index).attrs);
    return identity.clientId ?? identity.blockId ?? null;
  });
  const targetOrder = nextNodes.map((node) => {
    const identity = readIdentityFromAttrs(node.attrs);
    return identity.clientId ?? identity.blockId ?? null;
  });
  if (JSON.stringify(currentOrder) === JSON.stringify(targetOrder)) {
    return false;
  }

  const nodesByClientId = new Map<string, PmNode>();
  doc.forEach((node) => {
    const identity = readIdentityFromAttrs(node.attrs);
    if (identity.clientId) nodesByClientId.set(identity.clientId, node);
  });

  const reordered: PmNode[] = [];
  for (const nextNode of nextNodes) {
    const identity = readIdentityFromAttrs(nextNode.attrs);
    const currentNode = identity.clientId
      ? nodesByClientId.get(identity.clientId)
      : undefined;
    if (!currentNode) return false;
    const mergedAttrs = mergeIdentityAttrsFromNextNode(
      { ...currentNode.attrs },
      nextNode,
    );
    reordered.push(
      mergedAttrs === currentNode.attrs
        ? currentNode
        : currentNode.type.create(
            mergedAttrs,
            currentNode.content,
            currentNode.marks,
          ),
    );
  }

  const tr = editor.state.tr;
  tr.replaceWith(0, doc.content.size, Fragment.from(reordered));
  tr.setMeta(BLOCK_IDENTITY_PATCH_META, true);
  tr.setMeta("addToHistory", false);
  tr.setSelection(editor.state.selection.map(tr.doc, tr.mapping));
  editor.view.dispatch(tr);
  return true;
}

export function patchEditorBlockIdentityFromMatchingDoc(
  editor: EditorLike,
  nextDoc: TiptapDoc,
): boolean {
  const nextNodes = Array.isArray(nextDoc.content) ? nextDoc.content : [];
  if (!hasMatchingDocumentContent(editor, nextNodes)) return false;
  return patchEditorBlockIdentityFromDoc(editor, nextDoc);
}

/**
 * 将服务端同步确认返回的 blockId 写回编辑器。
 *
 * 显式 ACK 回调允许按 clientId 匹配请求期间继续编辑的块，只用事务更新 attrs，
 * 避免 setContent 重建文档并移动光标。
 */
export function patchEditorBlockIdentityFromDoc(
  editor: EditorLike,
  nextDoc: TiptapDoc,
): boolean {
  const nextNodes = Array.isArray(nextDoc.content) ? nextDoc.content : [];
  if (!hasMatchingDocumentContent(editor, nextNodes)) {
    if (reorderEditorTopLevelToMatchDoc(editor, nextDoc)) {
      return true;
    }
    return patchEditorBlockIdentityByClientIdFromDoc(editor, nextNodes);
  }

  const tr = editor.state.tr;

  for (let index = 0; index < nextNodes.length; index += 1) {
    const currentNode = editor.state.doc.child(index);
    const nextNode = nextNodes[index];

    const currentIdentity = readIdentityFromAttrs(currentNode.attrs);
    const nextIdentity = readIdentityFromAttrs(nextNode.attrs);

    const nextAttrs = { ...currentNode.attrs };
    let changed = false;
    const currentBlockId = currentIdentity.blockId ?? null;

    if (
      nextIdentity.clientId &&
      currentNode.attrs.clientId !== nextIdentity.clientId
    ) {
      nextAttrs.clientId = nextIdentity.clientId;
      changed = true;
    }

    const nextBlockId = nextIdentity.blockId ?? null;
    if (currentBlockId !== nextBlockId) {
      nextAttrs.blockId = nextBlockId;
      if (nextBlockId) {
        nextAttrs["data-block-id"] = nextBlockId;
        clearTransientSyncAttrs(nextAttrs);
      } else {
        delete nextAttrs["data-block-id"];
      }
      changed = true;
    }

    const nextSortKey =
      typeof nextNode.attrs?.sortKey === "string"
        ? nextNode.attrs.sortKey
        : null;
    const canPatchCreateAckSortKey = !currentBlockId && Boolean(nextBlockId);
    if (
      canPatchCreateAckSortKey &&
      nextSortKey &&
      (currentNode.attrs.sortKey ?? null) !== nextSortKey
    ) {
      nextAttrs.sortKey = nextSortKey;
      nextAttrs["data-sort-key"] = nextSortKey;
      changed = true;
    }

    if (
      currentBlockId &&
      nextSortKey &&
      (currentNode.attrs.sortKey ?? null) !== nextSortKey
    ) {
      nextAttrs.sortKey = nextSortKey;
      nextAttrs["data-sort-key"] = nextSortKey;
      changed = true;
    }

    if (changed) {
      tr.setNodeMarkup(
        tr.doc.resolve(0).posAtIndex(index, 0),
        undefined,
        nextAttrs,
        currentNode.marks,
      );
    }
  }

  if (!tr.docChanged) return false;

  tr.setMeta(BLOCK_IDENTITY_PATCH_META, true);
  tr.setMeta("addToHistory", false);
  tr.setSelection(editor.state.selection.map(tr.doc, tr.mapping));
  editor.view.dispatch(tr);
  return true;
}

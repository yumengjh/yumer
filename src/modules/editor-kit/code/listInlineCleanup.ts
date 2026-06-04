import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import type { CodeCleanupResult } from "./codeBlockCleanup";

const LIST_NODE_NAMES = new Set(["bulletList", "orderedList", "taskList"]);
const LIST_ITEM_NODE_NAMES = new Set(["listItem", "taskItem"]);
const LIST_ITEM_SEPARATOR = "，";
const LIST_BLOCK_SEPARATOR = " ";

type ListTarget = {
  pos: number;
  node: ProseMirrorNode;
};

type ReplaceTarget = ListTarget & {
  nextNode: ProseMirrorNode;
};

function isListNode(node: ProseMirrorNode): boolean {
  return LIST_NODE_NAMES.has(node.type.name);
}

function hasListAncestor(doc: ProseMirrorNode, pos: number): boolean {
  const $pos = doc.resolve(pos);

  for (let depth = $pos.depth - 1; depth >= 0; depth -= 1) {
    if (LIST_NODE_NAMES.has($pos.node(depth).type.name)) {
      return true;
    }
  }

  return false;
}

function listIntersectsSelection(
  pos: number,
  node: ProseMirrorNode,
  selection: Selection,
): boolean {
  const from = pos;
  const to = pos + node.nodeSize;

  if (selection.empty) {
    return selection.from > from && selection.from < to;
  }

  return from < selection.to && to > selection.from;
}

function collectSelectedListTargets(
  doc: ProseMirrorNode,
  selection: Selection,
): ListTarget[] {
  const targets: ListTarget[] = [];

  doc.descendants((node, pos) => {
    if (!isListNode(node)) {
      return true;
    }

    if (!listIntersectsSelection(pos, node, selection)) {
      return true;
    }

    if (hasListAncestor(doc, pos)) {
      return false;
    }

    targets.push({ pos, node });
    return false;
  });

  return targets;
}

function extractInlineNodes(node: ProseMirrorNode): ProseMirrorNode[] {
  if (isListNode(node)) {
    return [];
  }

  if (node.isInline) {
    return [node];
  }

  const content: ProseMirrorNode[] = [];

  node.forEach((child) => {
    content.push(...extractInlineNodes(child));
  });

  return content;
}

function extractInlineNodesFromListItem(
  itemNode: ProseMirrorNode,
  schema: Schema,
): ProseMirrorNode[] {
  const content: ProseMirrorNode[] = [];

  itemNode.forEach((child) => {
    if (isListNode(child)) {
      return;
    }

    const segment = extractInlineNodes(child);
    if (segment.length === 0) {
      return;
    }

    if (content.length > 0) {
      content.push(schema.text(LIST_BLOCK_SEPARATOR));
    }

    content.push(...segment);
  });

  return content;
}

function buildInlineParagraphContent(
  listNode: ProseMirrorNode,
  schema: Schema,
): ProseMirrorNode[] {
  const content: ProseMirrorNode[] = [];

  listNode.descendants((node) => {
    if (!LIST_ITEM_NODE_NAMES.has(node.type.name)) {
      return true;
    }

    const segment = extractInlineNodesFromListItem(node, schema);
    if (segment.length === 0) {
      return true;
    }

    if (content.length > 0) {
      content.push(schema.text(LIST_ITEM_SEPARATOR));
    }

    content.push(...segment);
    return true;
  });

  return content;
}

export function convertSelectedListsToInlineParagraph(
  editor: Editor | null,
): CodeCleanupResult {
  if (!editor) {
    return { changed: false, affectedCount: 0 };
  }

  const { state, view } = editor;
  const paragraphType = state.schema.nodes.paragraph;

  if (!paragraphType) {
    return { changed: false, affectedCount: 0 };
  }

  const targets = collectSelectedListTargets(state.doc, state.selection)
    .map((target): ReplaceTarget | null => {
      const content = buildInlineParagraphContent(target.node, state.schema);
      if (content.length === 0) {
        return null;
      }

      return {
        ...target,
        nextNode: paragraphType.create(null, content),
      };
    })
    .filter((target): target is ReplaceTarget => target !== null)
    .sort((a, b) => b.pos - a.pos);

  if (targets.length === 0) {
    return { changed: false, affectedCount: 0 };
  }

  const tr = state.tr;

  for (const target of targets) {
    tr.replaceWith(target.pos, target.pos + target.node.nodeSize, target.nextNode);
  }

  view.dispatch(tr);

  return {
    changed: true,
    affectedCount: targets.length,
  };
}

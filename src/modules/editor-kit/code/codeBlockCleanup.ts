import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { normalizeCodeBlockAttrs } from "./codeBlockOptions";

export type CodeCleanupActionKey =
  | "removeTrailingBlankLines"
  | "removeEmptyCodeBlocks"
  | "collapseStatusBars"
  | "expandStatusBars"
  | "enableLineNumbers"
  | "disableLineNumbers";

export type CodeCleanupResult = {
  changed: boolean;
  affectedCount: number;
};

type CodeBlockRecord = {
  pos: number;
  node: ProseMirrorNode;
  text: string;
};

type ReplaceTarget = CodeBlockRecord & {
  kind: "replace";
  nextText: string;
};

type DeleteTarget = CodeBlockRecord & {
  kind: "delete";
};

type AttrTarget = CodeBlockRecord & {
  kind: "attrs";
  nextAttrs: Record<string, unknown>;
};

type CleanupTarget = ReplaceTarget | DeleteTarget | AttrTarget;

export function removeTrailingBlankLines(value: string): string {
  if (value.trim().length === 0) {
    return "";
  }

  return value.replace(/(?:\r?\n[\t ]*)+$/u, "");
}

export function isCodeBlockEmpty(value: string): boolean {
  return value.trim().length === 0;
}

function collectCodeBlocks(doc: ProseMirrorNode): CodeBlockRecord[] {
  const records: CodeBlockRecord[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") {
      records.push({
        pos,
        node,
        text: node.textContent ?? "",
      });
    }

    return true;
  });

  return records;
}

function getAttrUpdateForAction(
  action: CodeCleanupActionKey,
  record: CodeBlockRecord,
): Record<string, unknown> | null {
  const attrs = normalizeCodeBlockAttrs(record.node.attrs);

  switch (action) {
    case "collapseStatusBars":
      return attrs.statusBarCollapsed
        ? null
        : { ...record.node.attrs, statusBarCollapsed: true };
    case "expandStatusBars":
      return attrs.statusBarCollapsed
        ? { ...record.node.attrs, statusBarCollapsed: false }
        : null;
    case "enableLineNumbers":
      return attrs.lineNumbers ? null : { ...record.node.attrs, lineNumbers: true };
    case "disableLineNumbers":
      return attrs.lineNumbers ? { ...record.node.attrs, lineNumbers: false } : null;
    default:
      return null;
  }
}

function buildCleanupTargets(
  records: CodeBlockRecord[],
  action: CodeCleanupActionKey,
): CleanupTarget[] {
  return records
    .map((record) => {
      if (action === "removeTrailingBlankLines") {
        const nextText = removeTrailingBlankLines(record.text);
        if (nextText === record.text) {
          return null;
        }

        return {
          ...record,
          kind: "replace" as const,
          nextText,
        };
      }

      if (!isCodeBlockEmpty(record.text)) {
        const nextAttrs = getAttrUpdateForAction(action, record);
        if (!nextAttrs) {
          return null;
        }

        return {
          ...record,
          kind: "attrs" as const,
          nextAttrs,
        };
      }

      if (action === "removeEmptyCodeBlocks") {
        return {
          ...record,
          kind: "delete" as const,
        };
      }

      return null;
    })
    .filter((target): target is CleanupTarget => target !== null)
    .sort((a, b) => b.pos - a.pos);
}

export function cleanupCodeBlocks(
  editor: Editor | null,
  action: CodeCleanupActionKey,
): CodeCleanupResult {
  if (!editor) {
    return { changed: false, affectedCount: 0 };
  }

  const { state, view } = editor;
  const targets = buildCleanupTargets(collectCodeBlocks(state.doc), action);

  if (targets.length === 0) {
    return { changed: false, affectedCount: 0 };
  }

  const tr = state.tr;

  for (const target of targets) {
    if (target.kind === "delete") {
      tr.delete(target.pos, target.pos + target.node.nodeSize);
      continue;
    }

    if (target.kind === "attrs") {
      const nextNode = target.node.type.create(
        target.nextAttrs,
        target.node.content,
        target.node.marks,
      );
      tr.replaceWith(target.pos, target.pos + target.node.nodeSize, nextNode);
      continue;
    }

    const nextNode = target.node.type.create(
      target.node.attrs,
      target.nextText ? state.schema.text(target.nextText) : undefined,
      target.node.marks,
    );
    tr.replaceWith(target.pos, target.pos + target.node.nodeSize, nextNode);
  }

  view.dispatch(tr);

  return {
    changed: true,
    affectedCount: targets.length,
  };
}

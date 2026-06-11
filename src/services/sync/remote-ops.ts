import type { TiptapDoc, TiptapNode } from "@/services/tiptap-converter";
import type { RemoteDocumentOperation } from "@/services/realtime/types";

function readBlockId(node: TiptapNode): string | null {
  const value = node.attrs?.blockId ?? node.attrs?.["data-block-id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readSortKey(node: TiptapNode): string {
  const value = node.attrs?.sortKey ?? node.attrs?.["data-sort-key"];
  return typeof value === "string" ? value : "";
}

function ensureTopLevelParent(parentId: string, rootBlockId: string): void {
  if (parentId !== rootBlockId) {
    throw new Error("REMOTE_NESTED_OPERATION_UNSUPPORTED");
  }
}

function toTiptapNode(payload: Record<string, unknown>): TiptapNode {
  if (typeof payload.type !== "string") {
    throw new Error("REMOTE_PAYLOAD_TYPE_MISSING");
  }
  return payload as unknown as TiptapNode;
}

function mergeAttrs(
  node: TiptapNode,
  existing: TiptapNode | null,
  attrs: Record<string, unknown>,
): TiptapNode {
  return {
    ...node,
    attrs: {
      ...(existing?.attrs ?? {}),
      ...(node.attrs ?? {}),
      ...attrs,
    },
  };
}

function sortTopLevel(content: TiptapNode[]): TiptapNode[] {
  return [...content].sort((left, right) => readSortKey(left).localeCompare(readSortKey(right)));
}

export function applyRemoteOperationsToDoc(input: {
  doc: TiptapDoc;
  rootBlockId: string;
  operations: RemoteDocumentOperation[];
}): TiptapDoc {
  let content = [...(input.doc.content ?? [])];

  for (const operation of input.operations) {
    if (operation.type === "create") {
      ensureTopLevelParent(operation.parentId, input.rootBlockId);
      if (content.some((node) => readBlockId(node) === operation.blockId)) {
        continue;
      }
      const node = mergeAttrs(toTiptapNode(operation.payload), null, {
        blockId: operation.blockId,
        "data-block-id": operation.blockId,
        ...(operation.clientId ? { clientId: operation.clientId, "data-client-id": operation.clientId } : {}),
        sortKey: operation.sortKey,
        "data-sort-key": operation.sortKey,
      });
      content = sortTopLevel([...content, node]);
      continue;
    }

    if (operation.type === "update") {
      const index = content.findIndex((node) => readBlockId(node) === operation.blockId);
      if (index < 0) throw new Error("REMOTE_UPDATE_TARGET_MISSING");
      const existing = content[index];
      const node = mergeAttrs(toTiptapNode(operation.payload), existing, {
        blockId: operation.blockId,
        "data-block-id": operation.blockId,
      });
      content[index] = node;
      continue;
    }

    if (operation.type === "delete") {
      content = content.filter((node) => readBlockId(node) !== operation.blockId);
      continue;
    }

    if (operation.type === "move") {
      ensureTopLevelParent(operation.parentId, input.rootBlockId);
      const index = content.findIndex((node) => readBlockId(node) === operation.blockId);
      if (index < 0) throw new Error("REMOTE_MOVE_TARGET_MISSING");
      content[index] = mergeAttrs(content[index], content[index], {
        sortKey: operation.sortKey,
        "data-sort-key": operation.sortKey,
      });
      content = sortTopLevel(content);
    }
  }

  return {
    ...input.doc,
    content,
  };
}

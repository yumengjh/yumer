import type { TiptapDoc } from "@/services/tiptap-converter";
import { readIdentityFromAttrs } from "./identity";
import type { SyncEntry } from "./types";

type CreateAckMapping = {
  clientId: string;
  blockId: string;
};

function collectClientIds(doc: TiptapDoc | null): Set<string> {
  const clientIds = new Set<string>();
  const nodes = Array.isArray(doc?.content) ? doc.content : [];
  for (const node of nodes) {
    const identity = readIdentityFromAttrs(node.attrs);
    if (identity.clientId) {
      clientIds.add(identity.clientId);
    }
  }
  return clientIds;
}

export function collectOrphanedCreateDeletes(
  currentSnapshot: TiptapDoc | null,
  createMappings: CreateAckMapping[],
): SyncEntry[] {
  if (createMappings.length === 0) return [];

  const liveClientIds = collectClientIds(currentSnapshot);
  const deletes: SyncEntry[] = [];

  for (const mapping of createMappings) {
    if (liveClientIds.has(mapping.clientId)) continue;
    deletes.push({
      clientId: mapping.clientId,
      blockId: mapping.blockId,
      opType: "delete",
    });
  }

  return deletes;
}

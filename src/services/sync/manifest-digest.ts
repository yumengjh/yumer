import type { TiptapDoc } from "@/services/tiptap-converter";
import { compareSortKeys } from "./fractional-key";

export type ManifestDigestNode = {
  blockId: string;
  sortKey: string;
};

function readBlockId(node: TiptapDoc["content"][number]): string | null {
  const value = node.attrs?.blockId ?? node.attrs?.["data-block-id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readSortKey(node: TiptapDoc["content"][number]): string {
  const value = node.attrs?.sortKey ?? node.attrs?.["data-sort-key"];
  return typeof value === "string" ? value : "";
}

/** 收集根块直属、已持久化块的 (blockId, sortKey)，按字节序排序。 */
export function collectRootManifestNodes(
  doc: TiptapDoc | null,
): ManifestDigestNode[] {
  if (!doc?.content?.length) return [];
  return doc.content
    .flatMap((node) => {
      const blockId = readBlockId(node);
      if (!blockId) return [];
      return [{ blockId, sortKey: readSortKey(node) }];
    })
    .sort((left, right) => {
      const bySortKey = compareSortKeys(left.sortKey, right.sortKey);
      if (bySortKey !== 0) return bySortKey;
      return left.blockId < right.blockId
        ? -1
        : left.blockId > right.blockId
          ? 1
          : 0;
    });
}

/** 与后端 computeRootManifestDigest 相同：sha256(blockId1|blockId2|...)。 */
export async function computeRootManifestDigest(
  doc: TiptapDoc | null,
): Promise<string> {
  const payload = collectRootManifestNodes(doc)
    .map((node) => node.blockId)
    .join("|");
  return sha256Hex(payload);
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const encoded = new TextEncoder().encode(value);
    const digest = await subtle.digest("SHA-256", encoded);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `fallback-${hash.toString(16)}`;
}

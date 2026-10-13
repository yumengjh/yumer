import { describe, expect, it } from "vitest";
import type { TiptapDoc } from "@/services/tiptap-converter";
import { DELETE_ENTRY_KEY_SEPARATOR, deriveSyncEntries } from "../engine";
import {
  createSyncIdentityRegistry,
  hydrateTopLevelSyncIdentity,
  registerCreateAck,
  registerDeleteAck,
} from "../snapshot";
import { createInitialSyncState, enqueueChange } from "../reducer";
import { planVerifyRepairs } from "../verify";
import { hashPayloadCanonical } from "../delta";

function paragraph(text: string, attrs: Record<string, unknown>) {
  return { type: "paragraph", attrs, content: [{ type: "text", text }] };
}

describe("hydrateTopLevelSyncIdentity", () => {
  it("restores an acked blockId lost by undo/redo for the same clientId", () => {
    const registry = createSyncIdentityRegistry();
    registerCreateAck(registry, "c1", "b1");
    const doc: TiptapDoc = { type: "doc", content: [paragraph("x", { clientId: "c1" })] };

    const hydrated = hydrateTopLevelSyncIdentity(doc, registry);

    expect(hydrated.content[0].attrs?.blockId).toBe("b1");
  });

  it("does not assign a blockId already used by another node", () => {
    const registry = createSyncIdentityRegistry();
    registerCreateAck(registry, "c1", "b1");
    const doc: TiptapDoc = {
      type: "doc",
      content: [paragraph("a", { clientId: "c2", blockId: "b1" }), paragraph("b", { clientId: "c1" })],
    };

    const hydrated = hydrateTopLevelSyncIdentity(doc, registry);

    expect(hydrated.content[1].attrs?.blockId ?? null).toBeNull();
  });

  it("strips a blockId whose deletion the server already acknowledged", () => {
    const registry = createSyncIdentityRegistry();
    registerCreateAck(registry, "c1", "b1");
    registerDeleteAck(registry, "b1");
    const doc: TiptapDoc = { type: "doc", content: [paragraph("x", { clientId: "c1", blockId: "b1" })] };

    const hydrated = hydrateTopLevelSyncIdentity(doc, registry);

    expect(hydrated.content[0].attrs?.blockId ?? null).toBeNull();
  });
});

describe("deriveSyncEntries identity rules", () => {
  it("revives a restored block that still carries its blockId instead of creating a duplicate", () => {
    const prev: TiptapDoc = { type: "doc", content: [paragraph("a", { clientId: "c1", blockId: "b1", sortKey: "a0" })] };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        paragraph("a", { clientId: "c1", blockId: "b1", sortKey: "a0" }),
        paragraph("restored", { clientId: "c2", blockId: "b2", sortKey: "a1" }),
      ],
    };

    const entries = deriveSyncEntries(prev, next);

    expect(entries.filter((entry) => entry.opType === "create")).toHaveLength(0);
    const revive = entries.find((entry) => entry.clientId === "c2");
    expect(revive?.opType).toBe("update");
    expect(revive?.blockId).toBe("b2");
    expect(revive?.sortKey).toBeTruthy();
  });

  it("keys the delete of an old block separately when its clientId now belongs to a new block", () => {
    const prev: TiptapDoc = { type: "doc", content: [paragraph("a", { clientId: "c1", blockId: "b1", sortKey: "a0" })] };
    const next: TiptapDoc = { type: "doc", content: [paragraph("a", { clientId: "c1" })] };

    const entries = deriveSyncEntries(prev, next);
    let state = createInitialSyncState("doc", "root", 1);
    for (const entry of entries) state = enqueueChange(state, entry);

    expect(state.entries.c1.opType).toBe("create");
    const deleteKey = `c1${DELETE_ENTRY_KEY_SEPARATOR}b1`;
    expect(state.entries[deleteKey]?.opType).toBe("delete");
    expect(state.entries[deleteKey]?.blockId).toBe("b1");
  });

  it("does not delete a node that merely gained a blockId", () => {
    const prev: TiptapDoc = { type: "doc", content: [paragraph("a", { clientId: "c1" })] };
    const next: TiptapDoc = { type: "doc", content: [paragraph("a", { clientId: "c1", blockId: "b1", sortKey: "a0" })] };

    const entries = deriveSyncEntries(prev, next);

    expect(entries.filter((entry) => entry.opType === "delete")).toHaveLength(0);
  });
});

describe("planVerifyRepairs", () => {
  it("repairs content, missing, extra and order mismatches incrementally", async () => {
    const nodes = [
      paragraph("one", { clientId: "c1", blockId: "b1", sortKey: "a0" }),
      paragraph("two", { clientId: "c2", blockId: "b2", sortKey: "a1" }),
      paragraph("three", { clientId: "c3", blockId: "b3", sortKey: "a2" }),
      paragraph("new", { clientId: "c4" }),
    ];
    const snapshot: TiptapDoc = { type: "doc", content: nodes };
    const plan = await planVerifyRepairs({
      snapshot,
      pendingEntries: {},
      serverBlocks: [
        // b1 内容一致；b2 内容不同；b3 服务端缺失；b9 服务端多出；顺序 b2 在 b1 之前
        { blockId: "b2", sortKey: "Zz", hash: "stale" },
        { blockId: "b1", sortKey: "a0", hash: await hashPayloadCanonical(nodes[0]) },
        { blockId: "b9", sortKey: "a5", hash: "x" },
      ],
    });

    expect(plan.updates.map((entry) => entry.blockId)).toEqual(["b2"]);
    expect(plan.missingBlockIds).toEqual(["b3"]);
    expect(plan.creates.map((entry) => entry.clientId)).toEqual(["c4"]);
    expect(plan.deletes.map((entry) => entry.blockId)).toEqual(["b9"]);
    expect(plan.moves).toHaveLength(1);
    expect(plan.mismatchCount).toBeGreaterThan(0);
  });

  it("reports nothing when the server matches the snapshot", async () => {
    const nodes = [
      paragraph("one", { clientId: "c1", blockId: "b1", sortKey: "a0" }),
      paragraph("two", { clientId: "c2", blockId: "b2", sortKey: "a1" }),
    ];
    const plan = await planVerifyRepairs({
      snapshot: { type: "doc", content: nodes },
      pendingEntries: {},
      serverBlocks: await Promise.all(
        nodes.map(async (node) => ({
          blockId: String(node.attrs.blockId),
          sortKey: String(node.attrs.sortKey),
          hash: await hashPayloadCanonical(node),
        })),
      ),
    });

    expect(plan.mismatchCount).toBe(0);
    expect(plan.moves).toHaveLength(0);
  });
});

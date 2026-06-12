import { describe, expect, it } from "vitest";
import { getSyncBaseStore, seedSyncBaseStoreFromBlocks, toSyncPayload } from "../base-store";
import { stripPayloadForSync } from "../delta-encoding";
import {
  DELTA_MIN_FULL_SIZE,
  DELTA_REFERENCE_LARGE_BLOCK_BYTES,
} from "../delta-policy";
import { buildSyncBatchOperations } from "../api";

describe("SyncBaseStore", () => {
  it("seeds and updates block baselines", async () => {
    const store = getSyncBaseStore("doc_base_test");
    store.clear();

    const payload = {
      type: "paragraph",
      attrs: { blockId: "b1", clientId: "c1" },
      content: [{ type: "text", text: "hello" }],
    };

    await store.seedFromPayload({
      blockId: "b1",
      ver: 3,
      payload,
    });

    const base = store.get("b1");
    expect(base?.ver).toBe(3);
    expect(base?.hash).toMatch(/^[a-f0-9]{64}$/);

    await store.recordAck({
      blockId: "b1",
      ver: 4,
      payload: {
        ...payload,
        content: [{ type: "text", text: "hello world" }],
      },
    });

    expect(store.get("b1")?.ver).toBe(4);
    expect(store.shouldForceFull("b1")).toBe(false);
  });

  it("forces full resync after delta mismatch", () => {
    const store = getSyncBaseStore("doc_mismatch_test");
    store.clear();
    store.forceFullResync("b1");
    expect(store.get("b1")).toBeUndefined();
    expect(store.shouldForceFull("b1")).toBe(true);
  });

  it("merges block type into API payload when seeding sync base", () => {
    const merged = toSyncPayload({
      type: "codeBlock",
      payload: {
        attrs: { language: "typescript" },
        content: [{ type: "text", text: "hello" }],
      },
    });
    expect(merged.type).toBe("codeBlock");
  });

  it("seeds large code blocks from edit-content tree shape", async () => {
    const docId = "doc_seed_shape_test";
    const blockId = "block_code_seed";
    const store = getSyncBaseStore(docId);
    store.clear();

    const largeText = "x".repeat(DELTA_REFERENCE_LARGE_BLOCK_BYTES);
    await seedSyncBaseStoreFromBlocks(docId, [
      {
        blockId,
        type: "codeBlock",
        ver: 7,
        payload: {
          attrs: { language: "typescript" },
          content: [{ type: "text", text: largeText }],
        },
      },
    ]);

    const bodyOperations = await buildSyncBatchOperations({
      docId,
      rootBlockId: "root_1",
      baseStore: store,
      operations: [
        {
          clientId: "client_code",
          blockId,
          opType: "update",
          payload: {
            type: "codeBlock",
            attrs: {
              blockId,
              clientId: "client_code",
              language: "typescript",
            },
            content: [{ type: "text", text: `${largeText}y` }],
          },
        },
      ],
    });

    expect(bodyOperations[0].type).toBe("update");
    if (bodyOperations[0].type !== "update") return;
    expect(bodyOperations[0].data.delta?.baseVer).toBe(7);
    expect(bodyOperations[0].data.payload).toBeUndefined();
  });
});

describe("delta encoding threshold", () => {
  it("uses zero min size so delta is gated only by patch ratio", () => {
    expect(DELTA_MIN_FULL_SIZE).toBe(0);
    const stripped = stripPayloadForSync({
      type: "codeBlock",
      attrs: { blockId: "b1" },
      content: [{ type: "text", text: "x".repeat(DELTA_REFERENCE_LARGE_BLOCK_BYTES) }],
    });
    expect(JSON.stringify(stripped).length).toBeGreaterThanOrEqual(
      DELTA_REFERENCE_LARGE_BLOCK_BYTES,
    );
  });
});

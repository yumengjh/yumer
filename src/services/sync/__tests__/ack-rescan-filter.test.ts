import { describe, expect, it } from "vitest";
import { canonicalStringify } from "../delta";
import { stripPayloadForSync } from "../delta-encoding";
import { filterRedundantAckRescanEntries } from "../snapshot";
import type { SyncEntry } from "../types";

describe("filterRedundantAckRescanEntries", () => {
  it("drops update entries that only repeat the payload just acked", () => {
    const payload = {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: "hello world" }],
    };
    const canonical = canonicalStringify(stripPayloadForSync(payload));
    const entries: SyncEntry[] = [
      {
        clientId: "client_code",
        blockId: "block_code",
        opType: "update",
        payload,
      },
    ];

    expect(
      filterRedundantAckRescanEntries(
        entries,
        new Map([["block_code", canonical]]),
      ),
    ).toEqual([]);
  });

  it("keeps update entries when canonical content actually changed", () => {
    const synced = canonicalStringify(
      stripPayloadForSync({
        type: "codeBlock",
        attrs: { language: "typescript" },
        content: [{ type: "text", text: "hello" }],
      }),
    );
    const entries: SyncEntry[] = [
      {
        clientId: "client_code",
        blockId: "block_code",
        opType: "update",
        payload: {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "hello world" }],
        },
      },
    ];

    expect(
      filterRedundantAckRescanEntries(
        entries,
        new Map([["block_code", synced]]),
      ),
    ).toEqual(entries);
  });

  it("keeps the update when an older payload for the same block is still queued", () => {
    const payload = {
      type: "paragraph",
      content: [{ type: "text", text: "latest" }],
    };
    const canonical = canonicalStringify(stripPayloadForSync(payload));
    const entries: SyncEntry[] = [
      { clientId: "client_p", blockId: "block_p", opType: "update", payload },
    ];
    const pending: Record<string, SyncEntry> = {
      client_p: {
        clientId: "client_p",
        blockId: "block_p",
        opType: "update",
        payload: { type: "paragraph", content: [{ type: "text", text: "stale" }] },
      },
    };

    expect(
      filterRedundantAckRescanEntries(entries, new Map([["block_p", canonical]]), pending),
    ).toEqual(entries);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyDelta,
  buildBlockDelta,
  buildBlockDeltaIfUseful,
  canonicalStringify,
  computeDelta,
  ensurePayloadType,
  hashPayloadCanonical,
  parseCanonicalPayload,
  shouldSendDelta,
} from "../delta";
import { DELTA_REFERENCE_LARGE_BLOCK_BYTES } from "../delta-policy";

type DeltaFixture = {
  name: string;
  base: Record<string, unknown>;
  next: Record<string, unknown>;
};

const fixturesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../__fixtures__/delta-fixtures.json",
);
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")) as DeltaFixture[];

describe("block delta", () => {
  it("canonicalStringify strips sync attrs and sorts keys", () => {
    const canonical = canonicalStringify({
      type: "paragraph",
      attrs: { sortKey: "a0", blockId: "b1", textAlign: "left" },
      content: [{ type: "text", text: "hello" }],
    });

    expect(canonical).toBe(
      JSON.stringify({
        attrs: { textAlign: "left" },
        content: [{ text: "hello", type: "text" }],
        type: "paragraph",
      }),
    );
  });

  it("is stable regardless of input key order", () => {
    const left = canonicalStringify({ b: 2, a: { z: 1, y: 2 } });
    const right = canonicalStringify({ a: { y: 2, z: 1 }, b: 2 });
    expect(left).toBe(right);
  });

  for (const fixture of fixtures) {
    it(`roundtrips fixture: ${fixture.name}`, async () => {
      const patch = computeDelta(fixture.base, fixture.next);
      const appliedText = applyDelta(fixture.base, patch);
      const appliedPayload = parseCanonicalPayload(appliedText);
      const expectedCanonical = canonicalStringify(fixture.next);

      expect(appliedText).toBe(expectedCanonical);
      expect(canonicalStringify(appliedPayload)).toBe(expectedCanonical);

      const delta = await buildBlockDelta({
        basePayload: fixture.base,
        nextPayload: fixture.next,
        baseVer: 3,
      });
      expect(delta.format).toBe("dmp-v1");
      expect(delta.baseVer).toBe(3);
      expect(delta.baseHash).toBe(await hashPayloadCanonical(fixture.base));
      expect(delta.resultHash).toBe(await hashPayloadCanonical(fixture.next));
    });
  }

  it("decides delta encoding by size threshold and patch ratio", () => {
    const smallBase = { type: "paragraph", content: [{ type: "text", text: "a" }] };
    const smallNext = { type: "paragraph", content: [{ type: "text", text: "ab" }] };
    expect(shouldSendDelta({ basePayload: smallBase, nextPayload: smallNext })).toBe(false);

    const largeText = "x".repeat(DELTA_REFERENCE_LARGE_BLOCK_BYTES);
    const largeBase = { type: "codeBlock", content: [{ type: "text", text: largeText }] };
    const largeNext = {
      type: "codeBlock",
      content: [{ type: "text", text: `${largeText}y` }],
    };
    expect(shouldSendDelta({ basePayload: largeBase, nextPayload: largeNext })).toBe(true);
  });

  it("builds a sendable delta only when the patch is worth sending", async () => {
    const smallBase = { type: "paragraph", content: [{ type: "text", text: "a" }] };
    const smallNext = { type: "paragraph", content: [{ type: "text", text: "ab" }] };

    await expect(
      buildBlockDeltaIfUseful({
        basePayload: smallBase,
        nextPayload: smallNext,
        baseVer: 2,
      }),
    ).resolves.toBeNull();

    const largeText = "x".repeat(DELTA_REFERENCE_LARGE_BLOCK_BYTES);
    const largeBase = {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: largeText }],
    };
    const largeNext = {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: `${largeText}y` }],
    };

    const delta = await buildBlockDeltaIfUseful({
      basePayload: largeBase,
      nextPayload: largeNext,
      baseVer: 2,
    });

    expect(delta).toMatchObject({
      format: "dmp-v1",
      baseVer: 2,
      baseHash: await hashPayloadCanonical(largeBase),
      resultHash: await hashPayloadCanonical(largeNext),
    });
  });

  it("merges block type for codeBlock attrs normalization", async () => {
    const baseWithoutType = {
      attrs: { language: "js" },
      content: [{ type: "text", text: "hello\r\nworld" }],
    };
    const baseWithType = ensurePayloadType(baseWithoutType, "codeBlock") as Record<string, unknown>;
    const nextWithType = {
      type: "codeBlock",
      attrs: { language: "js" },
      content: [{ type: "text", text: "hello\r\nworld!" }],
    };
    const delta = await buildBlockDelta({
      basePayload: baseWithType,
      nextPayload: nextWithType,
      baseVer: 1,
      blockType: "codeBlock",
    });

    expect(delta.baseHash).toBe(await hashPayloadCanonical(baseWithType));
    expect(await hashPayloadCanonical(ensurePayloadType(baseWithoutType, "codeBlock"))).toBe(
      delta.baseHash,
    );
  });

  it("normalizes CRLF in text nodes for stable hashes", () => {
    const lf = canonicalStringify({
      type: "codeBlock",
      content: [{ type: "text", text: "a\nb" }],
    });
    const crlf = canonicalStringify({
      type: "codeBlock",
      content: [{ type: "text", text: "a\r\nb" }],
    });
    expect(lf).toBe(crlf);
  });
});

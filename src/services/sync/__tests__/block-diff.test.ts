import { describe, expect, it } from "vitest";
import {
  createSyncSnapshotIndex,
  deriveSyncEntriesWithMetrics,
} from "../engine";
import type { SyncDiffHint } from "../types";
import type { TiptapDoc, TiptapNode } from "@/services/tiptap-converter";

function sortKey(index: number): string {
  return String((index + 1) * 1000).padStart(6, "0");
}

function paragraph(index: number, text = `block ${index}`): TiptapNode {
  return {
    type: "paragraph",
    attrs: {
      clientId: `c_${index}`,
      blockId: `b_${index}`,
      sortKey: sortKey(index),
    },
    content: [{ type: "text", text }],
  };
}

function doc(nodes: TiptapNode[]): TiptapDoc {
  return { type: "doc", content: nodes };
}

function textEditHint(index: number): SyncDiffHint {
  return {
    source: "editor-transaction",
    changedClientIds: [`c_${index}`],
    changedBlockIds: [`b_${index}`],
    structureChanged: false,
    identityChanged: false,
    reason: "text-edit",
  };
}

describe("indexed block diff", () => {
  it("fingerprints only the dirty block for a large content-only edit", () => {
    const nodes = Array.from({ length: 5000 }, (_, index) => paragraph(index));
    const previous = doc(nodes);
    const nextNodes = [...nodes];
    nextNodes[2500] = paragraph(2500, "edited block");
    const next = doc(nextNodes);
    const previousIndex = createSyncSnapshotIndex(previous, {
      computePayloadFingerprints: true,
    });

    const result = deriveSyncEntriesWithMetrics(previous, next, {
      previousIndex,
      hint: textEditHint(2500),
    });

    expect(result.entries).toMatchObject([
      {
        clientId: "c_2500",
        blockId: "b_2500",
        opType: "update",
      },
    ]);
    expect(result.metrics).toMatchObject({
      mode: "content-hint",
      topLevelCount: 5000,
      dirtyCandidateCount: 1,
      fingerprintCount: 1,
      sortPlanRan: false,
      derivedEntryCount: 1,
    });
  });

  it("runs order planning for structure hints without payload-diffing unchanged blocks", () => {
    const previous = doc([paragraph(0), paragraph(1), paragraph(2)]);
    const inserted: TiptapNode = {
      type: "paragraph",
      attrs: { clientId: "c_inserted" },
      content: [{ type: "text", text: "inserted" }],
    };
    const next = doc([paragraph(0), inserted, paragraph(1), paragraph(2)]);
    const previousIndex = createSyncSnapshotIndex(previous, {
      computePayloadFingerprints: true,
    });

    const result = deriveSyncEntriesWithMetrics(previous, next, {
      previousIndex,
      hint: {
        source: "editor-transaction",
        changedClientIds: ["c_inserted"],
        changedBlockIds: [],
        structureChanged: true,
        identityChanged: false,
        reason: "insert-block",
      },
    });

    expect(result.entries).toMatchObject([
      {
        clientId: "c_inserted",
        blockId: null,
        opType: "create",
        sortKey: "001500",
      },
    ]);
    expect(result.metrics).toMatchObject({
      mode: "structure-hint",
      dirtyCandidateCount: 1,
      fingerprintCount: 1,
      sortPlanRan: true,
      derivedEntryCount: 1,
    });
  });

  it("upgrades a stale content-only hint to structure diff when order changes", () => {
    const previous = doc([paragraph(0), paragraph(1), paragraph(2)]);
    const next = doc([paragraph(2), paragraph(0), paragraph(1)]);
    const previousIndex = createSyncSnapshotIndex(previous, {
      computePayloadFingerprints: true,
    });

    const result = deriveSyncEntriesWithMetrics(previous, next, {
      previousIndex,
      hint: textEditHint(2),
    });

    expect(result.metrics.mode).toBe("structure-hint");
    expect(result.metrics.sortPlanRan).toBe(true);
    expect(result.entries).toEqual([
      expect.objectContaining({
        clientId: "c_2",
        blockId: "b_2",
        opType: "move",
      }),
    ]);
  });

  it("falls back to full diff when no hint is available", () => {
    const previous = doc([paragraph(0), paragraph(1)]);
    const next = doc([paragraph(0), paragraph(1, "edited")]);

    const result = deriveSyncEntriesWithMetrics(previous, next);

    expect(result.entries).toMatchObject([
      {
        clientId: "c_1",
        blockId: "b_1",
        opType: "update",
      },
    ]);
    expect(result.metrics).toMatchObject({
      mode: "fallback-full",
      fingerprintCount: 4,
      sortPlanRan: true,
      derivedEntryCount: 1,
    });
  });
});

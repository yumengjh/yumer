import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SyncDebugLog,
  SyncIdentityWatch,
  SyncTraceLog,
  type ManifestNodeSummary,
} from "../debug-log";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

function installBrowserStorage() {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("window", {
    localStorage,
    sessionStorage,
    location: { href: "http://localhost/doc/doc_1" },
    setInterval,
    clearInterval,
  });
}

describe("sync debug log", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records a resurrection incident when a deleted identity appears in a later manifest trace", () => {
    installBrowserStorage();
    SyncDebugLog.setEnabled(true);
    SyncIdentityWatch.markDeleted({
      docId: "doc_1",
      reason: "batch-delete-request",
      clientBatchId: "batch_delete",
      identities: [
        {
          blockId: "block_deleted",
          clientId: "client_deleted",
          syncCreateId: "sync-create:client_deleted",
        },
      ],
    });

    const manifest: ManifestNodeSummary[] = [
      {
        index: 0,
        type: "paragraph",
        blockId: "block_deleted",
        clientId: "client_deleted",
        syncCreateId: "sync-create:client_deleted",
        sortKey: "001",
        textPreview: "deleted text returned",
        contentHash: "hash_deleted",
      },
    ];
    SyncTraceLog.add("snapshot:advance", "doc_1", "session_1", 1, {
      nextManifest: manifest,
    });

    expect(SyncIdentityWatch.getIncidents()).toHaveLength(1);
    expect(SyncIdentityWatch.getIncidents()[0]).toMatchObject({
      type: "deleted-identity-visible",
      observedEvent: "snapshot:advance",
      observedNode: { blockId: "block_deleted" },
    });
    expect(SyncTraceLog.getAll().map((record) => record.event)).toContain("identity:resurrected");
  });

  it("checks afterManifest traces so ack patch regressions are captured", () => {
    installBrowserStorage();
    SyncDebugLog.setEnabled(true);
    SyncIdentityWatch.markDeleted({
      docId: "doc_1",
      reason: "batch-delete-ack",
      clientBatchId: "batch_delete",
      identities: [{ blockId: "block_deleted" }],
    });

    SyncTraceLog.add("ack:patch", "doc_1", "session_1", 1, {
      beforeManifest: [],
      afterManifest: [
        {
          index: 2,
          type: "paragraph",
          blockId: "block_deleted",
          clientId: null,
          syncCreateId: null,
          sortKey: "003",
          textPreview: "returned by ack",
          contentHash: "hash_ack",
        },
      ],
    });

    expect(SyncIdentityWatch.getIncidents()).toHaveLength(1);
    expect(SyncIdentityWatch.getIncidents()[0]).toMatchObject({
      observedEvent: "ack:patch",
      observedNode: { index: 2, blockId: "block_deleted" },
    });
  });

  it("exports incidents and deleted identity watches with the trace bundle", () => {
    installBrowserStorage();
    SyncDebugLog.setEnabled(true);
    SyncIdentityWatch.markDeleted({
      docId: "doc_1",
      reason: "manifest-reconcile-tombstone",
      identities: [{ blockId: "block_1" }],
    });

    const exported = JSON.parse(SyncTraceLog.exportBundle());

    expect(exported.schemaVersion).toBe(2);
    expect(exported.page).toBe("http://localhost/doc/doc_1");
    expect(exported.deletedIdentityWatch).toHaveLength(1);
    expect(exported.incidents).toEqual([]);
  });

  it("exports a compact AI bundle without large raw payload content", () => {
    installBrowserStorage();
    SyncDebugLog.setEnabled(true);
    const largeText = "x".repeat(500_000);
    SyncDebugLog.add({
      id: "batch_large",
      timestamp: Date.now(),
      source: "autosync",
      docId: "doc_1",
      baseVersion: 7,
      clientBatchId: "batch_large",
      operationCount: 1,
      requestBody: {
        docId: "doc_1",
        baseVersion: 7,
        draftRevision: 2,
        clientBatchId: "batch_large",
        source: "autosync",
        operations: [
          {
            type: "update",
            blockId: "block_large",
            data: {
              payload: {
                type: "paragraph",
                content: [{ type: "text", text: largeText }],
              },
              plainText: largeText,
            },
          },
        ],
      },
      responseBody: {
        acceptedBatchId: "batch_large",
        appliedAt: Date.now(),
        serverHead: 7,
        draftRevision: 3,
        needsReload: false,
        conflicts: [],
        results: [
          {
            operation: "update",
            success: true,
            blockId: "block_large",
          },
        ],
      },
      duration: 12,
      success: true,
    });

    const compactText = SyncTraceLog.exportAiBundle({ docId: "doc_1" });
    const compact = JSON.parse(compactText);

    expect(compact.bundleType).toBe("sync-ai-debug");
    expect(compact.batchLog).toHaveLength(1);
    expect(compact.batchLog[0].request.operations[0]).toMatchObject({
      type: "update",
      blockId: "block_large",
      payloadType: "paragraph",
      plainTextLength: 500_000,
    });
    expect(compactText.length).toBeLessThan(20_000);
    expect(compactText).not.toContain(largeText.slice(0, 1000));
  });
});

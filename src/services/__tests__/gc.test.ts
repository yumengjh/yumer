import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("../api-client", () => ({
  apiFetch,
}));

import {
  compactSqliteStorage,
  createBlockVersionGcRun,
  getBlockVersionGcCandidates,
  getBlockVersionGcHealth,
  getGcCandidatePool,
  getGcPolicy,
  listBlockVersionGcRuns,
  sweepBlockVersions,
  sweepDraftTombstones,
  sweepRevisionTombstones,
} from "../gc";

describe("gc service", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("loads GC health with system admin headers", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            status: "ok",
            missingRevisionSnapshots: 0,
            missingPublishedSnapshots: 0,
            missingRootBlockVersions: 0,
          },
        }),
        { status: 200 },
      ),
    );

    const result = await getBlockVersionGcHealth({
      token: "gc-secret",
      workspaceId: "ws_1",
      docId: "doc_1",
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/gc/block-versions/health?workspaceId=ws_1&docId=doc_1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-system-admin-token": "gc-secret",
        }),
      }),
    );
    expect(result.status).toBe("ok");
  });

  it("creates a GC run with operator and includeCandidates", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            runId: "gc_run_1",
            status: "completed",
            summary: { candidateBlockVersions: 3 },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await createBlockVersionGcRun({
      token: "gc-secret",
      operatorId: "debugger",
      workspaceId: "ws_1",
      docId: "doc_1",
      includeCandidates: true,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/gc/block-versions/runs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-system-admin-token": "gc-secret",
          "x-operator-id": "debugger",
        }),
        body: JSON.stringify({
          workspaceId: "ws_1",
          docId: "doc_1",
          includeCandidates: true,
        }),
      }),
    );
    expect(result.runId).toBe("gc_run_1");
  });

  it("lists runs and candidates", async () => {
    apiFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              items: [{ runId: "gc_run_1", status: "completed" }],
              total: 1,
              page: 1,
              pageSize: 10,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              items: [{ resourceKey: "b_1@2", reasonCode: "unreferenced_older_than_policy" }],
              total: 1,
              page: 1,
              pageSize: 100,
            },
          }),
          { status: 200 },
        ),
      );

    const runs = await listBlockVersionGcRuns({
      token: "gc-secret",
      docId: "doc_1",
      page: 1,
      pageSize: 10,
    });
    const candidates = await getBlockVersionGcCandidates({
      token: "gc-secret",
      runId: "gc_run_1",
      page: 1,
      pageSize: 100,
    });

    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      "/admin/gc/block-versions/runs?page=1&pageSize=10&docId=doc_1",
      expect.any(Object),
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      "/admin/gc/block-versions/runs/gc_run_1/candidates?page=1&pageSize=100",
      expect.any(Object),
    );
    expect(runs.items[0].runId).toBe("gc_run_1");
    expect(candidates.items[0].resourceKey).toBe("b_1@2");
  });

  it("queries candidate pool with state and action filters", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            items: [
              {
                candidateKey: "snapshot:doc_1@snap@4->b_1@4",
                resourceKey: "b_1@4",
                action: "compact_map_entry",
                state: "eligible",
              },
            ],
            total: 1,
            page: 1,
            pageSize: 100,
          },
        }),
        { status: 200 },
      ),
    );

    const result = await getGcCandidatePool({
      token: "gc-secret",
      operatorId: "debugger",
      workspaceId: "ws_1",
      docId: "doc_1",
      state: "eligible",
      action: "compact_map_entry",
      page: 1,
      pageSize: 100,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/gc/block-versions/pool?page=1&pageSize=100&state=eligible&action=compact_map_entry&workspaceId=ws_1&docId=doc_1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-system-admin-token": "gc-secret",
          "x-operator-id": "debugger",
        }),
      }),
    );
    expect(result.items[0].candidateKey).toBe("snapshot:doc_1@snap@4->b_1@4");
    expect(result.items[0].state).toBe("eligible");
  });

  it("runs draft tombstone sweep with dry-run", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            runId: "gc_run_sweep_1",
            mode: "sweep",
            status: "completed",
            dryRun: true,
            source: "document_drafts",
            processedCount: 5,
          },
        }),
        { status: 200 },
      ),
    );

    const result = await sweepDraftTombstones({
      token: "gc-secret",
      operatorId: "debugger",
      workspaceId: "ws_1",
      docId: "doc_1",
      limit: 50,
      dryRun: true,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/gc/block-versions/sweeps/draft-tombstones",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-system-admin-token": "gc-secret",
          "x-operator-id": "debugger",
        }),
        body: JSON.stringify({
          workspaceId: "ws_1",
          docId: "doc_1",
          limit: 50,
          dryRun: true,
        }),
      }),
    );
    expect(result.runId).toBe("gc_run_sweep_1");
    expect(result.dryRun).toBe(true);
  });

  it("runs revision tombstone sweep", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            runId: "gc_run_sweep_2",
            mode: "sweep",
            status: "completed",
            dryRun: false,
            source: "doc_snapshots",
            processedCount: 3,
          },
        }),
        { status: 200 },
      ),
    );

    const result = await sweepRevisionTombstones({
      token: "gc-secret",
      workspaceId: "ws_1",
      docId: "doc_1",
      dryRun: false,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/gc/block-versions/sweeps/revision-tombstones",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          workspaceId: "ws_1",
          docId: "doc_1",
          limit: 100,
          dryRun: false,
        }),
      }),
    );
    expect(result.runId).toBe("gc_run_sweep_2");
    expect(result.dryRun).toBe(false);
  });

  it("runs block version physical sweep", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            runId: "gc_run_sweep_3",
            mode: "sweep",
            status: "completed",
            dryRun: true,
            source: "block_versions",
            summary: {
              selectedCandidates: 5,
              processedCandidates: 5,
              wouldDeleteCandidates: 3,
              blockedCandidates: 2,
            },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await sweepBlockVersions({
      token: "gc-secret",
      operatorId: "debugger",
      workspaceId: "ws_1",
      docId: "doc_1",
      limit: 50,
      dryRun: true,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/gc/block-versions/sweeps/block-versions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          workspaceId: "ws_1",
          docId: "doc_1",
          limit: 50,
          dryRun: true,
        }),
      }),
    );
    expect(result.runId).toBe("gc_run_sweep_3");
    expect(result.summary?.wouldDeleteCandidates).toBe(3);
    expect(result.summary?.blockedCandidates).toBe(2);
  });

  it("fetches GC policy defaults", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            gracePeriodMs: 86400000,
            tombstoneGracePeriodMs: 604800000,
            keepLatestPerBlock: 2,
            maxCandidatesToStore: 500,
            promotionDelayMs: 300000,
            stableSeenThreshold: 2,
            rootSources: ["doc_snapshots", "document_drafts"],
          },
        }),
        { status: 200 },
      ),
    );

    const result = await getGcPolicy({
      token: "gc-secret",
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/gc/block-versions/policy",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-system-admin-token": "gc-secret",
        }),
      }),
    );
    expect(result.gracePeriodMs).toBe(86400000);
    expect(result.keepLatestPerBlock).toBe(2);
    expect(result.stableSeenThreshold).toBe(2);
  });

  it("lists runs with mode filter", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            items: [{ runId: "gc_run_sweep_1", mode: "sweep", status: "completed" }],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        }),
        { status: 200 },
      ),
    );

    const result = await listBlockVersionGcRuns({
      token: "gc-secret",
      mode: "sweep",
      page: 1,
      pageSize: 20,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/gc/block-versions/runs?page=1&pageSize=20&mode=sweep",
      expect.any(Object),
    );
    expect(result.items[0].mode).toBe("sweep");
  });

  it("runs SQLite storage compact dry-run", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            supported: true,
            dryRun: true,
            mode: "vacuum",
            before: {
              pageCount: 1000,
              freelistCount: 200,
              pageSizeBytes: 4096,
              fileSizeBytes: 4096000,
              estimatedFreelistBytes: 819200,
            },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await compactSqliteStorage({
      token: "gc-secret",
      dryRun: true,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/gc/storage/compact",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          dryRun: true,
          mode: "vacuum",
          confirm: undefined,
        }),
      }),
    );
    expect(result.supported).toBe(true);
    expect(result.before?.freelistCount).toBe(200);
    expect(result.before?.estimatedFreelistBytes).toBe(819200);
  });

  it("runs SQLite storage compact real execution with confirm", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            supported: true,
            dryRun: false,
            mode: "vacuum",
            before: {
              pageCount: 1000,
              freelistCount: 200,
              pageSizeBytes: 4096,
              fileSizeBytes: 4096000,
            },
            after: {
              pageCount: 800,
              freelistCount: 0,
              pageSizeBytes: 4096,
              fileSizeBytes: 3276800,
            },
            durationMs: 150,
          },
        }),
        { status: 200 },
      ),
    );

    const result = await compactSqliteStorage({
      token: "gc-secret",
      dryRun: false,
      confirm: "VACUUM_SQLITE_DATABASE",
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/gc/storage/compact",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          dryRun: false,
          mode: "vacuum",
          confirm: "VACUUM_SQLITE_DATABASE",
        }),
      }),
    );
    expect(result.supported).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.after?.pageCount).toBe(800);
    expect(result.durationMs).toBe(150);
  });
});

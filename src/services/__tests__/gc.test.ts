import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("../api-client", () => ({
  apiFetch,
}));

import {
  createBlockVersionGcRun,
  getBlockVersionGcCandidates,
  getBlockVersionGcHealth,
  listBlockVersionGcRuns,
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiPost } = vi.hoisted(() => ({
  apiPost: vi.fn(),
}));

vi.mock("../api-client", () => ({
  apiGet: vi.fn(),
  apiPost,
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

import { acquireSyncSession, commitVersion, renewSyncSession } from "../document";

describe("document commit api", () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  it("returns the committed version payload from /documents/:docId/commit", async () => {
    apiPost.mockResolvedValue({
      docId: "doc_1",
      version: 24,
      draftRevision: 8,
      committed: true,
      draftRemoved: true,
    });

    const response = await commitVersion("doc_1", "手动保存");

    expect(apiPost).toHaveBeenCalledWith("/documents/doc_1/commit", { message: "手动保存" });
    expect(response.version).toBe(24);
    expect(response.draftRevision).toBe(8);
    expect(response.committed).toBe(true);
  });

  it("forwards optional sync session metadata when committing a version", async () => {
    apiPost.mockResolvedValue({
      docId: "doc_1",
      version: 25,
      draftRevision: 9,
      committed: true,
      draftRemoved: true,
    });

    await commitVersion("doc_1", "会话保存", {
      sessionId: "session_1",
      sessionEpoch: 3,
      ackedThroughOpSeq: 42,
    });

    expect(apiPost).toHaveBeenCalledWith("/documents/doc_1/commit", {
      message: "会话保存",
      sessionId: "session_1",
      sessionEpoch: 3,
      ackedThroughOpSeq: 42,
    });
  });

  it("renews the active sync session lease", async () => {
    apiPost.mockResolvedValue({
      sessionId: "session_1",
      sessionEpoch: 3,
      leaseExpiresAt: "2026-06-05T01:00:00.000Z",
      lastAckedOpSeq: 42,
    });

    const renewed = await renewSyncSession("doc_1", {
      sessionId: "session_1",
      sessionEpoch: 3,
    });

    expect(apiPost).toHaveBeenCalledWith("/documents/doc_1/sync-session/renew", {
      sessionId: "session_1",
      sessionEpoch: 3,
    });
    expect(renewed.lastAckedOpSeq).toBe(42);
  });

  it("only sends the sync session identity when renewing a lease", async () => {
    apiPost.mockResolvedValue({
      sessionId: "session_1",
      sessionEpoch: 3,
      leaseExpiresAt: "2026-06-05T01:00:00.000Z",
      lastAckedOpSeq: 42,
    });

    await renewSyncSession("doc_1", {
      sessionId: "session_1",
      sessionEpoch: 3,
      leaseExpiresAt: "2026-06-05T00:55:00.000Z",
      lastAckedOpSeq: 7,
    } as Parameters<typeof renewSyncSession>[1]);

    expect(apiPost).toHaveBeenCalledWith("/documents/doc_1/sync-session/renew", {
      sessionId: "session_1",
      sessionEpoch: 3,
    });
  });

  it("acquires a fresh sync session from the acquire endpoint", async () => {
    apiPost.mockResolvedValue({
      sessionId: "session_2",
      sessionEpoch: 4,
      leaseExpiresAt: "2026-06-07T10:00:00.000Z",
      lastAckedOpSeq: 8,
    });

    const acquired = await acquireSyncSession("doc_1");

    expect(apiPost).toHaveBeenCalledWith("/documents/doc_1/sync-session/acquire");
    expect(acquired).toMatchObject({
      sessionId: "session_2",
      sessionEpoch: 4,
      lastAckedOpSeq: 8,
    });
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("useDocumentSync source guards", () => {
  it("does not treat delete acknowledgements as create acknowledgements", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    const createMappingsAt = hookSource.indexOf("const createMappings = response.results");
    const operationCreateAt = hookSource.indexOf(
      'result.operation === "create"',
      createMappingsAt,
    );
    const collectOrphanedAt = hookSource.indexOf(
      "collectOrphanedCreateDeletes(",
      createMappingsAt,
    );

    expect(createMappingsAt).toBeGreaterThanOrEqual(0);
    expect(operationCreateAt).toBeGreaterThan(createMappingsAt);
    expect(operationCreateAt).toBeLessThan(collectOrphanedAt);
  });

  it("does not patch deleted blocks back into the editor snapshot", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    const serverAckMappingsAt = hookSource.indexOf(
      "const serverAckMappings = response.results",
    );
    const operationDeleteAt = hookSource.indexOf(
      'result.operation !== "delete"',
      serverAckMappingsAt,
    );
    const deleteAckAt = hookSource.indexOf(
      "const deleteAckMappings = response.results",
      serverAckMappingsAt,
    );
    const deleteAckApplyAt = hookSource.indexOf(
      "applyServerDeleteAck(nextDoc, deleteAckMappings)",
      serverAckMappingsAt,
    );

    expect(serverAckMappingsAt).toBeGreaterThanOrEqual(0);
    expect(operationDeleteAt).toBeGreaterThan(serverAckMappingsAt);
    expect(deleteAckAt).toBeGreaterThan(operationDeleteAt);
    expect(deleteAckApplyAt).toBeGreaterThan(deleteAckAt);
  });

  it("deduplicates idle manifest reconciliation requests", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    const lastKeyRefAt = hookSource.indexOf("lastReconciledManifestKeyRef");
    const manifestKeyAt = hookSource.indexOf("const manifestKey = buildReconcileKey");
    const keyGuardAt = hookSource.indexOf(
      "lastReconciledManifestKeyRef.current === manifestKey",
      manifestKeyAt,
    );
    const postReconcileAt = hookSource.indexOf("postSyncManifestReconcile", manifestKeyAt);

    expect(lastKeyRefAt).toBeGreaterThanOrEqual(0);
    expect(manifestKeyAt).toBeGreaterThan(lastKeyRefAt);
    expect(keyGuardAt).toBeGreaterThan(manifestKeyAt);
    expect(keyGuardAt).toBeLessThan(postReconcileAt);
  });

  it("runs draft checkpoint before commit action in the manual save barrier", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );
    const barrierIndex = hookSource.indexOf("const flushAndCommitBarrier");
    const checkpointIndex = hookSource.indexOf("await runDraftCheckpoint", barrierIndex);
    const commitIndex = hookSource.indexOf("await commitAction()", barrierIndex);

    expect(barrierIndex).toBeGreaterThan(-1);
    expect(checkpointIndex).toBeGreaterThan(barrierIndex);
    expect(commitIndex).toBeGreaterThan(checkpointIndex);
  });

  it("falls back to draft checkpoint after repeated batch failures", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    expect(hookSource).toContain("batchFailureCountRef");
    expect(hookSource).toContain("MAX_BATCH_FAILURES_BEFORE_CHECKPOINT");
    expect(hookSource).toContain("await runDraftCheckpoint(latestContentRef.current)");
  });

  it("re-acquires a sync session only for expired or required lease failures", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    const renewCatchAt = hookSource.indexOf(".catch((error) => {");
    const expiredCheckAt = hookSource.indexOf('message.includes("SYNC_SESSION_EXPIRED")', renewCatchAt);
    const requiredCheckAt = hookSource.indexOf('message.includes("SYNC_SESSION_REQUIRED")', renewCatchAt);
    const recoverAt = hookSource.indexOf("recoverExpiredSyncSession()", renewCatchAt);
    const lostAt = hookSource.indexOf("markSyncSessionLost(current, message)", recoverAt);

    expect(renewCatchAt).toBeGreaterThanOrEqual(0);
    expect(expiredCheckAt).toBeGreaterThan(renewCatchAt);
    expect(requiredCheckAt).toBeGreaterThan(expiredCheckAt);
    expect(recoverAt).toBeGreaterThan(requiredCheckAt);
    expect(lostAt).toBeGreaterThan(recoverAt);
  });

  it("updates reducer session metadata and clears errors after session recovery", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    const recoverFnAt = hookSource.indexOf("const recoverExpiredSyncSession");
    const acquireAt = hookSource.indexOf("const recovered = await acquireSyncSession(docId);", recoverFnAt);
    const callbackAt = hookSource.indexOf("onSessionRecovered?.(recovered);", acquireAt);
    const sessionIdAt = hookSource.indexOf("sessionId: recovered.sessionId", callbackAt);
    const sessionEpochAt = hookSource.indexOf("sessionEpoch: recovered.sessionEpoch", sessionIdAt);
    const ackAt = hookSource.indexOf("lastAckedOpSeq: recovered.lastAckedOpSeq ?? current.lastAckedOpSeq", sessionEpochAt);
    const stateAt = hookSource.indexOf('syncState: current.dirtyOrder.length > 0 ? "dirty" : "idle"', ackAt);
    const errorClearAt = hookSource.indexOf("lastError: null", stateAt);

    expect(recoverFnAt).toBeGreaterThanOrEqual(0);
    expect(acquireAt).toBeGreaterThan(recoverFnAt);
    expect(callbackAt).toBeGreaterThan(acquireAt);
    expect(sessionIdAt).toBeGreaterThan(callbackAt);
    expect(sessionEpochAt).toBeGreaterThan(sessionIdAt);
    expect(ackAt).toBeGreaterThan(sessionEpochAt);
    expect(stateAt).toBeGreaterThan(ackAt);
    expect(errorClearAt).toBeGreaterThan(stateAt);
  });

  it("resyncs draftRevision and retries flush on DRAFT_REVISION_MISMATCH", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    expect(hookSource).toContain("isDraftRevisionMismatchOnly");
    expect(hookSource).toContain("adoptServerDraftRevision");
    expect(hookSource).toContain('"flush:draft-revision-resync"');
    const mismatchAt = hookSource.indexOf("isDraftRevisionMismatchOnly(response.conflicts)");
    const continueAt = hookSource.indexOf("continue;", mismatchAt);
    expect(mismatchAt).toBeGreaterThanOrEqual(0);
    expect(continueAt).toBeGreaterThan(mismatchAt);
  });

  it("repairs sort keys before idle manifest digest comparison", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    const reconcileAt = hookSource.indexOf("const reconcileIdleManifest = useCallback");
    const repairAt = hookSource.indexOf("repairSnapshotSortKeyOrder(stateForRepair, snapshot)", reconcileAt);
    const digestAt = hookSource.indexOf("computeRootManifestDigest(snapshot)", repairAt);

    expect(reconcileAt).toBeGreaterThanOrEqual(0);
    expect(repairAt).toBeGreaterThan(reconcileAt);
    expect(digestAt).toBeGreaterThan(repairAt);
  });

  it("turns sync session conflicts from reconcile or batch into lease-lost state", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    const reconcileNeedsReloadAt = hookSource.indexOf("if (response.needsReload) {");
    const reconcileLostAt = hookSource.indexOf('markSyncSessionLost(prev, "当前编辑会话已失效，请刷新后继续编辑")', reconcileNeedsReloadAt);
    const flushNeedsReloadAt = hookSource.indexOf("if (response.needsReload) {", reconcileNeedsReloadAt + 1);
    const batchSessionCheckAt = hookSource.indexOf(
      "isSyncSessionConflict(response.conflicts)",
      flushNeedsReloadAt,
    );
    const batchLostAt = hookSource.indexOf('markSyncSessionLost(', batchSessionCheckAt);

    expect(reconcileNeedsReloadAt).toBeGreaterThanOrEqual(0);
    expect(reconcileLostAt).toBeGreaterThan(reconcileNeedsReloadAt);
    expect(flushNeedsReloadAt).toBeGreaterThan(reconcileLostAt);
    expect(batchSessionCheckAt).toBeGreaterThan(flushNeedsReloadAt);
    expect(batchLostAt).toBeGreaterThan(batchSessionCheckAt);
  });

  it("rescans batch ack baseline from live editor content instead of stale React state", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    const resolvedAt = hookSource.indexOf("resolveBatchSuccess(");
    const ackBaselineAt = hookSource.indexOf("const ackBaseline = applyBatchAckToDoc(", resolvedAt);
    const liveContentAt = hookSource.indexOf("getLiveContent?.()", ackBaselineAt);
    const rescanAt = hookSource.indexOf(
      'captureContentSnapshot(ackBaseline, "batch-ack-rescan"',
      ackBaselineAt,
    );
    const ackRescanOptionsAt = hookSource.indexOf(
      "const ackRescanOptions: SyncSnapshotCaptureOptions",
    );
    const suppressMoveAt = hookSource.indexOf("suppressMoveDerivation: true", ackRescanOptionsAt);
    const mismatchAt = hookSource.indexOf("recordMoveAckSuppression(", resolvedAt);
    const editorPatchAt = hookSource.indexOf("onContentPatched(ackBaseline)", rescanAt);

    expect(ackBaselineAt).toBeGreaterThan(resolvedAt);
    expect(liveContentAt).toBeGreaterThan(ackBaselineAt);
    expect(rescanAt).toBeGreaterThan(liveContentAt);
    expect(ackRescanOptionsAt).toBeGreaterThanOrEqual(0);
    expect(suppressMoveAt).toBeGreaterThan(ackRescanOptionsAt);
    expect(mismatchAt).toBeGreaterThan(resolvedAt);
    expect(editorPatchAt).toBeGreaterThan(rescanAt);
  });

  it("marks batch manifest digest as reconciled before idle reconcile can post", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    const helperAt = hookSource.indexOf(
      "const markCurrentManifestReconciledIfDigestMatches",
    );
    const digestCompareAt = hookSource.indexOf(
      "localDigest !== serverDigest",
      helperAt,
    );
    const markKeyAt = hookSource.indexOf(
      "lastReconciledManifestKeyRef.current = buildReconcileKey",
      digestCompareAt,
    );
    const ackRescanAt = hookSource.indexOf(
      'captureContentSnapshot(ackBaseline, "batch-ack-rescan"',
    );
    const markCallAt = hookSource.indexOf(
      "await markCurrentManifestReconciledIfDigestMatches()",
      ackRescanAt,
    );
    const batchFailureAt = hookSource.indexOf("if (batchFailure)", ackRescanAt);

    expect(helperAt).toBeGreaterThanOrEqual(0);
    expect(digestCompareAt).toBeGreaterThan(helperAt);
    expect(markKeyAt).toBeGreaterThan(digestCompareAt);
    expect(ackRescanAt).toBeGreaterThanOrEqual(0);
    expect(markCallAt).toBeGreaterThan(ackRescanAt);
    expect(markCallAt).toBeLessThan(batchFailureAt);
  });

  it("keeps indexed diff metadata outside React state and consumes hints during snapshot capture", () => {
    const hookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/useDocumentSync.ts"),
      "utf8",
    );

    const indexRefAt = hookSource.indexOf("const snapshotIndexRef = useRef");
    const hintArgAt = hookSource.indexOf("consumeDiffHint?:");
    const consumeAt = hookSource.indexOf("const diffHint = consumeDiffHint?.(nextContent)", indexRefAt);
    const indexedAdvanceAt = hookSource.indexOf("advanceSyncSnapshotIndexed(", consumeAt);
    const indexPassAt = hookSource.indexOf("snapshotIndexRef.current,", indexedAdvanceAt);
    const indexUpdateAt = hookSource.indexOf("snapshotIndexRef.current = advanced.index", indexedAdvanceAt);

    expect(indexRefAt).toBeGreaterThanOrEqual(0);
    expect(hintArgAt).toBeGreaterThanOrEqual(0);
    expect(consumeAt).toBeGreaterThan(indexRefAt);
    expect(indexedAdvanceAt).toBeGreaterThan(consumeAt);
    expect(indexPassAt).toBeGreaterThan(indexedAdvanceAt);
    expect(indexUpdateAt).toBeGreaterThan(indexPassAt);
  });
});

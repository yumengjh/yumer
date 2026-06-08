import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("GcDebugModal policy visibility", () => {
  it("renders structured policy snapshot details for each GC run", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/GcDebugModal.tsx"),
      "utf8",
    );

    expect(source).toContain("function formatDuration");
    expect(source).toContain("function formatPolicySummary");
    expect(source).toContain("本次 run 固化的策略快照");
    expect(source).toContain("普通候选宽限期");
    expect(source).toContain("Tombstone 宽限期");
    expect(source).toContain("record.policySnapshot");
  });

  it("renders new decision model fields in candidate table and detail drawer", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/GcDebugModal.tsx"),
      "utf8",
    );

    // New primary fields
    expect(source).toContain("candidateClass");
    expect(source).toContain("CANDIDATE_CLASS_LABELS");
    expect(source).toContain("decisionReasons");
    expect(source).toContain("判定原因");
    expect(source).toContain("未引用旧版本");

    // Candidate table columns
    expect(source).toContain("候选类别");
    expect(source).toContain("Root Kind");

    // Detail drawer sections
    expect(source).toContain("Drawer");
    expect(source).toContain("selectedCandidate");
    expect(source).toContain("基本信息");
    expect(source).toContain("扫描范围");

    // Legacy risk/readiness transition fields are intentionally removed.
    expect(source).not.toContain("riskAssessment");
    expect(source).not.toContain("plannedAction");
    expect(source).not.toContain("requiredChecks");
    expect(source).not.toContain("readiness");
    expect(source).not.toContain("Readiness");
    expect(source).not.toContain("Risk");
    expect(source).not.toContain("兼容字段");
    expect(source).not.toContain("仍需补验证");
    expect(source).not.toContain("风险分");
  });

  it("renders candidate pool explorer with state/action filters", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/GcDebugModal.tsx"),
      "utf8",
    );

    // Pool explorer
    expect(source).toContain("Candidate Pool");
    expect(source).toContain("getGcCandidatePool");
    expect(source).toContain("poolStateFilter");
    expect(source).toContain("poolActionFilter");
    expect(source).toContain("POOL_STATE_LABELS");
    expect(source).toContain("刷新 Pool");

    // Pool state labels
    expect(source).toContain("待晋升");
    expect(source).toContain("可执行");
    expect(source).toContain("已清理");
    expect(source).toContain("已阻断");
    expect(source).toContain("已复活");

    // Root-entry fields
    expect(source).toContain("rootRefType");
    expect(source).toContain("rootRefId");
    expect(source).toContain("rootRefKey");
    expect(source).toContain("ROOT_REF_TYPE_LABELS");
  });

  it("distinguishes swept pool state by action and keeps long tables locally scrollable", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/GcDebugModal.tsx"),
      "utf8",
    );
    const style = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/GcDebugModal.css"),
      "utf8",
    );

    expect(source).toContain("function getPoolStateLabel");
    expect(source).toContain("版本已删除");
    expect(source).toContain("引用已压缩");
    expect(source).toContain("gc-debug__layout");
    expect(source).toContain("gc-debug__table-scroll");
    expect(source).toContain("scroll={{ x: 960, y: 360 }}");

    expect(style).toContain(".gc-debug__table-scroll");
    expect(style).toContain("max-height: 420px");
    expect(style).toContain("overflow: auto");
  });

  it("renders sweep console with dry-run and real sweep buttons", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/GcDebugModal.tsx"),
      "utf8",
    );

    // Sweep console
    expect(source).toContain("Sweep Console");
    expect(source).toContain("sweepDraftTombstones");
    expect(source).toContain("sweepRevisionTombstones");
    expect(source).toContain("Draft Tombstones");
    expect(source).toContain("Revision Tombstones");
    expect(source).toContain("Dry-run");
    expect(source).toContain("sweepDryRun");
    expect(source).toContain("sweepLimit");
    expect(source).toContain("DEFAULT_SWEEP_LIMIT");
    expect(source).toContain("maxSweepBatchSize");

    // Block version sweep
    expect(source).toContain("sweepBlockVersions");
    expect(source).toContain("Block Versions");
    expect(source).toContain("Popconfirm");
    expect(source).toContain("物理删除");

    // Mode column in runs table
    expect(source).toContain("RUN_MODE_LABELS");
    expect(source).toContain("GcRunMode");
    expect(source).toContain("mode");

    // Mode filter
    expect(source).toContain("runModeFilter");
    expect(source).toContain("loadRunsByMode");

    // Policy display
    expect(source).toContain("getGcPolicy");
    expect(source).toContain("GcPolicyDefaults");
    expect(source).toContain("policy");

    // Blocker labels
    expect(source).toContain("BLOCKER_LABELS");
    expect(source).toContain("block_latest_version");
    expect(source).toContain("snapshot_root_present");
    expect(source).toContain("draft_root_present");

    // candidateDetailsTruncated warning
    expect(source).toContain("candidateDetailsTruncated");
    expect(source).toContain("本次 candidates 明细被截断");

    // Health blocked guard
    expect(source).toContain("Health blocked");

    // Sweep summary fields
    expect(source).toContain("wouldDeleteCandidates");
    expect(source).toContain("deletedBlockVersions");
    expect(source).toContain("blockedCandidates");
    expect(source).toContain("筛选 blocked 查看原因");

    // Storage maintenance
    expect(source).toContain("Storage Maintenance");
    expect(source).toContain("compactSqliteStorage");
    expect(source).toContain("VACUUM");
    expect(source).toContain("GcStorageCompactResult");
    expect(source).toContain("VACUUM_SQLITE_DATABASE");
    expect(source).toContain("freelistCount");
    expect(source).toContain("estimatedFreeBytes");
    expect(source).toContain("databaseFileBytes");
    expect(source).toContain("totalFileBytes");
    expect(source).toContain("freeRatio");
    expect(source).toContain("unchangedReasons");
  });

  it("renders render cache GC controls and scoped status output", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/GcDebugModal.tsx"),
      "utf8",
    );

    expect(source).toContain("getRenderCacheGcStatus");
    expect(source).toContain("sweepRenderCachePublishedReachability");
    expect(source).toContain("renderCacheStatus");
    expect(source).toContain("renderCacheRun");
    expect(source).toContain("handleRenderCacheRefresh");
    expect(source).toContain("handleRenderCacheSweep");
    expect(source).toContain("Render Cache GC");
    expect(source).toContain("Delete Reasons");
  });
});

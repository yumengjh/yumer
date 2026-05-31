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
    expect(source).toContain("兼容字段");
    expect(source).toContain("扫描范围");

    // Compat fields still present
    expect(source).toContain("riskAssessment");
    expect(source).toContain("plannedAction");
    expect(source).toContain("requiredChecks");
    expect(source).toContain("readiness");
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

    // Mode column in runs table
    expect(source).toContain("RUN_MODE_LABELS");
    expect(source).toContain("GcRunMode");
    expect(source).toContain("mode");

    // candidateDetailsTruncated warning
    expect(source).toContain("candidateDetailsTruncated");
    expect(source).toContain("本次 candidates 明细被截断");

    // Health blocked guard
    expect(source).toContain("Health blocked");
  });
});

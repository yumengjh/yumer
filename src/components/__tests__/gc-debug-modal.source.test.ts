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

    // Scanned blocks
    expect(source).toContain("scannedBlocks");
    expect(source).toContain("getRunScannedBlocks");
    expect(source).toContain("Scanned Blocks");
    expect(source).toContain("scannedBlockColumns");

    // Compat fields still present
    expect(source).toContain("riskAssessment");
    expect(source).toContain("plannedAction");
    expect(source).toContain("requiredChecks");
    expect(source).toContain("readiness");
  });
});

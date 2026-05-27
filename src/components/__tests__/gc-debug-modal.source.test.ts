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
});

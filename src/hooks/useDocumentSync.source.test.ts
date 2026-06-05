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
    const applyServerAckAt = hookSource.indexOf(
      "applyServerAck(currentSnapshot, serverAckMappings)",
      serverAckMappingsAt,
    );

    expect(serverAckMappingsAt).toBeGreaterThanOrEqual(0);
    expect(operationDeleteAt).toBeGreaterThan(serverAckMappingsAt);
    expect(operationDeleteAt).toBeLessThan(applyServerAckAt);
  });
});

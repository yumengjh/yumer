import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("SyncDebugModal source guards", () => {
  it("surfaces incidents, deleted identity watches, and user bookmarks", () => {
    const modalSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/SyncDebugModal.tsx"),
      "utf8",
    );
    const headerSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocumentHeader.tsx"),
      "utf8",
    );

    expect(modalSource).toContain("SyncIdentityWatch.getIncidents");
    expect(modalSource).toContain("SyncIdentityWatch.getDeleted");
    expect(modalSource).toContain('"debug:bookmark"');
    expect(modalSource).toContain("identity:resurrected");
    expect(modalSource).toContain("标记现场");
    expect(headerSource).toContain("docId={currentDoc?.docId}");
    expect(headerSource).toContain("docTitle={currentDoc?.title}");
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MarkdownEditor sync diff hint source guards", () => {
  it("aggregates transaction diff hints and emits them with the debounced content change", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/editor-kit/MarkdownEditor.tsx"),
      "utf8",
    );

    const propAt = source.indexOf(
      "onChange?: (content: EditorContentType, syncDiffHint?: SyncDiffHint) => void;",
    );
    const pendingRefAt = source.indexOf("const pendingSyncDiffHintRef = useRef");
    const deriveAt = source.indexOf("function deriveTransactionSyncDiffHint");
    const mergeAt = source.indexOf("mergeSyncDiffHints(", pendingRefAt);
    const readPendingAt = source.indexOf("const syncDiffHint = pendingSyncDiffHintRef.current");
    const emitAt = source.indexOf("emitChange(nextContent, syncDiffHint ?? undefined)");

    expect(propAt).toBeGreaterThanOrEqual(0);
    expect(deriveAt).toBeGreaterThanOrEqual(0);
    expect(pendingRefAt).toBeGreaterThan(deriveAt);
    expect(mergeAt).toBeGreaterThan(pendingRefAt);
    expect(readPendingAt).toBeGreaterThan(pendingRefAt);
    expect(emitAt).toBeGreaterThan(readPendingAt);
  });
});

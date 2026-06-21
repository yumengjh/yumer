import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MarkdownEditor sync diff hint source guards", () => {
  it("keeps the exported forwardRef component stable for Fast Refresh", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/editor-kit/MarkdownEditor.tsx"),
      "utf8",
    );

    expect(source).toContain("const MarkdownEditor = forwardRef<");
    expect(source).not.toContain("memo(MarkdownEditorComponent)");
  });

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

  it("collects transaction diff identities from touched ranges instead of scanning all top-level blocks", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/editor-kit/MarkdownEditor.tsx"),
      "utf8",
    );

    const collectAt = source.indexOf("function collectTopLevelSyncIdentitiesInRange");
    const selectionAt = source.indexOf("function collectSelectionSyncIdentity", collectAt);
    const collectBody = source.slice(collectAt, selectionAt);

    expect(collectAt).toBeGreaterThanOrEqual(0);
    expect(selectionAt).toBeGreaterThan(collectAt);
    expect(collectBody).toContain("doc.nodesBetween(");
    expect(collectBody).not.toContain("doc.forEach(");
  });

  it("keeps debounced getJSON content emission ordered without an idle queue", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/editor-kit/MarkdownEditor.tsx"),
      "utf8",
    );

    const scheduleAt = source.indexOf("const schedulePendingChange = useCallback");
    const timerAt = source.indexOf(
      "setTimeout(flushPendingChange, CHANGE_EMIT_DELAY_MS)",
      scheduleAt,
    );

    expect(scheduleAt).toBeGreaterThanOrEqual(0);
    expect(timerAt).toBeGreaterThan(scheduleAt);
    expect(source).not.toContain("CHANGE_EMIT_IDLE_TIMEOUT_MS");
    expect(source).not.toContain("requestIdleCallback");
  });
});

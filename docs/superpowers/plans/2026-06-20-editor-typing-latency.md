# Editor Typing Latency Implementation Plan

> **Status:** Historical execution plan. Runtime evidence changed the implementation after the initial render-isolation tasks: `memo(forwardRef)` was rejected after a Fast Refresh runtime failure, and the final root causes were Tiptap NodeView position checks plus synchronous sync-trace persistence. See `docs/superpowers/reports/2026-06-21-editor-typing-latency-retrospective.md` for the implemented result and measured evidence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 300–500ms React/rAF work triggered by ordinary editor typing without changing content or sync event ordering.

**Architecture:** Keep ProseMirror as the immediate editing surface, isolate its React subtree behind a stable memo boundary, and prevent auxiliary UI features from turning every transaction into React state or layout work. Preserve immediate content refs and ordered `onUpdate` emission; optimize only rendering and auxiliary event fan-out.

**Tech Stack:** React 19, Next.js 16, Tiptap/ProseMirror, TypeScript, Vitest, ESLint

---

## File map

- `src/modules/editor-kit/perfTrace.ts`: development tracing policy and console output.
- `src/modules/editor-kit/perfTrace.test.ts`: trace enable/disable behavior.
- `src/components/EditorPage.tsx`: stable editor props and React Profiler boundary.
- `src/components/__tests__/editor-live-content.source.test.ts`: render-boundary regression guards.
- `src/modules/editor-kit/MarkdownEditor.tsx`: memoized editor component boundary.
- `src/modules/editor-kit/MarkdownEditor.source.test.ts`: memo/export and ordered emission guards.
- `src/modules/editor-kit/BlockToolbar/index.tsx`: transaction handling without forced React refreshes.
- `src/modules/editor-kit/BlockToolbar/index.source.test.ts`: toolbar hot-path regression guard.
- `src/components/FindReplaceBar/index.tsx`: active lifecycle state for search.
- `src/components/FindReplaceBar/useFindReplace.ts`: inactive/empty-query scheduling policy.
- `src/components/FindReplaceBar/useFindReplace.test.ts`: scheduling policy tests.
- `src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.tsx`: coalesced frame scheduling.
- `src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.source.test.ts`: floating-toolbar hot-path guards.

### Task 1: Make development performance evidence reliable

**Files:**
- Modify: `src/modules/editor-kit/perfTrace.test.ts`
- Modify: `src/modules/editor-kit/perfTrace.ts`
- Modify: `src/modules/editor-kit/editor-perf-instrumentation.source.test.ts`
- Modify: `src/components/EditorPage.tsx`

- [ ] **Step 1: Write failing trace-policy tests**

Add these cases to `perfTrace.test.ts`:

```ts
it("defaults to enabled in development", () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(isEditorPerfTraceEnabled()).toBe(true);
});

it("allows development tracing to be explicitly disabled", () => {
  vi.stubEnv("NODE_ENV", "development");
  localStorage.setItem(EDITOR_PERF_TRACE_STORAGE_KEY, "0");
  expect(isEditorPerfTraceEnabled()).toBe(false);
});
```

Update the existing disabled-by-default test so it stubs `NODE_ENV` to `production` before its first assertion.

- [ ] **Step 2: Run the trace test and verify RED**

Run: `pnpm exec vitest run src/modules/editor-kit/perfTrace.test.ts`

Expected: the development-default test fails because a missing localStorage flag currently returns `false`.

- [ ] **Step 3: Implement the minimal development-default policy**

```ts
export function isEditorPerfTraceEnabled(): boolean {
  const flag = readTraceFlag();
  if (flag === null) return process.env.NODE_ENV !== "production";
  return flag === "1" || flag === "true" || flag === "yes";
}
```

This keeps production opt-in behavior and lets `0` explicitly suppress noisy development logs.

- [ ] **Step 4: Add a failing Profiler instrumentation guard**

In `editor-perf-instrumentation.source.test.ts`, add:

```ts
expect(pageSource).toContain('<Profiler id="MarkdownEditor"');
expect(pageSource).toContain('traceEditorPerf("EditorPage.MarkdownEditor.render"');
```

- [ ] **Step 5: Run the instrumentation test and verify RED**

Run: `pnpm exec vitest run src/modules/editor-kit/editor-perf-instrumentation.source.test.ts`

Expected: FAIL because no React Profiler surrounds the editor subtree.

- [ ] **Step 6: Add the Profiler boundary**

Import `Profiler`, `ProfilerOnRenderCallback`, and `traceEditorPerf` in `EditorPage.tsx`, then add:

```ts
const handleEditorProfilerRender = useCallback<ProfilerOnRenderCallback>(
  (_id, phase, actualDuration, baseDuration) => {
    traceEditorPerf("EditorPage.MarkdownEditor.render", actualDuration, {
      phase,
      baseDuration: Math.round(baseDuration * 100) / 100,
    });
  },
  [],
);
```

Wrap only the existing editor element:

```tsx
<Profiler id="MarkdownEditor" onRender={handleEditorProfilerRender}>
  <MarkdownEditor
    ref={editorRef}
    content={content}
    onChange={handleEditorChange}
    placeholder="不用完美，先留下痕迹"
    showToolbar={showFixedToolbar}
    floatingToolbarEnabled={toolbarPreferences.floatingToolbarEnabled}
    floatingToolbarItemIds={floatingToolbarItemIds}
    floatingToolbarDelayMs={toolbarPreferences.floatingToolbarDelayMs}
    showTOC={showTOC}
    onTOCToggle={setShowTOC}
    loading={loadingDoc}
    defaultFontSize={activeSettingsState.effectiveSettings.editor.fontSize}
    contentWidth={activeSettingsState.effectiveSettings.editor.contentWidth}
    title={currentDoc?.title ?? ""}
    onTitleChange={handleTitleChange}
    onUploadImage={handleUploadImage}
    style={
      {
        "--app-editor-font-size": `${activeSettingsState.effectiveSettings.editor.fontSize}px`,
        "--app-editor-content-width": `${activeSettingsState.effectiveSettings.editor.contentWidth}px`,
      } as CSSProperties
    }
  />
</Profiler>
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run src/modules/editor-kit/perfTrace.test.ts src/modules/editor-kit/editor-perf-instrumentation.source.test.ts`

Expected: all tests pass.

- [ ] **Step 8: Commit the diagnostic boundary**

```bash
git add src/modules/editor-kit/perfTrace.ts src/modules/editor-kit/perfTrace.test.ts src/modules/editor-kit/editor-perf-instrumentation.source.test.ts src/components/EditorPage.tsx
git commit -m "chore(editor): expose render latency tracing"
```

### Task 2: Isolate the MarkdownEditor React subtree

**Files:**
- Modify: `src/modules/editor-kit/MarkdownEditor.source.test.ts`
- Modify: `src/modules/editor-kit/MarkdownEditor.tsx`
- Modify: `src/components/__tests__/editor-live-content.source.test.ts`
- Modify: `src/components/EditorPage.tsx`

- [ ] **Step 1: Write failing memo-boundary tests**

Add source assertions:

```ts
const markdownEditorSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/modules/editor-kit/MarkdownEditor.tsx"),
  "utf8",
);
expect(markdownEditorSource).toContain("const MarkdownEditorComponent = forwardRef<");
expect(markdownEditorSource).toContain("const MarkdownEditor = memo(MarkdownEditorComponent);");

const editorPageSource = readFileSync("src/components/EditorPage.tsx", "utf8");
expect(editorPageSource).toContain("const markdownEditorStyle = useMemo<CSSProperties>");
expect(editorPageSource).toContain("style={markdownEditorStyle}");
```

- [ ] **Step 2: Run the source tests and verify RED**

Run: `pnpm exec vitest run src/modules/editor-kit/MarkdownEditor.source.test.ts src/components/__tests__/editor-live-content.source.test.ts`

Expected: FAIL because MarkdownEditor is only a `forwardRef` component and EditorPage creates the style object inline.

- [ ] **Step 3: Memoize MarkdownEditor without a custom comparator**

Import `memo`, rename the forward-ref component, and memoize it:

```diff
-import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
+import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, memo, useImperativeHandle } from "react";

-const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(function MarkdownEditor({
+const MarkdownEditorComponent = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(function MarkdownEditor({
   content = "",
   onChange,
   editable = true,

+const MarkdownEditor = memo(MarkdownEditorComponent);
 export default MarkdownEditor;
```

Do not add a custom comparator: all business props must continue to participate in normal shallow comparison.

- [ ] **Step 4: Stabilize the EditorPage style prop**

```ts
const markdownEditorStyle = useMemo<CSSProperties>(
  () => ({
    "--app-editor-font-size": `${activeSettingsState.effectiveSettings.editor.fontSize}px`,
    "--app-editor-content-width": `${activeSettingsState.effectiveSettings.editor.contentWidth}px`,
  }),
  [
    activeSettingsState.effectiveSettings.editor.contentWidth,
    activeSettingsState.effectiveSettings.editor.fontSize,
  ],
);
```

Replace the inline style object with `style={markdownEditorStyle}`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run src/modules/editor-kit/MarkdownEditor.source.test.ts src/components/__tests__/editor-live-content.source.test.ts`

Expected: all tests pass, including the guard that local typing does not call `setContent(nextContent)`.

- [ ] **Step 6: Commit the render isolation**

```bash
git add src/modules/editor-kit/MarkdownEditor.tsx src/modules/editor-kit/MarkdownEditor.source.test.ts src/components/EditorPage.tsx src/components/__tests__/editor-live-content.source.test.ts
git commit -m "perf(editor): isolate editor render subtree"
```

### Task 3: Remove BlockToolbar’s unconditional transaction refresh

**Files:**
- Modify: `src/modules/editor-kit/BlockToolbar/index.source.test.ts`
- Modify: `src/modules/editor-kit/BlockToolbar/index.tsx`

- [ ] **Step 1: Write the failing hot-path guard**

```ts
expect(source).toContain("const targetDetached =");
expect(source).toContain("if (!targetDetached) return;");
expect(source).not.toContain("updateCount");
```

- [ ] **Step 2: Run the toolbar source test and verify RED**

Run: `pnpm exec vitest run src/modules/editor-kit/BlockToolbar/index.source.test.ts`

Expected: FAIL because every connected target currently increments `updateCount`.

- [ ] **Step 3: Implement the connected-target early return**

Delete the `updateCount` state and remove it from effect dependencies. Replace the detached-target condition with:

```ts
const targetDetached =
  (currentBlock && !editorDom.contains(currentBlock)) ||
  (currentAnchor && !editorDom.contains(currentAnchor));

if (!targetDetached) return;
```

Keep the existing fallback lookup and state updates below this guard. Remove all `setUpdateCount` calls because changing `hoveredBlock`/`hoveredAnchor` already triggers positioning effects.

- [ ] **Step 4: Run the toolbar test and verify GREEN**

Run: `pnpm exec vitest run src/modules/editor-kit/BlockToolbar/index.source.test.ts`

Expected: PASS; valid targets no longer cause React/layout work.

- [ ] **Step 5: Commit the toolbar fix**

```bash
git add src/modules/editor-kit/BlockToolbar/index.tsx src/modules/editor-kit/BlockToolbar/index.source.test.ts
git commit -m "perf(editor): skip no-op block toolbar refreshes"
```

### Task 4: Stop inactive FindReplace transaction fan-out

**Files:**
- Create: `src/components/FindReplaceBar/useFindReplace.test.ts`
- Modify: `src/components/FindReplaceBar/useFindReplace.ts`
- Modify: `src/components/FindReplaceBar/index.tsx`

- [ ] **Step 1: Write the failing scheduling-policy test**

```ts
import { describe, expect, it } from "vitest";
import { shouldScheduleFindReplaceRefresh } from "./useFindReplace";

describe("shouldScheduleFindReplaceRefresh", () => {
  it("requires both an active panel and a non-empty query", () => {
    expect(shouldScheduleFindReplaceRefresh(false, "word")).toBe(false);
    expect(shouldScheduleFindReplaceRefresh(true, "")).toBe(false);
    expect(shouldScheduleFindReplaceRefresh(true, "word")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run: `pnpm exec vitest run src/components/FindReplaceBar/useFindReplace.test.ts`

Expected: FAIL because `shouldScheduleFindReplaceRefresh` does not exist.

- [ ] **Step 3: Add active state and the scheduling policy**

```ts
interface UseFindReplaceOptions {
  editor: Editor | null;
  active?: boolean;
  highlightColor?: string;
  activeHighlightColor?: string;
}

export function shouldScheduleFindReplaceRefresh(active: boolean, query: string): boolean {
  return active && query.length > 0;
}
```

Default `active = true` in the hook to preserve other callers.

- [ ] **Step 4: Coalesce active document-update searches**

```ts
useEffect(() => {
  if (!editor || !shouldScheduleFindReplaceRefresh(active, query)) return;
  let frameId: number | null = null;
  const handler = () => {
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      doSearch(query, caseSensitive, currentIndex);
    });
  };
  editor.on("update", handler);
  return () => {
    editor.off("update", handler);
    if (frameId !== null) cancelAnimationFrame(frameId);
  };
}, [active, caseSensitive, currentIndex, doSearch, editor, query]);
```

Keep the query-change effect so resetting the query clears decorations. Pass `active: visible` from `FindReplaceBar/index.tsx`:

```ts
} = useFindReplace({ editor, active: visible });
```

- [ ] **Step 5: Run the FindReplace test and verify GREEN**

Run: `pnpm exec vitest run src/components/FindReplaceBar/useFindReplace.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the FindReplace fix**

```bash
git add src/components/FindReplaceBar/useFindReplace.ts src/components/FindReplaceBar/useFindReplace.test.ts src/components/FindReplaceBar/index.tsx
git commit -m "perf(editor): suspend inactive find refreshes"
```

### Task 5: Coalesce FloatingSelectionToolbar frames

**Files:**
- Create: `src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.source.test.ts`
- Modify: `src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.tsx`

- [ ] **Step 1: Write the failing source test**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./FloatingSelectionToolbar.tsx", import.meta.url)),
  "utf8",
);

describe("FloatingSelectionToolbar scheduling", () => {
  it("coalesces events into one frame and avoids duplicate visibility writes", () => {
    expect(source).toContain("if (animationFrameRef.current !== null) return;");
    expect(source).toContain("if (isVisibleRef.current === nextVisible) return;");
    expect(source).toContain("cancelAnimationFrame(animationFrameRef.current)");
  });
});
```

- [ ] **Step 2: Run the source test and verify RED**

Run: `pnpm exec vitest run src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.source.test.ts`

Expected: FAIL because every event queues a new frame.

- [ ] **Step 3: Add idempotent visibility and frame refs**

```ts
const animationFrameRef = useRef<number | null>(null);
const isVisibleRef = useRef(false);

const updateVisibility = useCallback((nextVisible: boolean) => {
  if (isVisibleRef.current === nextVisible) return;
  isVisibleRef.current = nextVisible;
  setIsVisible(nextVisible);
}, []);
```

Replace direct `setIsVisible` calls with `updateVisibility`.

- [ ] **Step 4: Coalesce scheduling and clean up pending work**

```ts
const scheduleUpdate = () => {
  if (animationFrameRef.current !== null) return;
  animationFrameRef.current = window.requestAnimationFrame(() => {
    animationFrameRef.current = null;
    updatePosition();
  });
};
```

In effect cleanup:

```ts
if (animationFrameRef.current !== null) {
  cancelAnimationFrame(animationFrameRef.current);
  animationFrameRef.current = null;
}
```

Keep both editor subscriptions because a non-empty selection can retain its positions while document geometry changes.

- [ ] **Step 5: Run the floating-toolbar test and verify GREEN**

Run: `pnpm exec vitest run src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.source.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the floating-toolbar fix**

```bash
git add src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.tsx src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.source.test.ts
git commit -m "perf(editor): coalesce floating toolbar frames"
```

### Task 6: Full regression and performance verification

**Files:**
- Verify all files changed in Tasks 1–5.
- Inspect: `localhost-1781963518314.log` or a newly exported replacement log.

- [ ] **Step 1: Run all focused editor regression tests**

```bash
pnpm exec vitest run src/modules/editor-kit/perfTrace.test.ts src/modules/editor-kit/editor-perf-instrumentation.source.test.ts src/modules/editor-kit/MarkdownEditor.source.test.ts src/components/__tests__/editor-live-content.source.test.ts src/modules/editor-kit/BlockToolbar/index.source.test.ts src/components/FindReplaceBar/useFindReplace.test.ts src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.source.test.ts src/modules/editor-kit/extensions/listTypography.test.ts src/hooks/useDocumentSync.source.test.ts
```

Expected: every test file and test case passes.

- [ ] **Step 2: Run lint on touched files**

```bash
pnpm exec eslint src/components/EditorPage.tsx src/components/__tests__/editor-live-content.source.test.ts src/components/FindReplaceBar/index.tsx src/components/FindReplaceBar/useFindReplace.ts src/components/FindReplaceBar/useFindReplace.test.ts src/modules/editor-kit/MarkdownEditor.tsx src/modules/editor-kit/MarkdownEditor.source.test.ts src/modules/editor-kit/BlockToolbar/index.tsx src/modules/editor-kit/BlockToolbar/index.source.test.ts src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.tsx src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.source.test.ts src/modules/editor-kit/perfTrace.ts src/modules/editor-kit/perfTrace.test.ts src/modules/editor-kit/editor-perf-instrumentation.source.test.ts
```

Expected: zero ESLint errors.

- [ ] **Step 3: Check whitespace and unintended changes**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; status lists only intentional editor-performance work and the approved design/plan documents.

- [ ] **Step 4: Verify runtime behavior on the 326-block document**

Reload the development page and type continuously in a plain-text block. Expected console evidence:

- `EditorPage.MarkdownEditor.render` does not appear for every local content emission when editor props are unchanged;
- `BlockToolbar.transactionFrame` remains below one frame and does not force layout for connected targets;
- empty/inactive FindReplace produces no per-keystroke refresh transaction;
- no repeated 300–500ms React/rAF violations accompany typing;
- `sync:diff:FAST` still reports one dirty candidate for ordinary single-block edits;
- entered text is neither duplicated nor lost, and sync requests do not loop.

- [ ] **Step 5: Commit verification-only adjustments**

If runtime verification requires only assertion or instrumentation-label corrections, stage exactly those files:

```bash
git add src/modules/editor-kit src/components/__tests__ src/components/FindReplaceBar
git commit -m "test(editor): cover typing latency regressions"
```

Do not commit unrelated workspace files.

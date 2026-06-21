import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("editor perf instrumentation source guards", () => {
  it("instruments editor transaction and JSON emission boundaries", () => {
    const source = readSource("src/modules/editor-kit/MarkdownEditor.tsx");

    expect(source).toContain("traceEditorPerfSince");
    expect(source).toContain('"MarkdownEditor.handleUpdate"');
    expect(source).toContain('"MarkdownEditor.flushPendingChange"');
    expect(source).toContain("getJsonMs");
  });

  it("profiles editor subtrees to isolate transaction-driven render latency", () => {
    const source = readSource("src/modules/editor-kit/MarkdownEditor.tsx");

    expect(source).toContain('<Profiler id="Toolbar"');
    expect(source).toContain('<Profiler id="EditorContent"');
    expect(source).toContain('<Profiler id="FloatingSelectionToolbar"');
    expect(source).toContain('<Profiler id="TableInteractions"');
    expect(source).toContain('<Profiler id="BlockToolbar"');
    expect(source).toContain('<Profiler id="LinkToolbar"');
    expect(source).toContain('<Profiler id="TableOfContents"');
    expect(source).toContain('traceEditorPerf(`MarkdownEditor.${id}.render`');
  });

  it("profiles each React node-view type without per-instance console spam", () => {
    const source = [
      "src/modules/editor-kit/TaskItemView.tsx",
      "src/modules/editor-kit/HighlightBlockView.tsx",
      "src/modules/editor-kit/ImageBlockView.tsx",
      "src/modules/editor-kit/code/CodeBlockView.tsx",
    ]
      .map(readSource)
      .join("\n");

    expect(source).toContain('"MarkdownEditor.NodeView.TaskItem.render"');
    expect(source).toContain('"MarkdownEditor.NodeView.HighlightBlock.render"');
    expect(source).toContain('"MarkdownEditor.NodeView.ImageBlock.render"');
    expect(source).toContain('"MarkdownEditor.NodeView.CodeBlock.render"');
    expect(source).toContain("recordEditorPerfSample");
  });

  it("instruments page change handling and local snapshot boundaries", () => {
    const pageSource = readSource("src/components/EditorPage.tsx");
    const snapshotSource = readSource("src/hooks/useLocalDocumentSnapshot.ts");

    expect(pageSource).toContain('"EditorPage.handleEditorChange"');
    expect(pageSource).toContain('<Profiler id="MarkdownEditor"');
    expect(pageSource).toContain('traceEditorPerf("EditorPage.MarkdownEditor.render"');
    expect(snapshotSource).toContain('"localSnapshot.hash"');
    expect(snapshotSource).toContain('"localSnapshot.build"');
    expect(snapshotSource).toContain('"localSnapshot.write"');
  });

  it("instruments the block toolbar transaction boundary", () => {
    const blockToolbarSource = readSource("src/modules/editor-kit/BlockToolbar/index.tsx");

    expect(blockToolbarSource).toContain('"BlockToolbar.transactionFrame"');
  });
});

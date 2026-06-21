// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_PERF_TRACE_STORAGE_KEY,
  isEditorPerfTraceEnabled,
  recordEditorPerfSample,
  traceEditorPerf,
} from "./perfTrace";

describe("editor perf trace", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is disabled unless explicitly enabled in localStorage", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isEditorPerfTraceEnabled()).toBe(false);

    localStorage.setItem(EDITOR_PERF_TRACE_STORAGE_KEY, "1");

    expect(isEditorPerfTraceEnabled()).toBe(true);
  });

  it("defaults to enabled in development", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(isEditorPerfTraceEnabled()).toBe(true);
  });

  it("allows development tracing to be explicitly disabled", () => {
    vi.stubEnv("NODE_ENV", "development");
    localStorage.setItem(EDITOR_PERF_TRACE_STORAGE_KEY, "0");

    expect(isEditorPerfTraceEnabled()).toBe(false);
  });

  it("honors the explicit localStorage flag in production builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    localStorage.setItem(EDITOR_PERF_TRACE_STORAGE_KEY, "1");

    expect(isEditorPerfTraceEnabled()).toBe(true);
  });

  it("logs measured durations at the normally visible info level", () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    traceEditorPerf("editor.test", 12.34, { blocks: 3 });
    expect(log).not.toHaveBeenCalled();

    localStorage.setItem(EDITOR_PERF_TRACE_STORAGE_KEY, "true");
    traceEditorPerf("editor.test", 12.34, { blocks: 3 });

    expect(log).toHaveBeenCalledWith(
      "[editor:perf] editor.test",
      expect.objectContaining({
        durationMs: 12.34,
        blocks: 3,
      }),
    );
  });

  it("batches repeated profiler samples into one summary", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    recordEditorPerfSample("MarkdownEditor.NodeView.CodeBlock.render", 2.25);
    recordEditorPerfSample("MarkdownEditor.NodeView.CodeBlock.render", 3.5);
    await Promise.resolve();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "[editor:perf] MarkdownEditor.NodeView.CodeBlock.render",
      expect.objectContaining({
        durationMs: 5.75,
        sampleCount: 2,
        maxSampleMs: 3.5,
      }),
    );
  });
});

export const EDITOR_PERF_TRACE_STORAGE_KEY = "yuediter:editor-perf-trace";

function readTraceFlag(): string | null {
  if (typeof window === "undefined") {
    return process.env.YUEDITER_EDITOR_PERF_TRACE ?? null;
  }

  try {
    return window.localStorage.getItem(EDITOR_PERF_TRACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function isEditorPerfTraceEnabled(): boolean {
  const flag = readTraceFlag();
  if (flag === null) return process.env.NODE_ENV !== "production";
  return flag === "1" || flag === "true" || flag === "yes";
}

export function nowEditorPerf(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function traceEditorPerf(
  label: string,
  durationMs: number,
  details?: Record<string, unknown>,
): void {
  if (!isEditorPerfTraceEnabled()) return;
  console.log(`[editor:perf] ${label}`, {
    durationMs: Math.round(durationMs * 100) / 100,
    ...(details ?? {}),
  });
}

export function traceEditorPerfSince(
  label: string,
  startedAt: number,
  details?: Record<string, unknown>,
): void {
  traceEditorPerf(label, nowEditorPerf() - startedAt, details);
}

interface EditorPerfSampleBatch {
  durationMs: number;
  maxSampleMs: number;
  sampleCount: number;
}

const pendingSampleBatches = new Map<string, EditorPerfSampleBatch>();
let sampleBatchFlushScheduled = false;

export function recordEditorPerfSample(label: string, durationMs: number): void {
  if (!isEditorPerfTraceEnabled()) return;

  const batch = pendingSampleBatches.get(label) ?? {
    durationMs: 0,
    maxSampleMs: 0,
    sampleCount: 0,
  };
  batch.durationMs += durationMs;
  batch.maxSampleMs = Math.max(batch.maxSampleMs, durationMs);
  batch.sampleCount += 1;
  pendingSampleBatches.set(label, batch);

  if (sampleBatchFlushScheduled) return;
  sampleBatchFlushScheduled = true;
  queueMicrotask(() => {
    sampleBatchFlushScheduled = false;
    const completedBatches = Array.from(pendingSampleBatches.entries());
    pendingSampleBatches.clear();
    completedBatches.forEach(([completedLabel, completedBatch]) => {
      traceEditorPerf(completedLabel, completedBatch.durationMs, {
        sampleCount: completedBatch.sampleCount,
        maxSampleMs: Math.round(completedBatch.maxSampleMs * 100) / 100,
      });
    });
  });
}

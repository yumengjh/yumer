import type { TiptapDoc } from "@/services/tiptap-converter";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;

  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    const next = normalize(raw[key]);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function hashEditorDoc(doc: TiptapDoc): string {
  let hash = 0;
  const text = stableStringify(doc);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

export function shouldApplyRemoteContent(input: {
  hashAtDispatch: string;
  currentEditorHash: string;
  responseHash: string;
}): boolean {
  return (
    input.currentEditorHash === input.hashAtDispatch &&
    input.responseHash === input.hashAtDispatch
  );
}

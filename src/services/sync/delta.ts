import DiffMatchPatch from "diff-match-patch";
import { normalizeCodeBlockAttrs } from "@/modules/editor-kit/code/codeBlockOptions";
import {
  COMPACTION_CHAIN_LIMIT,
  DELTA_FORMAT,
  DELTA_MAX_RATIO,
  DELTA_MIN_FULL_SIZE,
} from "./delta-policy";

export {
  COMPACTION_CHAIN_LIMIT,
  DELTA_FORMAT,
  DELTA_MAX_RATIO,
  DELTA_MIN_FULL_SIZE,
} from "./delta-policy";

export type DeltaFormat = typeof DELTA_FORMAT;

export interface BlockDeltaInput {
  format: DeltaFormat;
  baseVer: number;
  baseHash: string;
  patch: string;
  resultHash: string;
}

const SYNC_ATTR_KEYS = [
  "blockId",
  "clientId",
  "sortKey",
  "syncCreateId",
  "clientBatchId",
  "data-block-id",
  "data-client-id",
  "data-sort-key",
  "data-sync-create-id",
] as const;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function ensurePayloadType(
  payload: unknown,
  blockType?: string | null,
): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.type === "string" && record.type.trim()) {
    return record;
  }
  if (typeof blockType === "string" && blockType.trim()) {
    return { ...record, type: blockType };
  }
  return record;
}

function normalizePayload(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") return normalizeLineEndings(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizePayload);

  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    const next = normalizePayload(raw[key]);
    if (next === undefined) continue;
    out[key] = next;
  }

  if (out.attrs && typeof out.attrs === "object" && !Array.isArray(out.attrs)) {
    const attrs = { ...(out.attrs as Record<string, unknown>) };
    for (const key of SYNC_ATTR_KEYS) {
      delete attrs[key];
    }
    out.attrs = attrs;
  }

  const payloadType = typeof out.type === "string" ? out.type : undefined;
  if (payloadType === "codeBlock" && out.attrs && typeof out.attrs === "object" && !Array.isArray(out.attrs)) {
    out.attrs = normalizeCodeBlockAttrs(out.attrs as Record<string, unknown>);
  }

  return out;
}

function canonicalizeForDelta(payload: unknown, blockType?: string | null): unknown {
  return ensurePayloadType(payload, blockType);
}

/** 与 engine.ts payloadFingerprint 使用相同的 canonical 规则。 */
export function canonicalStringify(payload: unknown): string {
  return JSON.stringify(normalizePayload(payload));
}

export function canonicalPayloadSize(payload: unknown): number {
  return new TextEncoder().encode(canonicalStringify(payload)).byteLength;
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const encoded = new TextEncoder().encode(value);
    const digest = await subtle.digest("SHA-256", encoded);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  throw new Error("Web Crypto API is unavailable for SHA-256");
}

export async function hashPayloadCanonical(payload: unknown): Promise<string> {
  return sha256Hex(canonicalStringify(payload));
}

export function computeDelta(
  basePayload: unknown,
  nextPayload: unknown,
  blockType?: string | null,
): string {
  const dmp = new DiffMatchPatch();
  const baseText = canonicalStringify(canonicalizeForDelta(basePayload, blockType));
  const nextText = canonicalStringify(canonicalizeForDelta(nextPayload, blockType));
  return computeDeltaText(baseText, nextText);
}

function computeDeltaText(baseText: string, nextText: string): string {
  const dmp = new DiffMatchPatch();
  const patches = dmp.patch_make(baseText, nextText);
  return dmp.patch_toText(patches);
}

export function applyDelta(
  basePayload: unknown,
  patch: string,
  blockType?: string | null,
): string {
  const dmp = new DiffMatchPatch();
  const baseText = canonicalStringify(canonicalizeForDelta(basePayload, blockType));
  const patches = dmp.patch_fromText(patch);
  const [resultText, results] = dmp.patch_apply(patches, baseText);
  if (results.some((applied) => !applied)) {
    throw new Error("Failed to apply delta patch");
  }
  return resultText;
}

export function parseCanonicalPayload(canonicalText: string): unknown {
  return JSON.parse(canonicalText) as unknown;
}

export async function buildBlockDelta(input: {
  basePayload: unknown;
  nextPayload: unknown;
  baseVer: number;
  blockType?: string | null;
}): Promise<BlockDeltaInput> {
  const basePayload = canonicalizeForDelta(input.basePayload, input.blockType);
  const nextPayload = canonicalizeForDelta(input.nextPayload, input.blockType);
  const patch = computeDelta(basePayload, nextPayload, input.blockType);
  const baseHash = await hashPayloadCanonical(basePayload);
  const resultHash = await hashPayloadCanonical(nextPayload);
  return {
    format: DELTA_FORMAT,
    baseVer: input.baseVer,
    baseHash,
    patch,
    resultHash,
  };
}

export async function buildBlockDeltaIfUseful(input: {
  basePayload: unknown;
  nextPayload: unknown;
  baseVer: number;
  blockType?: string | null;
  minFullSize?: number;
  maxRatio?: number;
}): Promise<BlockDeltaInput | null> {
  const minFullSize = input.minFullSize ?? DELTA_MIN_FULL_SIZE;
  const maxRatio = input.maxRatio ?? DELTA_MAX_RATIO;
  const basePayload = canonicalizeForDelta(input.basePayload, input.blockType);
  const nextPayload = canonicalizeForDelta(input.nextPayload, input.blockType);
  const nextText = canonicalStringify(nextPayload);
  const fullSize = new TextEncoder().encode(nextText).byteLength;
  if (fullSize < minFullSize) return null;

  const baseText = canonicalStringify(basePayload);
  const patch = computeDeltaText(baseText, nextText);
  const patchSize = new TextEncoder().encode(patch).byteLength;
  if (patchSize > fullSize * maxRatio) return null;

  return {
    format: DELTA_FORMAT,
    baseVer: input.baseVer,
    baseHash: await sha256Hex(baseText),
    patch,
    resultHash: await sha256Hex(nextText),
  };
}

export function shouldSendDelta(input: {
  basePayload: unknown;
  nextPayload: unknown;
  minFullSize?: number;
  maxRatio?: number;
}): boolean {
  const minFullSize = input.minFullSize ?? DELTA_MIN_FULL_SIZE;
  const maxRatio = input.maxRatio ?? DELTA_MAX_RATIO;
  const fullSize = canonicalPayloadSize(input.nextPayload);
  if (fullSize < minFullSize) return false;

  const patch = computeDelta(input.basePayload, input.nextPayload);
  const patchSize = new TextEncoder().encode(patch).byteLength;
  return patchSize <= fullSize * maxRatio;
}

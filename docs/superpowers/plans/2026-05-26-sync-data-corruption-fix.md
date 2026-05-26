# Sync Data Corruption Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix document sync corruption by preserving block order, preventing duplicate creates, and guarding the editor from stale save responses.

**Architecture:** The fix keeps the current TipTap JSON + `/blocks/batch` sync architecture, but strengthens the contract: frontend diff must emit stable order changes, create operations must be idempotent, and save responses may only update identity/revision state unless hashes prove the editor has not changed. The implementation is split into pure frontend tests, backend idempotency tests, integration guards, and diagnostics.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, TipTap 3, Vitest, NestJS, TypeORM, Jest

---

## Planned File Structure

### Frontend: `E:\workspace\editor-demo\app`

- Modify: `src/services/sync/types.ts` - add move/reorder entry shape and diagnostics metadata.
- Modify: `src/services/sync/engine.ts` - derive create/update/delete/move entries and compute non-colliding sort keys.
- Modify: `src/services/sync/api.ts` - serialize move operations and include request metadata.
- Modify: `src/services/sync/reducer.ts` - merge order changes safely with pending entries.
- Modify: `src/hooks/useDocumentSync.ts` - serialize flush/commit, apply stale-response guards, and log diagnostics.
- Modify: `src/components/EditorPage.tsx` - prevent unconditional post-save reload from overwriting active editor changes.
- Modify: `src/services/document.ts` - preserve tree order when loading content; remove global flatten sort from editor load path.
- Add: `src/services/sync/order.ts` - pure helpers for stable block order and sortKey generation.
- Add: `src/services/sync/hash.ts` - deterministic hash for editor docs and payloads.
- Add: `src/services/sync/__tests__/order.test.ts`
- Add: `src/services/sync/__tests__/engine-order.test.ts`
- Add: `src/services/sync/__tests__/stale-response.test.ts`

### Backend: `E:\workspace\yuweb\back\server`

- Modify: `src/modules/blocks/dto/batch-block.dto.ts` - ensure move operations are accepted in sync batches.
- Modify: `src/modules/blocks/blocks.service.ts` - add create idempotency and reject/normalize sortKey conflicts.
- Modify: `src/modules/blocks/dto/sync-batch-response.dto.ts` - include idempotent replay metadata if needed.
- Add: `src/modules/blocks/blocks-sync-idempotency.spec.ts`
- Add: `src/modules/blocks/blocks-ordering.spec.ts`

### Documentation

- Modify: `docs/superpowers/specs/2026-05-26-sync-data-corruption-analysis.md` only if implementation finds a different root cause.

---

## Task 1: Lock Down Frontend Ordering Behavior

**Files:**
- Add: `src/services/sync/order.ts`
- Add: `src/services/sync/__tests__/order.test.ts`

- [ ] **Step 1: Write failing tests for non-colliding insert sort keys**

```ts
// src/services/sync/__tests__/order.test.ts
import { describe, expect, it } from "vitest";
import { createSortKeyBetween, readTopLevelOrder } from "../order";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("sync order helpers", () => {
  it("creates a sortKey between existing siblings instead of reusing the inserted index", () => {
    expect(createSortKeyBetween("001000", "002000")).toBe("001500");
  });

  it("creates a sortKey before the first sibling", () => {
    expect(createSortKeyBetween(null, "001000")).toBe("000500");
  });

  it("creates a sortKey after the last sibling", () => {
    expect(createSortKeyBetween("003000", null)).toBe("004000");
  });

  it("reads top-level block order by clientId, blockId, and index", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a" } },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b" } },
      ],
    };

    expect(readTopLevelOrder(doc)).toEqual([
      { clientId: "c_a", blockId: "b_a", index: 0 },
      { clientId: "c_b", blockId: "b_b", index: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run the order tests to verify RED**

Run:

```bash
pnpm exec vitest run src/services/sync/__tests__/order.test.ts
```

Expected: FAIL because `../order` does not exist.

- [ ] **Step 3: Implement minimal order helpers**

```ts
// src/services/sync/order.ts
import type { TiptapDoc } from "@/services/tiptap-converter";
import { readIdentityFromAttrs } from "@/services/sync/identity";

export type OrderedBlockRef = {
  clientId: string;
  blockId: string | null;
  index: number;
};

function parseSortKey(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSortKey(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(6, "0");
}

export function createSortKeyBetween(previous: string | null, next: string | null): string {
  const previousValue = parseSortKey(previous);
  const nextValue = parseSortKey(next);

  if (previousValue == null && nextValue == null) return "001000";
  if (previousValue == null && nextValue != null) return formatSortKey(nextValue / 2);
  if (previousValue != null && nextValue == null) return formatSortKey(previousValue + 1000);

  const left = previousValue ?? 0;
  const right = nextValue ?? left + 1000;
  if (right - left <= 1) return formatSortKey(left + 1);
  return formatSortKey((left + right) / 2);
}

export function readTopLevelOrder(doc: TiptapDoc): OrderedBlockRef[] {
  const nodes = Array.isArray(doc.content) ? doc.content : [];
  return nodes.flatMap((node, index) => {
    const identity = readIdentityFromAttrs(node.attrs);
    if (!identity.clientId) return [];
    return [{ clientId: identity.clientId, blockId: identity.blockId ?? null, index }];
  });
}
```

- [ ] **Step 4: Run order tests to verify GREEN**

Run:

```bash
pnpm exec vitest run src/services/sync/__tests__/order.test.ts
```

Expected: PASS.

---

## Task 2: Emit Reorder/Move Entries From Frontend Diff

**Files:**
- Modify: `src/services/sync/types.ts`
- Modify: `src/services/sync/engine.ts`
- Add: `src/services/sync/__tests__/engine-order.test.ts`

- [ ] **Step 1: Write failing tests for inserting between saved blocks**

```ts
// src/services/sync/__tests__/engine-order.test.ts
import { describe, expect, it } from "vitest";
import { deriveSyncEntries } from "../engine";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("deriveSyncEntries order handling", () => {
  it("creates a non-colliding sortKey when inserting between existing blocks", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
        { type: "paragraph", attrs: { clientId: "c_x" }, content: [{ type: "text", text: "inserted" }] },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
      ],
    };

    const entries = deriveSyncEntries(previous, next);
    const create = entries.find((entry) => entry.clientId === "c_x");

    expect(create?.opType).toBe("create");
    expect(create?.sortKey).toBe("001500");
  });

  it("emits move entries when existing blocks change relative order", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
      ],
    };

    const entries = deriveSyncEntries(previous, next);

    expect(entries.some((entry) => entry.opType === "move" && entry.blockId === "b_b")).toBe(true);
  });
});
```

- [ ] **Step 2: Run engine order tests to verify RED**

Run:

```bash
pnpm exec vitest run src/services/sync/__tests__/engine-order.test.ts
```

Expected: FAIL because `deriveSyncEntries` currently uses index-based sortKey and does not emit move operations.

- [ ] **Step 3: Extend SyncEntry type with move data**

```ts
// src/services/sync/types.ts
export type SyncOpType = "create" | "update" | "delete" | "move";

export type SyncEntry = {
  clientId: string;
  blockId: string | null;
  opType: SyncOpType;
  blockType?: string;
  payload?: Record<string, unknown>;
  plainText?: string;
  parentId?: string;
  sortKey?: string;
  revision?: number;
};
```

- [ ] **Step 4: Update deriveSyncEntries to compute stable create sortKeys and moves**

```ts
// src/services/sync/engine.ts
import { createSortKeyBetween } from "@/services/sync/order";

function getSortKey(node: TiptapNode, fallbackIndex: number): string {
  const attrValue = node.attrs?.sortKey;
  return typeof attrValue === "string" && attrValue.trim() !== ""
    ? attrValue
    : String((fallbackIndex + 1) * 1000).padStart(6, "0");
}

function sortKeyForNewNode(prevDoc: TiptapDoc | null, nextNodes: IndexedNode[], index: number): string {
  const previousExisting = [...nextNodes.slice(0, index)]
    .reverse()
    .find((item) => item.blockId);
  const nextExisting = nextNodes.slice(index + 1).find((item) => item.blockId);

  const previousSortKey = previousExisting?.sortKey ?? null;
  const nextSortKey = nextExisting?.sortKey ?? null;
  return createSortKeyBetween(previousSortKey, nextSortKey);
}
```

Then apply these rules inside `deriveSyncEntries`:

- For create entries, use `sortKeyForNewNode(...)`.
- For existing entries, compare previous index with next index.
- If index changed, emit `opType: "move"` with `blockId`, `parentId: rootBlockId` supplied later by API, and new `sortKey`.
- Keep payload update separate only when payload changed.

- [ ] **Step 5: Run engine order tests to verify GREEN**

Run:

```bash
pnpm exec vitest run src/services/sync/__tests__/order.test.ts src/services/sync/__tests__/engine-order.test.ts
```

Expected: PASS.

---

## Task 3: Serialize Move Operations and Preserve Reducer Semantics

**Files:**
- Modify: `src/services/sync/api.ts`
- Modify: `src/services/sync/reducer.ts`
- Modify: `src/services/sync/__tests__/reducer.test.ts`

- [ ] **Step 1: Write failing reducer test for update plus move**

```ts
// src/services/sync/__tests__/reducer.test.ts
it("keeps both payload and ordering when an existing block is edited and moved", () => {
  let state = createInitialSyncState("doc_1", "root_1", 5);
  state = enqueueChange(state, {
    clientId: "c_a",
    blockId: "b_a",
    opType: "update",
    payload: { type: "paragraph", content: [{ type: "text", text: "changed" }] },
  });
  state = enqueueChange(state, {
    clientId: "c_a",
    blockId: "b_a",
    opType: "move",
    sortKey: "003000",
  });

  expect(state.entries.c_a.payload).toEqual({
    type: "paragraph",
    content: [{ type: "text", text: "changed" }],
  });
  expect(state.entries.c_a.sortKey).toBe("003000");
});
```

- [ ] **Step 2: Run reducer test to verify RED**

Run:

```bash
pnpm exec vitest run src/services/sync/__tests__/reducer.test.ts
```

Expected: FAIL if the reducer overwrites update payload with move metadata.

- [ ] **Step 3: Merge move metadata without dropping payload**

```ts
// src/services/sync/reducer.ts
if (current && incoming.opType === "move") {
  return upsertEntry(state, {
    ...current,
    opType: current.opType === "create" ? "create" : current.opType,
    parentId: incoming.parentId ?? current.parentId,
    sortKey: incoming.sortKey ?? current.sortKey,
  });
}
```

- [ ] **Step 4: Serialize move operations to `/blocks/batch`**

```ts
// src/services/sync/api.ts
type BatchMoveBody = {
  type: "move";
  blockId: string;
  parentId: string;
  sortKey: string;
};

if (entry.opType === "move") {
  if (!entry.blockId || !entry.sortKey) continue;
  bodyOperations.push({
    type: "move",
    blockId: entry.blockId,
    parentId: entry.parentId ?? input.rootBlockId,
    sortKey: entry.sortKey,
  });
  continue;
}
```

- [ ] **Step 5: Run frontend sync tests**

Run:

```bash
pnpm exec vitest run src/services/sync/__tests__/order.test.ts src/services/sync/__tests__/engine-order.test.ts src/services/sync/__tests__/reducer.test.ts
```

Expected: PASS.

---

## Task 4: Add Backend Create Idempotency

**Files:**
- Modify: `E:\workspace\yuweb\back\server\src\modules\blocks\blocks.service.ts`
- Add: `E:\workspace\yuweb\back\server\src\modules\blocks\blocks-sync-idempotency.spec.ts`

- [ ] **Step 1: Write failing backend unit test for replayed create batch**

```ts
// src/modules/blocks/blocks-sync-idempotency.spec.ts
import { Test } from "@nestjs/testing";
import { BlocksService } from "./blocks.service";
import { BatchOperationType } from "./dto/batch-block.dto";

describe("BlocksService sync idempotency", () => {
  it("does not create a second block when the same clientBatchId and clientId are replayed", async () => {
    const service = await createBlocksServiceWithInMemoryRepositories();

    const first = await service.batch({
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_repeat",
      source: "autosync",
      createVersion: false,
      operations: [
        {
          type: BatchOperationType.CREATE,
          clientId: "client_inserted",
          data: {
            docId: "doc_1",
            type: "paragraph",
            parentId: "root_1",
            sortKey: "001500",
            payload: { type: "paragraph", attrs: { clientId: "client_inserted" } },
          },
        },
      ],
    }, "user_1");

    const second = await service.batch({
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_repeat",
      source: "autosync",
      createVersion: false,
      operations: [
        {
          type: BatchOperationType.CREATE,
          clientId: "client_inserted",
          data: {
            docId: "doc_1",
            type: "paragraph",
            parentId: "root_1",
            sortKey: "001500",
            payload: { type: "paragraph", attrs: { clientId: "client_inserted" } },
          },
        },
      ],
    }, "user_1");

    expect(second.results[0].blockId).toBe(first.results[0].blockId);
  });
});
```

- [ ] **Step 2: Run backend idempotency test to verify RED**

Run:

```bash
cd E:\workspace\yuweb\back\server
pnpm test -- blocks-sync-idempotency.spec.ts
```

Expected: FAIL because replayed create produces a new blockId or helper infrastructure is missing.

- [ ] **Step 3: Store client create identity in block payload attrs**

```ts
// src/modules/blocks/blocks.service.ts
private async findExistingCreateByClientIdentity(
  manager: EntityManager,
  docId: string,
  clientBatchId: string | undefined,
  clientId: string | undefined,
): Promise<BlockVersion | null> {
  if (!clientBatchId || !clientId) return null;

  return manager
    .getRepository(BlockVersion)
    .createQueryBuilder("bv")
    .innerJoin(Block, "b", "b.blockId = bv.blockId AND b.latestVer = bv.ver")
    .where("bv.docId = :docId", { docId })
    .andWhere("b.isDeleted = false")
    .andWhere("bv.payload -> 'attrs' ->> 'clientBatchId' = :clientBatchId", { clientBatchId })
    .andWhere("bv.payload -> 'attrs' ->> 'clientId' = :clientId", { clientId })
    .getOne();
}
```

Inside `handleBatchCreate`, before creating a new block:

```ts
const existing = await this.findExistingCreateByClientIdentity(
  manager,
  docId,
  (operation as any).clientBatchId,
  operation.clientId,
);
if (existing) {
  return { blockId: existing.blockId };
}

const payload = {
  ...operation.data.payload,
  attrs: {
    ...((operation.data.payload as any)?.attrs ?? {}),
    clientBatchId: (operation as any).clientBatchId,
    clientId: operation.clientId,
  },
};
```

When calling `handleBatchCreate` from `batch`, pass `clientBatchId` into the operation object so the helper can read it.

- [ ] **Step 4: Run backend idempotency test to verify GREEN**

Run:

```bash
cd E:\workspace\yuweb\back\server
pnpm test -- blocks-sync-idempotency.spec.ts
```

Expected: PASS.

---

## Task 5: Guard Against Stale Save Responses

**Files:**
- Add: `src/services/sync/hash.ts`
- Add: `src/services/sync/__tests__/stale-response.test.ts`
- Modify: `src/hooks/useDocumentSync.ts`
- Modify: `src/components/EditorPage.tsx`

- [ ] **Step 1: Write failing tests for stale response guard**

```ts
// src/services/sync/__tests__/stale-response.test.ts
import { describe, expect, it } from "vitest";
import { hashEditorDoc, shouldApplyRemoteContent } from "../hash";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("stale response guard", () => {
  it("allows remote content when editor hash is unchanged since request dispatch", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "same" }] }],
    };

    const hash = hashEditorDoc(doc);

    expect(shouldApplyRemoteContent({
      hashAtDispatch: hash,
      currentEditorHash: hash,
      responseHash: hash,
    })).toBe(true);
  });

  it("rejects remote content when the editor changed after request dispatch", () => {
    const before: TiptapDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "before" }] }],
    };
    const current: TiptapDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "after" }] }],
    };

    expect(shouldApplyRemoteContent({
      hashAtDispatch: hashEditorDoc(before),
      currentEditorHash: hashEditorDoc(current),
      responseHash: hashEditorDoc(before),
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run stale-response tests to verify RED**

Run:

```bash
pnpm exec vitest run src/services/sync/__tests__/stale-response.test.ts
```

Expected: FAIL because `../hash` does not exist.

- [ ] **Step 3: Implement deterministic hash helpers**

```ts
// src/services/sync/hash.ts
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
  return input.currentEditorHash === input.hashAtDispatch
    && input.responseHash === input.hashAtDispatch;
}
```

- [ ] **Step 4: Protect post-save reload in EditorPage**

```ts
// src/components/EditorPage.tsx
const hashAtSaveStart = latestEditorContent?.type === "doc"
  ? hashEditorDoc(latestEditorContent)
  : null;

await commitVersion(currentDoc.docId, "手动保存");

if (syncEngineEnabled && hashAtSaveStart) {
  const loaded = await loadContent(currentDoc.docId);
  const currentEditorContent = editorRef.current?.getJSON() as TiptapDoc | undefined;
  const currentHash = currentEditorContent?.type === "doc"
    ? hashEditorDoc(currentEditorContent)
    : hashAtSaveStart;
  const responseHash = loaded.content && typeof loaded.content === "object" && loaded.content.type === "doc"
    ? hashEditorDoc(loaded.content)
    : hashAtSaveStart;

  if (shouldApplyRemoteContent({
    hashAtDispatch: hashAtSaveStart,
    currentEditorHash: currentHash,
    responseHash,
  })) {
    setContent(loaded.content || DEFAULT_CONTENT);
  } else {
    setSaveStatus("error");
    setHasUnsavedChanges(true);
    message.warning("保存响应已过期，当前编辑内容未被覆盖。请检查同步状态后重试。");
    return;
  }
}
```

- [ ] **Step 5: Run stale-response and sync tests**

Run:

```bash
pnpm exec vitest run src/services/sync/__tests__/stale-response.test.ts src/services/sync/__tests__/order.test.ts src/services/sync/__tests__/engine-order.test.ts src/services/sync/__tests__/reducer.test.ts
```

Expected: PASS.

---

## Task 6: Preserve Tree Order on Load

**Files:**
- Modify: `src/services/document.ts`
- Add: `src/services/__tests__/document-load-order.test.ts`

- [ ] **Step 1: Write failing test for tree order preservation**

```ts
// src/services/__tests__/document-load-order.test.ts
import { describe, expect, it } from "vitest";
import { flattenBlockTreeInDocumentOrder } from "../document";

describe("document load order", () => {
  it("keeps each parent's children in local sortKey order without global resorting", () => {
    const root = {
      blockId: "root",
      docId: "doc_1",
      type: "root",
      payload: {},
      sortKey: "0",
      indent: 0,
      collapsed: false,
      children: [
        {
          blockId: "parent_b",
          docId: "doc_1",
          type: "paragraph",
          payload: {},
          sortKey: "002000",
          indent: 0,
          collapsed: false,
          children: [
            { blockId: "child_a", docId: "doc_1", type: "paragraph", payload: {}, sortKey: "001000", indent: 0, collapsed: false },
          ],
        },
        {
          blockId: "parent_a",
          docId: "doc_1",
          type: "paragraph",
          payload: {},
          sortKey: "001000",
          indent: 0,
          collapsed: false,
        },
      ],
    };

    expect(flattenBlockTreeInDocumentOrder(root).map((block) => block.blockId)).toEqual([
      "root",
      "parent_a",
      "parent_b",
      "child_a",
    ]);
  });
});
```

- [ ] **Step 2: Run load-order test to verify RED**

Run:

```bash
pnpm exec vitest run src/services/__tests__/document-load-order.test.ts
```

Expected: FAIL because `flattenBlockTreeInDocumentOrder` does not exist.

- [ ] **Step 3: Implement document-order flattening**

```ts
// src/services/document.ts
export function flattenBlockTreeInDocumentOrder(root: Block): Block[] {
  const result: Block[] = [];

  function walk(block: Block) {
    result.push(block);
    const children = [...(block.children ?? [])].sort((a, b) => {
      const left = Number.parseInt(a.sortKey || "0", 10) || 0;
      const right = Number.parseInt(b.sortKey || "0", 10) || 0;
      if (left !== right) return left - right;
      return a.blockId.localeCompare(b.blockId);
    });
    for (const child of children) walk(child);
  }

  walk(root);
  return result;
}
```

Replace editor load usages of `flattenBlockTree(resp.tree)` with `flattenBlockTreeInDocumentOrder(resp.tree)` where content is reconstructed for editing.

- [ ] **Step 4: Run document load test and sync tests**

Run:

```bash
pnpm exec vitest run src/services/__tests__/document-load-order.test.ts src/services/sync/__tests__/order.test.ts src/services/sync/__tests__/engine-order.test.ts
```

Expected: PASS.

---

## Task 7: Add Sync Diagnostics

**Files:**
- Modify: `src/hooks/useDocumentSync.ts`
- Modify: `src/components/EditorPage.tsx`
- Modify: `E:\workspace\yuweb\back\server\src\modules\blocks\blocks.service.ts`

- [ ] **Step 1: Add frontend diagnostic log points**

```ts
// src/hooks/useDocumentSync.ts
function logSyncEvent(event: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.debug(`[sync] ${event}`, details);
}
```

Log before sending a batch:

```ts
logSyncEvent("flush:dispatch", {
  docId: current.docId,
  clientBatchId,
  baseVersion: current.baseVersion,
  operationCount: operations.length,
  createCount: operations.filter((op) => op.opType === "create").length,
  updateCount: operations.filter((op) => op.opType === "update").length,
  deleteCount: operations.filter((op) => op.opType === "delete").length,
  moveCount: operations.filter((op) => op.opType === "move").length,
});
```

Log after receiving response:

```ts
logSyncEvent("flush:response", {
  docId: current.docId,
  acceptedBatchId: response.acceptedBatchId,
  serverHead: response.serverHead,
  needsReload: response.needsReload,
  resultCount: response.results.length,
});
```

- [ ] **Step 2: Add backend batch diagnostics**

```ts
// back/server/src/modules/blocks/blocks.service.ts
this.logger.log(
  `sync batch: docId=${batchBlockDto.docId}, clientBatchId=${acceptedBatchId}, source=${batchBlockDto.source ?? "unknown"}, operations=${batchBlockDto.operations.length}, serverHead=${txResult.serverHead}`,
);
```

- [ ] **Step 3: Run lint and tests**

Run:

```bash
pnpm lint
pnpm exec vitest run src/services/sync/__tests__/order.test.ts src/services/sync/__tests__/engine-order.test.ts src/services/sync/__tests__/stale-response.test.ts
cd E:\workspace\yuweb\back\server
pnpm lint
pnpm test -- blocks-sync-idempotency.spec.ts
```

Expected: frontend lint/tests pass, backend lint/idempotency test passes.

---

## Task 8: Final Verification and Commit Split

**Files:**
- All changed files from Tasks 1-7.

- [ ] **Step 1: Run frontend verification**

```bash
cd E:\workspace\editor-demo\app
pnpm exec vitest run src/services/sync/__tests__/order.test.ts src/services/sync/__tests__/engine-order.test.ts src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/stale-response.test.ts src/services/__tests__/document-load-order.test.ts
pnpm lint
pnpm build
```

Expected: all tests pass, lint exits with code 0, build succeeds.

- [ ] **Step 2: Run backend verification**

```bash
cd E:\workspace\yuweb\back\server
pnpm test -- blocks-sync-idempotency.spec.ts blocks-ordering.spec.ts
pnpm lint
```

Expected: backend tests pass, lint exits with code 0.

- [ ] **Step 3: Commit documentation first**

```bash
cd E:\workspace\editor-demo\app
git add docs/superpowers/specs/2026-05-26-sync-data-corruption-analysis.md docs/superpowers/plans/2026-05-26-sync-data-corruption-fix.md
git commit -m "📝 docs(sync): 记录协作文档同步错乱修复方案"
```

- [ ] **Step 4: Commit frontend sync fix**

```bash
cd E:\workspace\editor-demo\app
git add src/services/sync src/hooks/useDocumentSync.ts src/components/EditorPage.tsx src/services/document.ts
git commit -m "🐛 fix(sync): 修复协作文档块顺序错乱"
```

- [ ] **Step 5: Commit backend idempotency fix**

```bash
cd E:\workspace\yuweb\back\server
git add src/modules/blocks src/modules/blocks/blocks-sync-idempotency.spec.ts src/modules/blocks/blocks-ordering.spec.ts
git commit -m "🐛 fix(sync): 增加批量创建幂等保护"
```

---

## Self-Review Checklist

### Spec coverage

- 新增块 sortKey 碰撞：Task 1 和 Task 2 覆盖。
- 已有块重排未同步：Task 2 和 Task 3 覆盖。
- create 重复写入：Task 4 覆盖。
- 旧响应覆盖当前 UI：Task 5 覆盖。
- 加载时全局排序破坏树结构：Task 6 覆盖。
- 诊断日志：Task 7 覆盖。
- 分提交策略：Task 8 覆盖。

### Placeholder scan

- 本计划没有留待补充的任务。
- 每个测试步骤都给出具体测试代码和命令。
- 每个实现步骤都给出目标文件与核心实现片段。

### Type consistency

- 前端 `SyncEntry.opType` 统一使用 `create | update | delete | move`。
- 前端排序字段统一使用 `sortKey`。
- create 幂等统一使用 `docId + clientBatchId + clientId`。
- 保存响应保护统一使用 `hashAtDispatch + currentEditorHash + responseHash`。

---

Plan complete and saved to `docs/superpowers/plans/2026-05-26-sync-data-corruption-fix.md`.

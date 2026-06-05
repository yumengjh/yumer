# Checkpoint Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authoritative full-document checkpoint sync path that prevents data loss or ordering corruption during bulk edits, weak networks, and refreshes, while preserving a future path to collaborative editing.

**Architecture:** Keep `/blocks/batch` for normal incremental sync. Add `POST /documents/:docId/draft-checkpoint` as a full-coverage final-state reconciliation path. Introduce protocol-level `orderKey`, but initially persist it into the existing backend `sortKey` field for compatibility.

**Tech Stack:** Frontend `F:\yuediter`: Next.js, React, TypeScript, Vitest, pnpm. Backend `F:\yumer-server`: NestJS, TypeScript, TypeORM, Jest, pnpm.

---

## 0. Required Reading

- Frontend design: `F:\yuediter\docs\superpowers\specs\2026-06-05-checkpoint-sync-design.md`
- Frontend analysis: `F:\yuediter\docs\2026-06-05-frontend-sync-stability-analysis.md`
- Backend current-state doc: `F:\yumer-server\docs\superpowers\specs\2026-06-05-sync-link-current-state-and-next-plan.md`

## 1. Execution Rules

- [ ] Use TDD for every behavior change: write failing test, run and confirm expected failure, implement minimal code, rerun.
- [ ] Commit after each task. Do not batch unrelated tasks into one commit.
- [ ] Do not remove existing `/blocks/batch` sync.
- [ ] Do not introduce Yjs, Automerge, or CRDT runtime in this phase.
- [ ] Backend accepts only `mode: "checkpoint"` and `coverage: "full"` in this phase.
- [ ] Checkpoint updates draft only. It must not publish or commit a formal version.
- [ ] Same `docId + clientCheckpointId + requestFingerprint` must replay the first response.
- [ ] Same `docId + clientCheckpointId` with a different fingerprint must return conflict.
- [ ] Manual save must not call commit until checkpoint succeeds.
- [ ] If checkpoint fails, save fails clearly. Do not silently commit stale draft.
- [ ] After checkpoint success, old inflight batch ACK must not overwrite editor text or visual order.

## 2. Verification Commands

Frontend:

```powershell
cd F:\yuediter
pnpm vitest run src/services/sync/__tests__/checkpoint.test.ts src/hooks/useDocumentSync.source.test.ts src/services/sync/__tests__/api.test.ts src/services/sync/__tests__/engine-order.test.ts
pnpm build
```

Backend:

```powershell
cd F:\yumer-server
pnpm jest src/modules/documents/draft-checkpoint.service.spec.ts src/modules/blocks/blocks-sync-idempotency.spec.ts --runInBand
pnpm build
```

## 3. Files to Create or Modify

Frontend:

- Create `src/services/sync/checkpoint.ts`: build checkpoint payloads and patch checkpoint ACK mappings.
- Modify `src/services/sync/api.ts`: add checkpoint request/response types and `postDraftCheckpoint()`.
- Modify `src/hooks/useDocumentSync.ts`: run checkpoint before commit; fallback after repeated batch failures.
- Modify `src/hooks/useDocumentSync.source.test.ts`: source-level guards for save barrier and fallback.
- Modify `src/components/EditorPage.tsx` only if save status/error handling needs wiring.
- Create `src/services/sync/__tests__/checkpoint.test.ts`.

Backend:

- Create `src/modules/documents/dto/draft-checkpoint.dto.ts`.
- Create `src/entities/sync-checkpoint-receipt.entity.ts`.
- Create `src/database/migrations/1782900000000-CreateSyncCheckpointReceipts.ts`.
- Create `src/modules/documents/draft-checkpoint.service.ts`.
- Create `src/modules/documents/draft-checkpoint.service.spec.ts`.
- Modify `src/modules/documents/documents.controller.ts`.
- Modify `src/modules/documents/documents.module.ts`.
- Modify TypeORM entity registration if entities are listed explicitly.

---
## 4. Backend Tasks

### Task B1: Add checkpoint DTO

**Files:**
- Create `F:\yumer-server\src\modules\documents\dto\draft-checkpoint.dto.ts`

- [ ] Create `DraftCheckpointBlockDto`, `DraftCheckpointDto`, `DraftCheckpointResponseDto`.
- [ ] Use the same decorator style as existing backend DTOs.
- [ ] Required request fields:
  - `mode: "checkpoint"`
  - `coverage: "full"`
  - `clientCheckpointId: string`
  - `clientId: string`
  - `baseVersion: number`
  - `draftRevision: number`
  - `sessionId: string`
  - `sessionEpoch: number`
  - `contentHash: string`
  - `generatedAt: number`
  - `rootBlockId: string`
  - `blocks: DraftCheckpointBlockDto[]`
- [ ] Optional future-collaboration fields:
  - `actorId?: string`
  - `documentClock?: number`
  - `parentCheckpointId?: string | null`
- [ ] Required block fields:
  - `clientId: string`
  - `type: string`
  - `orderKey: string`
  - `payload: Record<string, unknown>`
- [ ] Optional block fields:
  - `blockId?: string | null`
  - `syncCreateId?: string | null`
  - `parentId?: string | null`
  - `plainText?: string`
- [ ] Response fields:
  - `acceptedCheckpointId`
  - `appliedAt`
  - `serverHead`
  - `draftRevision`
  - `needsReload`
  - `conflicts`
  - `contentHash`
  - `mappings`
  - `tombstoned`

Suggested DTO skeleton:

```ts
export class DraftCheckpointBlockDto {
  clientId: string;
  blockId?: string | null;
  syncCreateId?: string | null;
  type: string;
  parentId?: string | null;
  orderKey: string;
  payload: Record<string, unknown>;
  plainText?: string;
}

export class DraftCheckpointDto {
  mode: "checkpoint";
  coverage: "full";
  clientCheckpointId: string;
  clientId: string;
  baseVersion: number;
  draftRevision: number;
  sessionId: string;
  sessionEpoch: number;
  contentHash: string;
  generatedAt: number;
  actorId?: string;
  documentClock?: number;
  parentCheckpointId?: string | null;
  rootBlockId: string;
  blocks: DraftCheckpointBlockDto[];
}

export class DraftCheckpointResponseDto {
  acceptedCheckpointId: string;
  appliedAt: number;
  serverHead: number;
  draftRevision: number;
  needsReload: boolean;
  conflicts: Array<{ code: string; message: string }>;
  contentHash: string;
  mappings: Array<{ clientId: string; blockId: string; orderKey: string; sortKey?: string }>;
  tombstoned: Array<{ blockId: string; clientId?: string | null; syncCreateId?: string | null }>;
}
```

- [ ] Run:

```powershell
cd F:\yumer-server
pnpm build
```

Expected: build passes or fails only on decorator/import conventions; fix conventions, not behavior.

- [ ] Commit:

```powershell
cd F:\yumer-server
git add src/modules/documents/dto/draft-checkpoint.dto.ts
git commit -m "feat(sync): add draft checkpoint dto"
```

### Task B2: Add checkpoint receipt persistence

**Files:**
- Create `F:\yumer-server\src\entities\sync-checkpoint-receipt.entity.ts`
- Create `F:\yumer-server\src\database\migrations\1782900000000-CreateSyncCheckpointReceipts.ts`
- Modify entity registration if needed.

- [ ] Inspect existing receipt style:

```powershell
cd F:\yumer-server
Get-Content -Raw src/entities/sync-batch-receipt.entity.ts
```

- [ ] Create entity mirroring `SyncBatchReceipt` conventions.
- [ ] Required columns:
  - `id`
  - `docId`
  - `clientCheckpointId`
  - `requestFingerprint`
  - `acceptedCheckpointId`
  - `appliedAt`
  - `serverHead`
  - `draftRevision`
  - `needsReload`
  - `conflicts`
  - `contentHash`
  - `mappings`
  - `tombstoned`
  - `createdBy`
  - `createdAt`
  - `updatedAt`
- [ ] Add unique index on `(docId, clientCheckpointId)`.
- [ ] Create migration table `sync_checkpoint_receipts`.
- [ ] Register entity wherever backend registers TypeORM entities.
- [ ] Run:

```powershell
cd F:\yumer-server
pnpm build
```

Expected: PASS.

- [ ] Commit:

```powershell
cd F:\yumer-server
git add src/entities/sync-checkpoint-receipt.entity.ts src/database/migrations/1782900000000-CreateSyncCheckpointReceipts.ts src
git commit -m "feat(sync): persist checkpoint receipts"
```

### Task B3: Write failing checkpoint create test

**Files:**
- Create `F:\yumer-server\src\modules\documents\draft-checkpoint.service.spec.ts`

- [ ] Inspect backend sync test harness:

```powershell
cd F:\yumer-server
Get-Content -Head 360 src/modules/blocks/blocks-sync-idempotency.spec.ts
```

- [ ] Create a test harness using the same repository mocking style.
- [ ] Harness must provide:
  - one document `doc_1` with `head = 3`, `draftRevision = 0`, `rootBlockId = root_1`
  - one valid sync session `sync_1`, `sessionEpoch = 1`, holder `user_1`, unexpired lease
  - in-memory `blocks`, `blockVersions`, `docDrafts`, `receipts`, `tombstones`
  - `visibleDraftBlocks()` helper sorted by numeric sortKey
  - `baseCheckpoint(id)` helper
  - `block({ clientId, blockId, syncCreateId, orderKey, text })` helper
- [ ] First test:

```ts
it("creates draft blocks from a full checkpoint and returns mappings", async () => {
  const harness = createDraftCheckpointHarness();
  const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
    ...harness.baseCheckpoint("checkpoint_create_1"),
    blocks: [harness.block({ clientId: "cid_1", orderKey: "001000", text: "hello" })],
  });

  expect(response.needsReload).toBe(false);
  expect(response.draftRevision).toBe(1);
  expect(response.mappings).toHaveLength(1);
  expect(response.mappings[0]).toMatchObject({ clientId: "cid_1", orderKey: "001000" });
  expect(response.mappings[0].blockId).toMatch(/^block_/);
  expect(harness.visibleDraftBlocks()).toEqual([
    expect.objectContaining({ blockId: response.mappings[0].blockId, sortKey: "001000", plainText: "hello" }),
  ]);
});
```

- [ ] Run:

```powershell
cd F:\yumer-server
pnpm jest src/modules/documents/draft-checkpoint.service.spec.ts --runInBand
```

Expected: FAIL because service is missing.

- [ ] Commit failing test:

```powershell
cd F:\yumer-server
git add src/modules/documents/draft-checkpoint.service.spec.ts
git commit -m "test(sync): specify checkpoint create behavior"
```

### Task B4: Implement minimal checkpoint create path

**Files:**
- Create `F:\yumer-server\src\modules\documents\draft-checkpoint.service.ts`
- Modify `F:\yumer-server\src\modules\documents\draft-checkpoint.service.spec.ts`

- [ ] Create injectable `DraftCheckpointService` with method:

```ts
async applyDraftCheckpoint(
  docId: string,
  userId: string,
  dto: DraftCheckpointDto,
): Promise<DraftCheckpointResponseDto>
```

- [ ] Implement transaction wrapper using `this.dataSource.transaction(...)`.
- [ ] Implement request fingerprint:

```ts
JSON.stringify({
  mode: dto.mode,
  coverage: dto.coverage,
  clientCheckpointId: dto.clientCheckpointId,
  clientId: dto.clientId,
  baseVersion: dto.baseVersion,
  draftRevision: dto.draftRevision,
  sessionId: dto.sessionId,
  sessionEpoch: dto.sessionEpoch,
  contentHash: dto.contentHash,
  rootBlockId: dto.rootBlockId,
  actorId: dto.actorId ?? null,
  documentClock: dto.documentClock ?? null,
  parentCheckpointId: dto.parentCheckpointId ?? null,
  blocks: dto.blocks,
})
```

- [ ] Minimal create behavior:
  - validate `mode` and `coverage`
  - validate document `head === baseVersion`
  - validate document `draftRevision === dto.draftRevision`
  - validate sync session id/epoch and lease
  - create missing blocks
  - write `BlockVersion.sortKey = block.orderKey`
  - ensure payload attrs contain `blockId`, `clientId`, `sortKey`
  - update `DocDraft.blockVersionMap`
  - increment `Document.draftRevision` once
  - return mappings
- [ ] Run:

```powershell
cd F:\yumer-server
pnpm jest src/modules/documents/draft-checkpoint.service.spec.ts --runInBand
```

Expected: PASS for create test.

- [ ] Commit:

```powershell
cd F:\yumer-server
git add src/modules/documents/draft-checkpoint.service.ts src/modules/documents/draft-checkpoint.service.spec.ts
git commit -m "feat(sync): apply checkpoint create path"
```

### Task B5: Add update, reorder, delete, receipt, and conflict behavior

**Files:**
- Modify `F:\yumer-server\src\modules\documents\draft-checkpoint.service.ts`
- Modify `F:\yumer-server\src\modules\documents\draft-checkpoint.service.spec.ts`

For each behavior below: write test, run and confirm failure, implement, rerun.

- [ ] Existing block update:

```ts
it("updates an existing draft block matched by blockId", async () => {
  const harness = createDraftCheckpointHarness({
    existingBlocks: [{ blockId: "block_existing", clientId: "cid_existing", sortKey: "001000", text: "old" }],
  });
  const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
    ...harness.baseCheckpoint("checkpoint_update_1"),
    blocks: [harness.block({ clientId: "cid_existing", blockId: "block_existing", orderKey: "001000", text: "new" })],
  });
  expect(response.draftRevision).toBe(1);
  expect(harness.visibleDraftBlocks()).toEqual([
    expect.objectContaining({ blockId: "block_existing", plainText: "new", sortKey: "001000" }),
  ]);
});
```

- [ ] Reorder existing blocks:

```ts
it("updates sortKey/orderKey for reordered blocks", async () => {
  const harness = createDraftCheckpointHarness({
    existingBlocks: [
      { blockId: "block_a", clientId: "cid_a", sortKey: "001000", text: "A" },
      { blockId: "block_b", clientId: "cid_b", sortKey: "002000", text: "B" },
    ],
  });
  await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
    ...harness.baseCheckpoint("checkpoint_reorder_1"),
    blocks: [
      harness.block({ clientId: "cid_b", blockId: "block_b", orderKey: "001000", text: "B" }),
      harness.block({ clientId: "cid_a", blockId: "block_a", orderKey: "002000", text: "A" }),
    ],
  });
  expect(harness.visibleDraftBlocks().map((block) => [block.blockId, block.sortKey])).toEqual([
    ["block_b", "001000"],
    ["block_a", "002000"],
  ]);
});
```

- [ ] Full-coverage deletion and tombstone:

```ts
it("tombstones draft blocks missing from a full checkpoint", async () => {
  const harness = createDraftCheckpointHarness({
    existingBlocks: [
      { blockId: "block_keep", clientId: "cid_keep", syncCreateId: "sync-create:cid_keep", sortKey: "001000", text: "keep" },
      { blockId: "block_delete", clientId: "cid_delete", syncCreateId: "sync-create:cid_delete", sortKey: "002000", text: "delete" },
    ],
  });
  const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
    ...harness.baseCheckpoint("checkpoint_delete_1"),
    blocks: [harness.block({ clientId: "cid_keep", blockId: "block_keep", syncCreateId: "sync-create:cid_keep", orderKey: "001000", text: "keep" })],
  });
  expect(response.tombstoned).toEqual([
    expect.objectContaining({ blockId: "block_delete", clientId: "cid_delete", syncCreateId: "sync-create:cid_delete" }),
  ]);
  expect(harness.visibleDraftBlocks().map((block) => block.blockId)).toEqual(["block_keep"]);
  expect(harness.tombstones).toEqual([
    expect.objectContaining({ docId: "doc_1", blockId: "block_delete", clientId: "cid_delete", syncCreateId: "sync-create:cid_delete" }),
  ]);
});
```

- [ ] Idempotent replay:

```ts
it("replays the original response for the same checkpoint fingerprint", async () => {
  const harness = createDraftCheckpointHarness();
  const dto = {
    ...harness.baseCheckpoint("checkpoint_replay_1"),
    blocks: [harness.block({ clientId: "cid_1", orderKey: "001000", text: "hello" })],
  };
  const first = await harness.service.applyDraftCheckpoint("doc_1", "user_1", dto);
  const second = await harness.service.applyDraftCheckpoint("doc_1", "user_1", dto);
  expect(second).toEqual(first);
  expect(harness.receipts).toHaveLength(1);
  expect(harness.visibleDraftBlocks()).toHaveLength(1);
});
```

- [ ] Fingerprint conflict:

```ts
it("returns conflict when checkpoint id is reused with different content", async () => {
  const harness = createDraftCheckpointHarness();
  await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
    ...harness.baseCheckpoint("checkpoint_conflict_1"),
    blocks: [harness.block({ clientId: "cid_1", orderKey: "001000", text: "one" })],
  });
  const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
    ...harness.baseCheckpoint("checkpoint_conflict_1"),
    blocks: [harness.block({ clientId: "cid_1", orderKey: "001000", text: "two" })],
  });
  expect(response.needsReload).toBe(true);
  expect(response.conflicts[0]?.code).toBe("CHECKPOINT_FINGERPRINT_CONFLICT");
});
```

- [ ] Stale draft revision conflict:

```ts
it("returns conflict when draftRevision is stale", async () => {
  const harness = createDraftCheckpointHarness({ documentDraftRevision: 2 });
  const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
    ...harness.baseCheckpoint("checkpoint_stale_revision", { draftRevision: 1 }),
    blocks: [],
  });
  expect(response.needsReload).toBe(true);
  expect(response.conflicts[0]?.code).toBe("DRAFT_REVISION_MISMATCH");
});
```

- [ ] Session mismatch conflict:

```ts
it("returns conflict when sync session does not match", async () => {
  const harness = createDraftCheckpointHarness();
  const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
    ...harness.baseCheckpoint("checkpoint_bad_session", { sessionId: "other_session" }),
    blocks: [],
  });
  expect(response.needsReload).toBe(true);
  expect(response.conflicts[0]?.code).toBe("SYNC_SESSION_MISMATCH");
});
```

Implementation notes:

- [ ] Match existing blocks by `blockId`, then `syncCreateId`, then `clientId`.
- [ ] Always write a new block version for matched blocks if payload or orderKey changed.
- [ ] Build kept blockId set from request blocks after matching/creating.
- [ ] For draft blocks missing from kept set, write deleted version and tombstone if client identity exists.
- [ ] Save receipt for first successful response and deterministic conflict responses.
- [ ] Do not mutate draft on conflict.

Run:

```powershell
cd F:\yumer-server
pnpm jest src/modules/documents/draft-checkpoint.service.spec.ts --runInBand
```

Expected: PASS.

Commit:

```powershell
cd F:\yumer-server
git add src/modules/documents/draft-checkpoint.service.ts src/modules/documents/draft-checkpoint.service.spec.ts
git commit -m "feat(sync): reconcile draft checkpoints transactionally"
```

### Task B6: Expose backend endpoint

**Files:**
- Modify `F:\yumer-server\src\modules\documents\documents.controller.ts`
- Modify `F:\yumer-server\src\modules\documents\documents.module.ts`

- [ ] Add controller route `POST /documents/:docId/draft-checkpoint`.
- [ ] Use same auth/user decorator style as existing document mutation endpoints.
- [ ] Inject `DraftCheckpointService`.
- [ ] Register service in module.
- [ ] Route method should call:

```ts
return this.draftCheckpointService.applyDraftCheckpoint(docId, user.userId, dto);
```

Adapt `user.userId` to the actual user object shape used in the controller.

Run:

```powershell
cd F:\yumer-server
pnpm jest src/modules/documents/draft-checkpoint.service.spec.ts --runInBand
pnpm build
```

Expected: PASS.

Commit:

```powershell
cd F:\yumer-server
git add src/modules/documents/documents.controller.ts src/modules/documents/documents.module.ts src/modules/documents/draft-checkpoint.service.ts
git commit -m "feat(sync): expose draft checkpoint endpoint"
```

---
## 5. Frontend Tasks

### Task F1: Write checkpoint builder tests

**Files:**
- Create `F:\yuediter\src\services\sync\__tests__\checkpoint.test.ts`

- [ ] Create failing tests for `buildDraftCheckpoint()` and `applyCheckpointAck()`.
- [ ] Test document:

```ts
const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { clientId: "cid_1", blockId: "block_1", sortKey: "001000" },
      content: [{ type: "text", text: "hello" }],
    },
    {
      type: "heading",
      attrs: { clientId: "cid_2", sortKey: "002000" },
      content: [{ type: "text", text: "world" }],
    },
  ],
};
```

- [ ] Expected checkpoint assertions:
  - `mode === "checkpoint"`
  - `coverage === "full"`
  - `clientCheckpointId` preserved from input
  - `contentHash` starts with `sha256:`
  - first block has `clientId cid_1`, `blockId block_1`, `orderKey 001000`
  - second block has `clientId cid_2`, `blockId null`, `syncCreateId sync-create:cid_2`, `orderKey 002000`
  - transient attrs `syncCreateId`, `clientBatchId`, `data-sync-create-id` are removed from payload attrs
- [ ] Expected ACK patch assertions:

```ts
expect(patched.content?.[0].attrs).toMatchObject({
  clientId: "cid_1",
  blockId: "block_1",
  "data-block-id": "block_1",
  sortKey: "001500",
  "data-sort-key": "001500",
});
```

Run:

```powershell
cd F:\yuediter
pnpm vitest run src/services/sync/__tests__/checkpoint.test.ts
```

Expected: FAIL because module is missing.

Commit:

```powershell
cd F:\yuediter
git add src/services/sync/__tests__/checkpoint.test.ts
git commit -m "test(sync): specify checkpoint builder"
```

### Task F2: Implement checkpoint builder

**Files:**
- Create `F:\yuediter\src\services\sync\checkpoint.ts`

- [ ] Export types:
  - `DraftCheckpointBlock`
  - `DraftCheckpointRequest`
  - `DraftCheckpointMapping`
  - `BuildDraftCheckpointInput`
- [ ] Implement `buildDraftCheckpoint(input)`.
- [ ] Implement `applyCheckpointAck(doc, mappings)`.
- [ ] Use `readIdentityFromAttrs()` from `@/services/sync/identity`.
- [ ] Use `extractPlainText()` from `@/services/tiptap-converter`.
- [ ] Use existing node `sortKey` or `data-sort-key` as initial `orderKey`; fallback to `(index + 1) * 1000` padded to six digits for now.
- [ ] Generate `syncCreateId` as `sync-create:${clientId}`.
- [ ] Hash stable JSON of `{ docId, rootBlockId, blocks }` and prefix with `sha256:`.
- [ ] If `crypto.subtle` is unavailable in Vitest, add a deterministic fallback with the same `sha256:` prefix; backend treats hash as opaque in this phase.
- [ ] Remove transient attrs from payload:
  - `syncCreateId`
  - `clientBatchId`
  - `data-sync-create-id`

Run:

```powershell
cd F:\yuediter
pnpm vitest run src/services/sync/__tests__/checkpoint.test.ts
```

Expected: PASS.

Commit:

```powershell
cd F:\yuediter
git add src/services/sync/checkpoint.ts src/services/sync/__tests__/checkpoint.test.ts
git commit -m "feat(sync): build draft checkpoint payloads"
```

### Task F3: Add checkpoint API client

**Files:**
- Modify `F:\yuediter\src\services\sync\api.ts`
- Modify `F:\yuediter\src\services\sync\__tests__\api.test.ts`

- [ ] Add failing API test:

```ts
it("posts draft checkpoints to the document checkpoint endpoint", async () => {
  apiPost.mockResolvedValue({
    acceptedCheckpointId: "checkpoint_1",
    appliedAt: 1710000000000,
    serverHead: 3,
    draftRevision: 5,
    needsReload: false,
    conflicts: [],
    contentHash: "sha256:test",
    mappings: [],
    tombstoned: [],
  });

  const response = await postDraftCheckpoint("doc_1", {
    mode: "checkpoint",
    coverage: "full",
    clientCheckpointId: "checkpoint_1",
    clientId: "frontend-client",
    baseVersion: 3,
    draftRevision: 4,
    sessionId: "sync_1",
    sessionEpoch: 2,
    contentHash: "sha256:test",
    generatedAt: 1710000000000,
    rootBlockId: "root_1",
    blocks: [],
  });

  expect(apiPost).toHaveBeenCalledWith("/documents/doc_1/draft-checkpoint", expect.objectContaining({
    clientCheckpointId: "checkpoint_1",
  }));
  expect(response.draftRevision).toBe(5);
});
```

Run:

```powershell
cd F:\yuediter
pnpm vitest run src/services/sync/__tests__/api.test.ts
```

Expected: FAIL because `postDraftCheckpoint` is missing.

- [ ] Add response interface and function in `api.ts`:

```ts
export interface DraftCheckpointResponse {
  acceptedCheckpointId: string;
  appliedAt: number;
  serverHead: number;
  draftRevision: number;
  needsReload: boolean;
  conflicts: Array<{ code: string; message: string }>;
  contentHash: string;
  mappings: DraftCheckpointMapping[];
  tombstoned: Array<{ blockId: string; clientId?: string | null; syncCreateId?: string | null }>;
}

export async function postDraftCheckpoint(
  docId: string,
  request: DraftCheckpointRequest,
): Promise<DraftCheckpointResponse> {
  return apiPost<DraftCheckpointResponse>(`/documents/${docId}/draft-checkpoint`, request);
}
```

Run:

```powershell
cd F:\yuediter
pnpm vitest run src/services/sync/__tests__/api.test.ts
```

Expected: PASS.

Commit:

```powershell
cd F:\yuediter
git add src/services/sync/api.ts src/services/sync/__tests__/api.test.ts
git commit -m "feat(sync): add draft checkpoint api client"
```

### Task F4: Require checkpoint before manual commit

**Files:**
- Modify `F:\yuediter\src\hooks\useDocumentSync.source.test.ts`
- Modify `F:\yuediter\src\hooks\useDocumentSync.ts`

- [ ] Add failing source test:

```ts
it("runs draft checkpoint before commit action in the manual save barrier", () => {
  const source = readFileSync(resolve(__dirname, "useDocumentSync.ts"), "utf8");
  const barrierIndex = source.indexOf("const flushAndCommitBarrier");
  const checkpointIndex = source.indexOf("await runDraftCheckpoint", barrierIndex);
  const commitIndex = source.indexOf("await commitAction()", barrierIndex);

  expect(barrierIndex).toBeGreaterThan(-1);
  expect(checkpointIndex).toBeGreaterThan(barrierIndex);
  expect(commitIndex).toBeGreaterThan(checkpointIndex);
});
```

Use the file-reading helper already present in `useDocumentSync.source.test.ts` if it exists.

Run:

```powershell
cd F:\yuediter
pnpm vitest run src/hooks/useDocumentSync.source.test.ts
```

Expected: FAIL.

- [ ] In `useDocumentSync.ts`, import:

```ts
import { buildDraftCheckpoint, applyCheckpointAck } from "@/services/sync/checkpoint";
import { postDraftCheckpoint } from "@/services/sync/api";
```

- [ ] Add checkpoint id helper:

```ts
function createCheckpointClientId(): string {
  return `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
```

- [ ] Add `runDraftCheckpoint` callback before `flushAndCommitBarrier`:

```ts
const runDraftCheckpoint = useCallback(
  async (latestContent?: TiptapDoc | null): Promise<boolean> => {
    const current = stateRef.current;
    const contentForCheckpoint = latestContent ?? latestContentRef.current;
    if (!current || !contentForCheckpoint) return false;
    if (!current.sessionId || typeof current.sessionEpoch !== "number") return false;

    const checkpoint = await buildDraftCheckpoint({
      docId: current.docId,
      rootBlockId: current.rootBlockId,
      content: contentForCheckpoint,
      baseVersion: current.baseVersion,
      draftRevision: current.draftRevision,
      sessionId: current.sessionId,
      sessionEpoch: current.sessionEpoch,
      clientId: current.sessionId,
      clientCheckpointId: createCheckpointClientId(),
    });

    const response = await postDraftCheckpoint(current.docId, checkpoint);
    if (response.needsReload) {
      updateSyncState((prev) =>
        prev
          ? {
              ...prev,
              syncState: "conflicted",
              lastError: response.conflicts[0]?.message ?? "Checkpoint sync requires reload",
              draftRevision: response.draftRevision,
            }
          : prev,
      );
      return false;
    }

    updateSyncState((prev) =>
      prev
        ? {
            ...prev,
            draftRevision: response.draftRevision,
            baseVersion: response.serverHead,
            entries: {},
            dirtyOrder: [],
            inflightBatchId: null,
            inflightEntryIds: [],
            inflightEntryRevisions: {},
            syncState: "idle",
            lastError: null,
          }
        : prev,
    );

    const patched = applyCheckpointAck(contentForCheckpoint, response.mappings);
    snapshotRef.current = patched;
    if (onContentPatched && patched !== contentForCheckpoint) {
      const applied = onContentPatched(patched);
      if (applied && applied.type === "doc") {
        snapshotRef.current = applied;
        latestContentRef.current = applied;
      }
    }
    return true;
  },
  [onContentPatched, updateSyncState],
);
```

- [ ] In `flushAndCommitBarrier`, call checkpoint after `await flush("manual-save")` and before `await commitAction()`:

```ts
const checkpointOk = await runDraftCheckpoint(latestContent ?? latestContentRef.current);
if (!checkpointOk) return false;
```

- [ ] Run:

```powershell
cd F:\yuediter
pnpm vitest run src/hooks/useDocumentSync.source.test.ts src/services/sync/__tests__/checkpoint.test.ts src/services/sync/__tests__/api.test.ts
```

Expected: PASS.

- [ ] Commit:

```powershell
cd F:\yuediter
git add src/hooks/useDocumentSync.ts src/hooks/useDocumentSync.source.test.ts
git commit -m "feat(sync): checkpoint before manual commit"
```

### Task F5: Fallback to checkpoint after repeated batch failures

**Files:**
- Modify `F:\yuediter\src\hooks\useDocumentSync.source.test.ts`
- Modify `F:\yuediter\src\hooks\useDocumentSync.ts`

- [ ] Add failing source test:

```ts
it("falls back to draft checkpoint after repeated batch failures", () => {
  const source = readFileSync(resolve(__dirname, "useDocumentSync.ts"), "utf8");
  expect(source).toContain("batchFailureCountRef");
  expect(source).toContain("MAX_BATCH_FAILURES_BEFORE_CHECKPOINT");
  expect(source).toContain("await runDraftCheckpoint(latestContentRef.current)");
});
```

Run:

```powershell
cd F:\yuediter
pnpm vitest run src/hooks/useDocumentSync.source.test.ts
```

Expected: FAIL.

- [ ] Add refs/constants near existing refs:

```ts
const batchFailureCountRef = useRef(0);
const MAX_BATCH_FAILURES_BEFORE_CHECKPOINT = 2;
```

- [ ] Reset counter after successful batch:

```ts
batchFailureCountRef.current = 0;
```

- [ ] In batch send catch block, after `resolveBatchFailure`, add:

```ts
batchFailureCountRef.current += 1;
if (batchFailureCountRef.current >= MAX_BATCH_FAILURES_BEFORE_CHECKPOINT) {
  try {
    const recovered = await runDraftCheckpoint(latestContentRef.current);
    if (recovered) batchFailureCountRef.current = 0;
  } catch {
    // Keep existing error state. The next user action or manual save can retry checkpoint.
  }
}
return;
```

- [ ] Run:

```powershell
cd F:\yuediter
pnpm vitest run src/hooks/useDocumentSync.source.test.ts
```

Expected: PASS.

- [ ] Commit:

```powershell
cd F:\yuediter
git add src/hooks/useDocumentSync.ts src/hooks/useDocumentSync.source.test.ts
git commit -m "feat(sync): recover repeated batch failures with checkpoint"
```

---
## 6. Manual Verification Tasks

### Task V1: Full-state replacement scenario

- [ ] Start backend:

```powershell
cd F:\yumer-server
pnpm start:dev
```

- [ ] Start frontend:

```powershell
cd F:\yuediter
pnpm dev
```

- [ ] In browser console enable trace:

```js
localStorage.setItem("sync-debug-log-enabled", "true");
```

- [ ] Open a test document.
- [ ] Paste 200 paragraphs.
- [ ] Immediately select all and delete.
- [ ] Paste 150 different paragraphs.
- [ ] Click save.
- [ ] Refresh page.

Expected:

- [ ] Refreshed document contains exactly the 150 final paragraphs.
- [ ] None of the old 200 paragraphs reappear.
- [ ] Network tab shows `POST /documents/:docId/draft-checkpoint` before commit/save endpoint.
- [ ] Backend log shows one checkpoint applied for the save.

### Task V2: Weak network save scenario

- [ ] Open a test document.
- [ ] Paste 100 paragraphs.
- [ ] Use browser DevTools to throttle or temporarily block network during autosync.
- [ ] Restore network.
- [ ] Click save.
- [ ] Refresh page.

Expected:

- [ ] Save succeeds only after checkpoint succeeds, or fails clearly without committing stale draft.
- [ ] If save succeeds, refreshed content equals final editor content.
- [ ] If save fails, UI remains in error state and user is not told content is saved.

### Task V3: Late create suppression scenario

- [ ] Create many blocks while network is slow.
- [ ] Delete all before create ACK returns.
- [ ] Trigger checkpoint by saving.
- [ ] Refresh page after all network requests settle.

Expected:

- [ ] Deleted old blocks do not reappear.
- [ ] Backend tombstone table contains records for deleted sync-created blocks.
- [ ] Old create ACKs do not patch deleted blocks back into the editor.

---

## 7. Final Verification Checklist

Backend:

- [ ] Run:

```powershell
cd F:\yumer-server
pnpm jest src/modules/documents/draft-checkpoint.service.spec.ts src/modules/blocks/blocks-sync-idempotency.spec.ts --runInBand
pnpm build
```

Expected: both commands exit 0.

Frontend:

- [ ] Run:

```powershell
cd F:\yuediter
pnpm vitest run src/services/sync/__tests__/checkpoint.test.ts src/hooks/useDocumentSync.source.test.ts src/services/sync/__tests__/api.test.ts src/services/sync/__tests__/engine-order.test.ts
pnpm build
```

Expected: both commands exit 0.

Git hygiene:

- [ ] Run:

```powershell
cd F:\yumer-server
git status --short
cd F:\yuediter
git status --short
```

Expected:

- [ ] Only intentional source/test/doc changes remain.
- [ ] No `.env`, logs, build output, uploaded files, or cache files are staged.
- [ ] Commits are small and task-sized.

Handoff note must include:

- [ ] Backend commit list.
- [ ] Frontend commit list.
- [ ] Test command outputs.
- [ ] Manual verification results.
- [ ] Any limitation or failure not solved in this phase.

---

## 8. Explicitly Out of Scope

Do not implement these in this execution batch:

- Full CRDT/Yjs collaboration runtime.
- Partial checkpoint coverage.
- Storage migration from `sortKey` column to `orderKey` column.
- Compression/chunked upload for huge checkpoint payloads.
- Multi-tab BroadcastChannel UX.
- Full Playwright weak-network stress suite.
- Replacing all incremental sync with checkpoint.

---

## 9. Completion Criteria

Another reviewer can start validation when all items below are true:

- [ ] Backend endpoint `POST /documents/:docId/draft-checkpoint` exists.
- [ ] Backend checkpoint service handles create, update, reorder, delete, receipt replay, fingerprint conflict, stale draft revision, and session mismatch.
- [ ] Backend checkpoint tests pass.
- [ ] Frontend can build checkpoint payloads from TipTap doc.
- [ ] Frontend API client posts checkpoint to the new endpoint.
- [ ] Manual save barrier runs checkpoint before commit.
- [ ] Repeated batch failures attempt checkpoint recovery.
- [ ] Frontend checkpoint/API/hook tests pass.
- [ ] Frontend and backend builds pass.
- [ ] Manual full-state replacement scenario passes after refresh.

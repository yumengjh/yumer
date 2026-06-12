# 2026-06-12 Delta Overlay Review Fixes Retrospective

> Scope: follow-up fixes from `2026-06-12-delta-overlay-implementation-review.md` before continuing the remaining delta audit tasks.  
> Repositories: `yuediter` and `yumer-server`.

---

## 1. Context

The implementation review found one confirmed backend test failure and one frontend performance issue:

1. `BlockPayloadResolverService` returned different payload shapes depending on whether the newest version was stored as `full` or reconstructed through a `delta` chain.
2. `buildSyncBatchOperations` computed delta patches twice for the same update: once to decide whether delta was worth sending and again to build the actual delta request.

Both problems affect the stability of delta transport because canonical payload identity must stay bit-exact across transport, storage, ACK, and retry paths.

---

## 2. Fixes Applied

### 2.1 Backend resolver output normalization

`yumer-server/src/modules/blocks/block-delta/block-payload-resolver.service.ts` now normalizes full payload rows through the same canonical rules used by delta reconstruction:

- `ensurePayloadType`
- `canonicalStringify`
- `parseCanonicalPayload`

This aligns codeBlock attrs default expansion, language alias normalization, key order, and CRLF handling between full rows and reconstructed delta rows.

### 2.2 Frontend single-pass delta candidate builder

`yuediter/src/services/sync/delta.ts` now exposes `buildBlockDeltaIfUseful()`.

The helper computes canonical text, patch text, patch ratio, hashes, and the final `BlockDeltaInput` in one pass. `api.ts` uses it after parsing the synced base once, eliminating the previous `shouldSendDelta()` + `buildBlockDelta()` duplicate work.

---

## 3. Tests Added

### Backend

- Full codeBlock resolver path returns canonical output like delta reconstruction.
- Delta chain resolver expectations now compare against canonical payload output.

### Frontend

- `buildBlockDeltaIfUseful()` returns `null` for non-useful small patches and a valid delta for large useful patches.
- `buildSyncBatchOperations()` parses `base.canonical` only once when building a delta update.

---

## 4. Verification

Commands run before this retrospective was written:

```bash
# yuediter
pnpm exec vitest run   src/services/sync/__tests__/delta.test.ts   src/services/sync/__tests__/base-store.test.ts   src/services/sync/__tests__/api.test.ts   src/services/sync/__tests__/batch-failure-delta.test.ts   src/services/sync/__tests__/batch-failure.test.ts   src/services/sync/__tests__/ack-rescan-filter.test.ts   src/services/sync/__tests__/snapshot-ack-skip.test.ts   src/services/sync/__tests__/engine-order.test.ts
```

Result: 8 files passed, 53 tests passed.

```bash
# yumer-server
npm test -- --testPathPatterns="block-delta|gc-delta-chain|batch-block.dto|block-payload-resolver"
```

Result: 4 suites passed, 14 tests passed.

---

## 5. Follow-up

Continue with the remaining review items:

1. Document/version-hash naming boundary on the server.
2. Add cross-repository golden hash contract tests using `delta-fixtures.json`.
3. Add force-full ACK integration coverage on the client.
4. Fill remaining medium-priority delta branch and retry tests.
5. Update the implementation review status tables after verification.

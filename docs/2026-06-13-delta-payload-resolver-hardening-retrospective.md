# 2026-06-13 Delta Payload Resolver Hardening Retrospective

> Scope: follow-up fixes after reviewing recent delta feature commits.  
> Repositories: `yuediter` and `yumer-server`.  
> Type: hardening / compatibility guard, not a change to the delta storage design.

---

## 1. Background

The delta storage design allows `BlockVersion` rows to be stored in two shapes:

- `payloadKind = "full"`: `payload` contains the complete block payload.
- `payloadKind = "delta"`: `payload` can be `null`, while `baseVer` + `delta` reconstruct the complete payload.

The reviewed code already implemented the core delta storage model, but several existing read/derive paths still treated `BlockVersion.payload` as always complete. That assumption is unsafe once a latest or historical version can be a delta row.

---

## 2. Root Cause

The bug was not in patch generation itself. The root cause was an incomplete boundary migration:

1. Storage had moved from "payload is always complete" to "payload may be null for delta rows".
2. Some content, diff, move, and delete paths still read `BlockVersion.payload` directly.
3. When those paths hit a delta row, they could return empty content, generate wrong diff snapshots, or create derived versions with `payload: null`.

Correct invariant:

> Any path that needs complete block content must use `BlockPayloadResolverService` before reading `type`, `attrs`, `content`, or using the payload to create another version.

---

## 3. Fixes Applied

### 3.1 Frontend build contract

Files:

- `src/services/sync/api.ts`
- `src/services/sync/engine.ts`

Changes:

- `SyncBatchResponse.draftRevision` is now typed as required because the current backend batch response and frontend callers require it.
- Move derivation suppression now avoids `blockId && ...` type widening to `"" | ReadonlySet<string>`.

### 3.2 Backend move/delete derived-version guard

Files:

- `F:/yumer-server/src/modules/blocks/blocks.service.ts`
- `F:/yumer-server/src/modules/blocks/blocks.service.draft.spec.ts`

Changes:

- Before move/delete creates a derived version from the latest block version, the latest payload is resolved through `BlockPayloadResolverService`.
- Delete compensation now reads identity fields from the resolved full payload.
- Added regression coverage for latest-version-is-delta move/delete paths.

### 3.3 Backend diff snapshot guard

Files:

- `F:/yumer-server/src/modules/documents/documents.service.ts`
- `F:/yumer-server/src/modules/documents/documents.service.spec.ts`

Changes:

- Diff queries now select resolver-required fields such as `id`, `docId`, `payloadKind`, `baseVer`, and `delta`.
- Diff visibility checks and snapshot extraction use resolved payloads.
- Added regression coverage for a modified block whose `to` side is a delta row.

### 3.4 Backend startBlock / children on-demand guard

Files:

- `F:/yumer-server/src/modules/documents/documents.service.ts`
- `F:/yumer-server/src/modules/documents/documents.service.spec.ts`

Changes:

- On-demand content tree paths resolve root, parent, sibling, and child version payloads before building response nodes.
- Added regression coverage for `getChildrenBlocks()` returning a delta child version.

---

## 4. Design Decision

This work is a protection mechanism around the existing design, not a new feature design.

The delta design remains:

- Store full payloads when needed.
- Store delta rows when useful.
- Reconstruct full payloads through the resolver when complete content is needed.

The hardening added here enforces that design boundary in paths that previously bypassed the resolver.

---

## 5. Verification

Commands used for this fix set:

```bash
# yumer-server
pnpm test -- src/modules/blocks/block-delta/block-delta.spec.ts src/modules/blocks/block-delta/block-payload-resolver.service.spec.ts src/modules/blocks/dto/batch-block.dto.spec.ts src/modules/blocks/blocks.service.draft.spec.ts src/modules/documents/documents.service.spec.ts --runInBand
pnpm build

# yuediter
pnpm test:unit -- src/services/sync/__tests__/delta.test.ts src/services/sync/__tests__/api.test.ts src/services/sync/__tests__/base-store.test.ts src/services/sync/__tests__/batch-failure-delta.test.ts
pnpm build
```

Observed results before commit:

- Backend: 5 test files passed, 86 tests passed.
- Backend build: passed with TSC 0 issues.
- Frontend: 4 test files passed, 33 tests passed.
- Frontend build: passed with Next.js production build and TypeScript checks.

---

## 6. Follow-up

1. Fix and test the migration SQLite type guard so both `sqlite` and `better-sqlite3` paths stay safe.
2. Continue auditing direct `BlockVersion.payload` reads in search, render cache, GC, restore, and historical tooling paths.
3. Consider adding a small helper or naming convention for resolved payload usage to make future direct reads easier to spot in review.

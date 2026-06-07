# 前端同步稳定性验证复盘

> 日期：2026-06-07
> 前端仓库：`E:\workspace\editor-demo\app`
> 对应后端仓库：`E:\workspace\yumer-server`
> 目的：补齐前端同步状态机与 API 契约验证，确认本轮后端 sync hardening 在前端侧有对应保护和可重复证明。

## 1. 本轮结论

本轮前端没有继续改同步协议，也没有继续改 UI 行为。

本轮做的事情是：

- 对现有前端同步状态机补验证；
- 对现有前端同步 API 契约补验证；
- 确认前端保存屏障、session 恢复、beforeunload、load gate、ack 回填这些关键保护仍然成立。

如果只讨论前端当前代码层面的同步稳定性，可以认为：

- 前端和后端本轮 hardening 的契约已经对齐；
- 前端同步状态机的关键分支已有自动化证明；
- 但这仍然不等于“真实浏览器多标签页体验已经完整验证”。

## 2. 本轮实际补了什么

### 2.1 `useDocumentSync` 源码守卫补强

修改文件：

- `src/hooks/useDocumentSync.source.test.ts`

新增验证点：

1. 只有 `SYNC_SESSION_EXPIRED` / `SYNC_SESSION_REQUIRED` 会触发自动 `acquireSyncSession()` 恢复。
2. session 恢复后会回写：
   - `sessionId`
   - `sessionEpoch`
   - `lastAckedOpSeq`
   - `syncState`
   - `lastError`
3. `reconcile` 的 session 冲突会把前端状态机打到 `lease-lost`。
4. `batch` 的 session 冲突也会把前端状态机打到 `lease-lost`。

这意味着当前前端对后端已明确的 session 契约保持了保守行为：

- `expired` / `required` 尝试恢复；
- `mismatch` 不自动抢回，保留为失效态。

### 2.2 文档 API 契约验证补强

修改文件：

- `src/services/__tests__/document-commit-api.test.ts`

新增验证点：

1. `commitVersion()` 继续透传：
   - `sessionId`
   - `sessionEpoch`
   - `ackedThroughOpSeq`
2. `renewSyncSession()` 只发送 session identity，不夹带多余字段。
3. `acquireSyncSession()` 走：

```text
/documents/:docId/sync-session/acquire
```

并能接收 `sessionId/sessionEpoch/lastAckedOpSeq`。

## 3. 本轮复核但未改动的关键保护

本轮验证同时复核了以下现有保护仍然在代码中成立：

1. 手动保存屏障顺序仍是：

```text
flush -> draft-checkpoint -> commit
```

2. `commitVersion()` 后会回写新的 `version` 与 `draftRevision`。
3. inflight batch 的 ACK 处理仍然先捕获最新编辑器快照，再接收 ack baseline。
4. `beforeunload` 仍然同时看：

```text
hasUnsavedChanges || sync.hasPendingSync
```

5. sync engine 仍然要求文档 body 真正加载成功后才消费同步输入。

## 4. 本轮实际验证

已执行：

```powershell
pnpm vitest run src/hooks/useDocumentSync.source.test.ts src/components/__tests__/sync-session-plumbing.source.test.ts src/components/__tests__/manual-save-base-version.source.test.ts src/components/__tests__/editor-before-unload.source.test.ts src/components/__tests__/editor-sync-load-gate.source.test.ts src/services/sync/__tests__/api.test.ts src/services/__tests__/document-commit-api.test.ts src/services/sync/__tests__/reducer.test.ts
pnpm build
```

结果：

- 8 个测试文件通过
- 49 个测试通过
- `next build` 通过

## 5. 现在可以宣称什么

当前可以明确宣称：

1. 前端 session 恢复逻辑与后端当前返回语义一致。
2. 前端不会把 `SYNC_SESSION_MISMATCH` 当成可自动抢回的正常恢复路径。
3. 手动保存链路仍然受 checkpoint 屏障和 commit rebase 保护。
4. 前端同步 API 对 `commit`、`renew`、`acquire` 的请求构造已和后端当前契约对齐。

## 6. 现在还不能宣称什么

当前还不能直接宣称：

1. 多标签页真实交互体验已经完整验证。
2. 浏览器生命周期下的真实网络抖动场景已经完整验证。
3. 前端 UI 呈现给用户的所有同步状态都已经被浏览器级 E2E 证明。

原因：

- 当前仓库没有现成浏览器级同步 E2E harness；
- 本轮补的是源码/请求构造/状态机层面的自动化证明，不是整页交互级自动化。

## 7. 建议提交范围

建议本次提交只包含：

- `src/hooks/useDocumentSync.source.test.ts`
- `src/services/__tests__/document-commit-api.test.ts`
- `docs/superpowers/reviews/2026-06-07-frontend-sync-validation-retrospective.md`

本次不建议扩大范围去带无关 UI 改动。

## 8. 建议提交说明

建议提交标题：

```text
test(sync): validate frontend sync recovery contracts
```

建议提交正文：

```text
Add frontend sync validation for session recovery guards and document sync API contracts.

Verify that useDocumentSync only auto-recovers expired/required sessions,
preserves lease-lost handling for mismatch conflicts, and keeps the manual save barrier assumptions intact.

Docs:
docs/superpowers/reviews/2026-06-07-frontend-sync-validation-retrospective.md
```

## 9. 提交判断

如果本次提交目标是：

- 补齐前端同步状态机验证；
- 补齐前端和后端当前 sync hardening 的契约证明；
- 给下一步前端真实浏览器级稳定性工作留下清晰边界；

那么当前已经满足提交条件。

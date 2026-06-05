# 弱网大文档快速替换同步残留 BUG 深度分析

日期：2026-06-05

关联复盘：`docs/superpowers/reports/2026-06-05-weak-network-large-doc-sync-unresolved-retrospective.md`

前端仓库：`E:\workspace\editor-demo\app`

后端仓库：`E:\workspace\yumer-server`

## 结论

当前问题不应继续按单个 reducer 分支猜补丁。线上复现路径包含大批量 create、多批次 flush、React state/effect 延迟、Tiptap transaction、ACK 回填、服务端草稿修订推进、刷新重建内容等多层竞态；现有日志只能看到 batch request/response，不能证明某个残留块属于哪一次 create，以及为什么没有被最终 delete 覆盖。

本次分析认为稳定修复至少需要三层：

1. P0 先补黑匣子 trace，把编辑器最终态、snapshot、dirty queue、ACK、服务端命中方式串起来。
2. P1 增加弱网大文档 E2E 复现测试，作为后续修复准入。
3. P2 引入最终态收敛兜底或持久化 create tombstone，避免 op-log 在快速替换场景下漏删后无自愈能力。

## 现象复述

用户在 Slow 3G 和大文档场景下：

1. 一次性粘贴大量块。
2. 同步未完成时马上全选删除。
3. 立即输入新内容。
4. 等待 UI 显示同步完成。
5. 刷新后仍看到部分第一次粘贴的旧内容残留。

这说明前端本地最终态与服务端 draft 最终态发生分叉，且 UI idle/saved 状态没有做服务端最终态校验。

## 已确认的链路事实

### 前端同步由 React content state 驱动

`src/hooks/useDocumentSync.ts` 中 `captureContentSnapshot` 只接收 React 层传入的 `content`，然后用 `advanceSyncSnapshot(previousSnapshot, nextContent)` 生成操作。相关位置：

- `useDocumentSync.ts:185-206`：捕获 content 并推进 snapshot。
- `useDocumentSync.ts:210-212`：`latestContentRef` 只随 `content` state 更新。
- `useDocumentSync.ts:385`：batch 成功后再次捕获 `latestContentRef.current`。

这意味着真实 Tiptap transaction 流没有被完整记录；如果 React state 在大粘贴、删除、输入之间只暴露中间态或被 ACK patch 覆盖，当前日志无法证明最终 delete diff 是否覆盖了所有旧 clientId。

### 前端每批最多发送 100 个 SyncEntry

`src/services/sync/batching.ts` 固定 `SYNC_BATCH_LIMITS.total = 100`。大粘贴必然拆成多批。弱网下可能出现：

- 第 1 批 create 已发送并 inflight。
- 第 2/N 批 create 仍在 dirty queue。
- 用户删除后 reducer 需要同时处理 inflight create 和未发送 create。

已做的补丁能覆盖一部分：`src/services/sync/reducer.ts:97-115` 对 inflight create 转 delete，未 inflight create 直接取消。但这仍依赖删除 diff 能枚举到所有旧 clientId。

### 当前 debug log 只记录 batch，不记录状态机上下文

`src/services/sync/debug-log.ts` 只保存 request/response/duration，`src/services/sync/api.ts:218-230` 添加日志。缺失内容包括：

- 每次 editor update 的 top-level manifest。
- 每次 snapshot advance 的 prev/next manifest 和派生 entries。
- 每次 dirtyOrder 和 entries 状态。
- 每次 ACK patch 前后 snapshot/editor 状态。
- 每次 idle 时前端最终 manifest。

因此现阶段无法从现有日志回答“残留块是哪批 create 创建、对应 delete 是否发出、delete 是否命中”。

### 后端 delete by client identity 没有持久化 tombstone

`E:\workspace\yumer-server\src\modules\blocks\blocks.service.ts` 中：

- `findActiveBlockVersionByClientIdentity` 只查 active block 最新版本，见 `blocks.service.ts:1767-1800`。
- `handleBatchDelete` 若只有 `clientId/syncCreateId` 且未命中 active block，会返回 success-like 结果，见 `blocks.service.ts:1881-1886`。
- 该返回不产生 draft mutation，也不记录任何 durable tombstone。

这个行为适合“delete 已经晚于 create 但 create 不存在”的幂等兜底；不适合“delete 先于 create 或 create 仍可能晚到”的弱网链路。服务端没有“这个 syncCreateId 已被最终态删除”的长期记忆，后续 create 仍可落库。

### 后端 batch 支持部分成功并推进 draft

`blocks.service.ts:1379-1490` 对每个 operation 单独 try/catch，`blocks.service.ts:1496-1525` 在 draft mode 下只要 `draftMutations.length > 0` 就会写入 draft 并推进 draftRevision，即使同批存在失败结果。前端会在 `useDocumentSync.ts:372-383` 先 resolve success，再根据 `summarizeSyncBatchFailures` 标 error。

这本身不是残留的直接证据，但说明 batch 不是全有全无。只要某批 create 成功、delete 失败或未覆盖，服务端 draft 就可能先被推进到包含旧块的状态。

### 服务端内容重建会过滤 deleted version，但不会主动对齐前端最终态

`DocumentsService.buildContentTreeFromVersionMap` 会过滤 `payload.attrs.deleted === true`，见 `documents.service.ts:3015-3024`。这说明已命中的 draft delete 通常不会在刷新后显示。

因此残留更可能来自：

- 没有生成 delete。
- delete 没有发出。
- delete 发出但没有命中对应 create。
- create 在 delete 之后被服务端接受。
- UI 误判 idle，而服务端 manifest 仍多出旧块。

## 最可能失效路径

### 路径 A：最终删除 diff 未覆盖全部旧 clientId

大粘贴生成大量 top-level block，前端 snapshot 依赖 React content effect。若删除后最终 content 与 snapshotRef 的关系被中间 ACK patch 或 state 批处理打乱，`deriveSyncEntries` 可能只对部分 pasted clientId 生成 delete。

该路径可解释“不是全部残留，而是某一部分残留”。

需要 trace 证明：

- paste 后 snapshot 中到底有多少旧 clientId。
- delete/new input 后 `advanceSyncSnapshot` 生成了多少 delete。
- idle 时 snapshot/editor manifest 是否仍含旧 pasted clientId。

### 路径 B：未发送 create 被取消，但其请求实际已进入网络层或服务端

前端对非 inflight create 的处理是直接从 dirty queue 删除，不发送 tombstone。正常情况下这没问题，因为未 inflight 表示未发送。但弱网和异步状态下，“前端认为未 inflight”与“请求是否已经进入网络层/服务端”之间需要 trace 证明。

一旦存在 late create，而后端又没有 durable tombstone，就可能刷新后残留。

### 路径 C：client identity delete 未命中后被当成成功

当前后端对未命中的 identity delete 返回成功形状，但没有诊断码，也没有持久化墓碑。前端会清理对应 entry，UI 可继续走向 idle。若之后同一 `syncCreateId` 的 create 落库，就没有任何服务端机制阻止残留。

这是当前代码中明确存在的协议缺口。

### 路径 D：UI saved 只代表前端队列收敛，不代表服务端最终态一致

`useDocumentSync.ts:506-515` 的 UI 状态只看 reducer 状态。它不会在 idle 时拿前端 manifest 与服务端 draft manifest 比较。只要某些旧块已经从前端队列错误清掉，UI 仍可能显示 saved。

## 为什么前几次修复没有命中

前几次修复覆盖的是局部状态机路径：

- inflight create 后 delete。
- 无 blockId delete tombstone。
- 后端通过 clientId/syncCreateId 找 active block。

但真实 BUG 需要证明完整链路中的“最终态覆盖关系”。当前缺少 E2E 复现和可导出 trace，因此补丁只能验证人工构造状态，不能覆盖 Slow 3G 大文档快速替换。

## 修复原则

1. 先观测，后收敛。没有 trace 前不要继续加猜测式 reducer 分支。
2. 不把 delete-not-found 静默当成强成功；必须返回诊断码或保存墓碑。
3. UI saved 不能只等价于 dirtyOrder 为空；弱网大批量替换后至少要有最终态校验兜底。
4. 测试必须覆盖真实浏览器、网络节流和刷新后服务端重建内容。
5. 所有新增日志必须 bounded，可开关，可一键导出，不污染生产默认体验。

## 建议落地方案

### P0：黑匣子 trace

前端增加 `SyncTraceLog`，记录以下事件：

- `editor:update`：content hash、top-level `{index,type,clientId,blockId,syncCreateId,sortKey,textPreview}`。
- `snapshot:advance`：prev/next manifest、derived entries 摘要。
- `queue:state`：entries、dirtyOrder、inflightBatchId、inflightEntryIds、localRevision。
- `flush:dispatch`：selected operations，包含 `revision/clientId/blockId/syncCreateId/opType/sortKey`。
- `flush:response`：results、ackedThroughOpSeq、draftRevision。
- `ack:patch`：ACK mappings、patch 前后 manifest。
- `idle:manifest`：前端最终 manifest。

后端 batch 增加结构化日志或 debug response 扩展：

- batchId、operation index/type。
- create 的 `clientId/syncCreateId/blockId/sortKey`。
- delete 的 `blockId/clientId/syncCreateId` 和命中方式：`blockId`、`syncCreateId`、`clientId`、`not_found`。
- delete 未命中时返回明确诊断码，例如 `DELETE_TARGET_NOT_FOUND_BY_CLIENT_IDENTITY`，不能只给成功形状。

### P1：弱网 E2E 复现

使用 Playwright 或现有测试栈：

1. 登录并创建/打开文档。
2. 对编辑页面设置 Slow 3G 或等效 route delay。
3. 粘贴 300+ 带唯一 marker 的段落。
4. 不等待同步完成，立即全选删除。
5. 输入唯一 final marker。
6. 等待前端进入 idle。
7. 刷新。
8. 断言只存在 final marker，不存在 paste marker。
9. 失败时导出前端 trace 和后端 batch 日志。

### P2：最终态收敛兜底

在前端 idle 时发送当前 top-level manifest 给后端。后端对当前 session 创建的块执行对账：

- 服务端 draft 中存在、前端 manifest 不存在、且 payload attrs 中带当前 session/client identity 的块，应转为 deleted draft version。
- 返回 reconciliation 结果：删除了哪些 orphan block，哪些未命中，当前 draftRevision。
- 前端收到后更新 draftRevision，并记录 trace。

该方案比继续只修 op-log 分支更稳，因为它把“最终编辑器状态”作为兜底真相。

### P3：持久化 create tombstone

后端增加轻量 tombstone 表或复用 batch receipt metadata，记录：

- `docId`
- `sessionId/sessionEpoch`
- `clientId`
- `syncCreateId`
- `deletedAt`
- `deleteClientBatchId`
- `expiresAt`

当 create 到达时，如果命中未过期 tombstone，则不要创建可见块；可返回成功 ACK，但标记 `tombstoned: true` 或返回 delete-compatible 结果。这样可以解决 late create。

## 验收标准

1. 弱网大文档快速替换 E2E 连续 10 次通过。
2. 刷新后页面只包含 final marker，不包含 paste marker。
3. trace 能定位每一个 residual candidate 的 create batch 和 delete/reconcile 状态。
4. 后端 delete-not-found 不再静默为普通成功；必须有诊断码或 tombstone。
5. `pnpm test:unit` 前端通过。
6. 后端 `pnpm test -- blocks-sync-idempotency.spec.ts blocks.service.draft.spec.ts documents.service.spec.ts` 或等价目标测试通过。


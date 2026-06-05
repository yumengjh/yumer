# Checkpoint Sync 设计：单用户稳定优先，预留多人协作演进

> 日期：2026-06-05  
> 前端仓库：`F:\yuediter`  
> 后端仓库：`F:\yumer-server`  
> 设计目标：在当前单用户编辑场景下，优先解决大批量编辑、弱网、刷新后的内容丢失/乱序问题，同时为未来多人协作保留接口和数据模型演进空间。

## 1. 背景与问题

当前同步链路已经有较多防护：`draftRevision`、`syncSession`、`clientBatchId` 幂等回执、`syncCreateId`、tombstone、manifest reconcile 等。但近期问题说明：继续只修补 create/update/delete/move 增量链路，复杂度和边界情况仍然很高。

核心问题不是某一个 reducer 分支，而是当前模型需要把用户的最终编辑器状态拆成许多局部操作，再依赖网络顺序、ACK、tombstone、reconcile 重新拼回最终状态。在以下场景中容易失稳：

- 粘贴大量块后立即全选删除。
- 全删后马上重新粘贴新内容。
- create batch inflight 时用户继续大幅编辑。
- 弱网导致部分 batch 成功、部分失败。
- 用户在队列未完全同步时刷新或关闭页面。
- sortKey 整数间距耗尽或 ACK sortKey 覆盖当前视觉顺序。

用户真正关心的是“刷新后服务端 draft 是否等于编辑器最终态”。因此需要新增一个 authoritative final-state 通道。

## 2. 总体方向：C2.5

本设计采用 C2.5：

1. 当前阶段实现 **Authoritative Checkpoint Sync**。
2. 同步引入 `orderKey` 概念，逐步替代整数型 `sortKey` 的代码假设。
3. 接口保留 `actorId`、`documentClock`、`parentCheckpointId`、`mode` 等字段，未来可演进到 op log 或 CRDT update。
4. 暂不直接接入 Yjs/Automerge，避免在当前单用户稳定性问题尚未解决时引入完整协作复杂度。

### 2.1 当前不做什么

- 不移除现有 `/blocks/batch` 增量同步。
- 不立即重构整个 block/draft/version 存储。
- 不实现多人协作 merge。
- 不引入完整 CRDT runtime。
- 不要求一次迁移所有历史 `sortKey`。

### 2.2 当前要做到什么

- 在高风险场景和保存前，前端发送完整文档最终态 checkpoint。
- 后端在一个事务中把 draft 调整到 checkpoint 描述的完整最终态。
- checkpoint 请求具备服务端幂等 receipt。
- checkpoint 成功后，前端用服务端返回的 blockId/orderKey 映射修补编辑器 identity。
- 刷新后服务端 draft 与 checkpoint 最终态一致。

## 3. 架构设计

### 3.1 同步通道分层

保留两条同步通道：

1. **增量通道：`POST /blocks/batch`**
   - 用于普通输入、少量 update/move/delete。
   - 继续沿用现有 reducer、dirty queue、batch ACK 机制。

2. **最终态通道：`POST /documents/:docId/draft-checkpoint`**
   - 用于大批量编辑、弱网恢复、保存前、关闭/刷新前兜底。
   - 以后也可作为协作系统中的 snapshot/checkpoint 层。

Checkpoint 不是替代所有增量同步的第一步，而是先作为高风险路径的权威纠偏通道。

### 3.2 前端触发条件

前端在以下条件触发 checkpoint：

1. **手动保存前**：`flushAndCommitBarrier()` 在 commit 前必须确保 checkpoint 成功，或明确失败并阻止 commit。
2. **批量变化阈值**：一次 snapshot diff 中 create/delete/move 总数超过阈值，例如 50。
3. **全量替换迹象**：短时间内同时出现大量 delete 和 create。
4. **同步失败恢复**：连续 batch 失败达到阈值，例如 2 次。
5. **刷新/关闭前**：如果仍有 dirty/inflight/error，尽力发送 checkpoint；不能保证完成时用 beforeunload 提醒用户。
6. **sortKey/orderKey corruption**：检测到重复、非单调、接近整数上限等情况。

初期可以只实现：手动保存前 + 批量变化阈值 + batch 连续失败后。刷新/关闭前可先做提醒，后续再尝试 beacon/sendBeacon 风格的轻量 checkpoint。

### 3.3 Checkpoint 请求 DTO

建议新增：

`POST /documents/:docId/draft-checkpoint`

```ts
type DraftCheckpointRequest = {
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

  // Future collaboration fields. Optional now, persisted/logged if provided.
  actorId?: string;
  documentClock?: number;
  parentCheckpointId?: string | null;

  rootBlockId: string;
  blocks: DraftCheckpointBlock[];
};

type DraftCheckpointBlock = {
  clientId: string;
  blockId?: string | null;
  syncCreateId?: string | null;

  type: string;
  parentId?: string | null;
  orderKey: string;

  payload: Record<string, unknown>;
  plainText?: string;
};
```

说明：

- `coverage: "full"` 表示 blocks 是当前文档 top-level 完整最终态。
- 当前阶段只接受 `mode: "checkpoint"` 和 `coverage: "full"`。
- `actorId/documentClock/parentCheckpointId` 现在不参与 merge，只作为未来协作演进预留。
- `orderKey` 是代码层新概念；落库初期可以继续写入现有 `sortKey` 字段。

### 3.4 Checkpoint 响应 DTO

```ts
type DraftCheckpointResponse = {
  acceptedCheckpointId: string;
  appliedAt: number;

  serverHead: number;
  draftRevision: number;
  needsReload: boolean;
  conflicts: Array<{ code: string; message: string }>;

  contentHash: string;
  mappings: Array<{
    clientId: string;
    blockId: string;
    orderKey: string;
    sortKey?: string;
  }>;

  tombstoned: Array<{
    blockId: string;
    clientId?: string | null;
    syncCreateId?: string | null;
  }>;
};
```

### 3.5 服务端处理流程

后端新增 `DocumentsService.applyDraftCheckpoint()` 或独立 `DocumentCheckpointService`。

事务流程：

1. 校验文档访问权限和编辑权限。
2. 标准化 `clientCheckpointId`。
3. 计算 request fingerprint。
4. 锁定目标 Document。
5. 查询 checkpoint receipt：
   - 同一 `docId + clientCheckpointId` 且 fingerprint 一致：返回旧 response。
   - 同一 id 但 fingerprint 不一致：返回 conflict。
6. 校验 `baseVersion`。
7. 校验当前 `draftRevision`。
8. 校验 sync session：`sessionId/sessionEpoch/leaseExpiresAt`。
9. 校验 `mode === "checkpoint"`，`coverage === "full"`。
10. 读取当前 draft block map。
11. 对请求 blocks 按 clientId/blockId/syncCreateId 匹配现有 block：
    - 有 blockId 且存在：update/move。
    - 无 blockId 但 syncCreateId/clientId 命中已有 create：update/move。
    - 不存在：create。
12. 对 checkpoint 中不存在、但当前 draft 可见的同步块标记 deleted。
13. 写入/更新 `DocDraft.blockVersionMap`。
14. `Document.draftRevision += 1`，如果内容没有变化可选择不递增，但初期建议所有成功 checkpoint 都递增，降低语义复杂度。
15. 保存 checkpoint receipt。
16. 返回 blockId/orderKey mappings。

### 3.6 删除语义

`coverage: "full"` 时：

- 当前 draft 中存在，但 checkpoint blocks 不存在的 top-level block，应视为用户最终态删除。
- 对这些 block 追加 deleted `BlockVersion`，更新 `Block.latestVer` 和 `DocDraft.blockVersionMap`。
- 如果 block 带 `clientId/syncCreateId`，同时写 tombstone，防止 late create 回流。

初期只处理 top-level block，和当前前端 sync engine 语义保持一致。

### 3.7 orderKey 设计

当前系统的整数 `sortKey` 容易出现 gap 耗尽和超过 999999 的问题。Checkpoint 设计引入 `orderKey` 作为协议层字段。

阶段 1：兼容落地

- 前端生成 `orderKey`。
- 后端 DTO 接受 `orderKey`。
- 后端实体暂时仍写入 `BlockVersion.sortKey`。
- response 同时返回 `orderKey` 和可选 `sortKey`。

阶段 2：实现 fractional key

- 新增共享算法，例如 base62 fractional indexing。
- 前后端都使用同一算法或以后端 canonical 为准。
- 不再依赖固定 6 位整数。

阶段 3：存储迁移

- 可选新增 `orderKey` 列，或重命名语义。
- 历史 `sortKey` 在读取时转换为 orderKey。

### 3.8 前端状态机集成

前端新增 checkpoint 状态，不替代原有 reducer：

```ts
type CheckpointState =
  | "idle"
  | "checkpointing"
  | "checkpoint-error";
```

或先复用 `syncState`，但建议不要继续挤进现有 batch reducer，避免状态机继续膨胀。

前端新增服务：

- `buildDraftCheckpoint(content, syncState)`
- `postDraftCheckpoint(request)`
- `applyCheckpointAck(content, mappings)`

与 `useDocumentSync` 集成：

- `flushAndCommitBarrier()`：先 capture 最新 editor JSON，再执行 checkpoint；checkpoint 成功后再 commit。
- `flush()`：连续失败后触发 checkpoint，而不是永久 error。
- `captureContentSnapshot()`：记录最近一次 diff 规模，超过阈值设置 checkpoint-needed 标记。

### 3.9 幂等与失败恢复

后端新增 checkpoint receipt，类似 `SyncBatchReceipt`：

字段：

- `docId`
- `clientCheckpointId`
- `requestFingerprint`
- `response`
- `createdBy`
- `createdAt`
- `updatedAt`

验收：

- 同一 checkpoint 请求重放 10 次，只写一次 draft。
- 同一 `clientCheckpointId` 但内容不同，返回 fingerprint conflict。
- 请求成功但响应丢失后，重试能拿回第一次 response。

前端失败策略：

- 网络失败：保留 checkpoint-needed 标记，可自动 retry。
- session 失败：进入 `lease-lost`，阻止继续写。
- draftRevision mismatch：进入 conflicted 或执行 reload/reconcile 提示。
- 手动保存前 checkpoint 失败：保存失败，不提交版本。

## 4. 未来多人协作演进

当前 checkpoint 不实现多人 merge，但接口预留演进路径：

### 4.1 actor 与 clock

- `actorId`：未来区分协作参与者。
- `documentClock`：未来用于逻辑时钟或服务端 sequence。
- `parentCheckpointId`：未来表示 checkpoint 基于哪个已确认状态生成。

当前阶段：字段可选，不参与冲突解决。

### 4.2 mode 扩展

当前只接受：

```ts
mode: "checkpoint"
```

未来可扩展：

```ts
mode: "checkpoint" | "oplog" | "crdt-update"
```

这样未来可以把协作操作或 CRDT update 接入同一路由族，而不推翻 checkpoint receipt、session、hash、draftRevision 等基础设施。

### 4.3 协作前的事实源

当前事实源仍是服务端 draft：

- `DocDraft.blockVersionMap`
- `Document.draftRevision`

未来多人协作时，可以在 draft 旁边增加：

- operation log
- CRDT document state
- periodic checkpoint snapshot

当前 checkpoint 可以成为未来协作系统的 compacted snapshot。

## 5. 测试策略

### 5.1 前端单元测试

新增或扩展：

1. `buildDraftCheckpoint` 能从 TipTap doc 生成 full coverage blocks。
2. block payload 清理 transient sync attrs。
3. orderKey 按视觉顺序生成且唯一。
4. 大量 create/delete diff 会设置 checkpoint-needed。
5. `flushAndCommitBarrier` 在 commit 前调用 checkpoint。
6. checkpoint 成功后 ACK mappings 能 patch 回 editor identity。

### 5.2 后端单元测试

新增：

1. checkpoint create 新 block。
2. checkpoint update 既有 block payload。
3. checkpoint reorder block。
4. checkpoint 删除缺失 block。
5. checkpoint 生成 tombstone，抑制 late create。
6. checkpoint receipt 重放幂等。
7. checkpoint fingerprint conflict。
8. draftRevision mismatch 返回 `needsReload`。
9. session mismatch/expired 返回 conflict。
10. checkpoint 后 draft map 与 blocks 完全一致。

### 5.3 端到端测试

优先场景：

1. paste 200 blocks -> delete all -> paste 150 blocks -> checkpoint -> reload，内容为 150 blocks。
2. paste 200 blocks -> partial batch success -> network fail -> checkpoint retry -> reload，内容完整。
3. create inflight -> delete all -> checkpoint -> old create ack later -> reload，无残留旧块。
4. manual save during autosync inflight -> checkpoint barrier -> commit -> reload，版本内容一致。

## 6. 分阶段实施计划

### Phase 1：设计与 DTO

- 前端定义 checkpoint request/response types。
- 后端定义 DTO 和空 controller/service skeleton。
- 不改变现有行为。

### Phase 2：后端 checkpoint 核心写入

- 实现 service 事务。
- 实现 receipt。
- 覆盖后端单元测试。

### Phase 3：前端 checkpoint 构建与 API

- 实现 `buildDraftCheckpoint()`。
- 实现 `postDraftCheckpoint()`。
- 实现 ACK mappings patch。
- 覆盖前端单元测试。

### Phase 4：保存前强制 checkpoint

- 接入 `flushAndCommitBarrier()`。
- checkpoint 成功后再 commit。
- 失败则阻止保存并提示。

### Phase 5：高风险自动 checkpoint

- 大 diff 阈值。
- 连续 batch 失败 fallback。
- sortKey corruption fallback。

### Phase 6：orderKey fractional indexing

- 实现新 orderKey 算法。
- 前后端统一。
- 兼容历史 sortKey。

## 7. 验收标准

1. 单用户编辑下，大批量全删全贴后刷新，服务端内容等于编辑器最终态。
2. 保存前即使存在 autosync inflight，也不会提交旧 draft。
3. checkpoint 请求重放具备幂等回执。
4. checkpoint 后没有旧 create 回流残留。
5. orderKey 不再依赖 6 位整数间距。
6. 当前增量同步仍可用于普通小编辑。
7. 接口保留 actor/clock/mode，为未来协作升级留出口。

## 8. 风险与缓解

### 风险 1：大文档 checkpoint payload 过大

缓解：初期只在高风险/保存前触发；后续可加压缩、分块 checkpoint 或 hash diff。

### 风险 2：checkpoint 与 inflight batch ACK 交错

缓解：checkpoint 成功后以前端最新 content + checkpoint response 为准，旧 batch ACK 只允许补 identity，不允许覆盖文本和视觉顺序。必要时 checkpoint 期间暂停 autosync。

### 风险 3：full coverage 误删

缓解：当前前端是全量 TipTap doc，才发送 `coverage: "full"`。未来局部加载必须发送 `coverage: "partial"`，后端不得按缺失即删除处理。

### 风险 4：和现有 batch 链路重复写

缓解：checkpoint 使用新的 `clientCheckpointId` receipt；成功后更新 draftRevision，旧 batch 若基于旧 draftRevision 应被拒绝或通过幂等结果消化。

## 9. 决策记录

- 当前不直接上完整 CRDT，因为项目目前是单用户编辑，完整 CRDT 会引入过高迁移成本。
- 当前不继续只打补丁，因为现有增量链路已经过度复杂，不能稳定覆盖最终态一致性。
- 采用 checkpoint 作为 authoritative final-state 通道，同时保留未来 CRDT/oplog 演进字段。

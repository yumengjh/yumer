# 同步链路稳定性重整设计

> 状态：待实现
> 日期：2026-06-04
> 前端仓库：F:\yuediter
> 后端仓库：F:\yumer-server

## 1. 背景

当前同步链路已经从“整篇保存”演进到“块级增量同步”，但现状仍然存在几个结构性问题：

1. 前端用 `dirtyOrder + entries + inflightBatchId` 表达同步状态，能覆盖普通编辑，但无法稳定表达“高频结构变更 + 批次交错 + 刷新恢复”。
2. 手动保存只是 `flushAndCommitBarrier()` 的弱屏障，`autosync` 与 `commitVersion()` 之间仍有竞态窗口。
3. 前端既有新同步引擎，又残留 legacy 保存路径与旧批量接口，协议事实源不唯一。
4. 服务端已经收紧了 `baseVersion`、`clientBatchId`、`draftRevision`、幂等回执等边界，但前端仍然按“局部补丁式状态机”工作，没有会话级提交语义。
5. 当前模型对“先大量创建、未同步完立刻全删、再继续插入”的场景不稳定，刷新后可能得到空白内容，说明本地状态、服务端草稿、批次 ack、刷新恢复之间没有统一真相源。

本次改造目标不是继续堆补丁，而是把同步链路重整为**会话内强一致优先、允许未来演进到多人协作**的协议。

---

## 2. 目标与非目标

### 2.1 目标

本次要做到：

1. 同一文档在**单活跃编辑会话**下具备强一致体验。
2. 任意时刻刷新页面，都能恢复到服务端已确认状态 + 本地未确认状态的正确组合。
3. `autosync`、`manual save`、`discard draft`、`reload after conflict` 共享同一套协议边界。
4. 删除 legacy 写入路径，收紧为单一同步主通道。
5. 为未来多人协作预留扩展位，但本次不直接实现 CRDT / OT。

### 2.2 非目标

本次不做：

1. 不实现实时多人协作。
2. 不引入 WebSocket、CRDT、OT。
3. 不追求“多标签页同时编辑同一文档仍然自动合并”。
4. 不重写 TipTap 编辑器本身。

---

## 3. 根因归纳

结合现有代码和 `analyse.txt`，问题根因可归纳为四类：

### 3.1 真相源分裂

当前至少有四个状态源：

- 编辑器当前内容
- `useDocumentSync` 的内存状态机
- 服务端草稿 / `draftRevision`
- 页面刷新后的重新加载结果

它们之间没有明确的“谁是提交边界、谁是恢复锚点、谁拥有会话写权限”。

### 3.2 批次级状态太弱

当前前端只知道：

- 哪些 entry dirty
- 哪个 batch inflight
- 哪些 revision 是 inflight 时的版本

但不知道：

- 当前会话的全局身份
- 已经发送到第几条本地操作
- 服务端已经确认到第几条本地操作
- 某次 ack 对应的是哪个会话纪元

所以遇到乱序、重试、刷新恢复时，前端只能“猜测性清理 dirty 队列”。

### 3.3 手动保存没有真正的提交屏障

当前 `flushAndCommitBarrier()` 只是在调用 commit 之前尝试 flush 一次，但：

- flush 结束后 autosync 可以继续产生新操作
- 旧批次 ack 和 commit 之间仍可能交错
- commit 之后前端并不知道服务端究竟提交到了哪个本地操作边界

### 3.4 legacy 路径继续污染协议

`document.ts` 里仍存在旧的批量保存与 legacy 内容路径。这会让：

- 同一个文档存在两套写入方式
- 旧路径绕过新同步状态机
- 未来排查 bug 时很难判断当前问题究竟来自哪个协议

---

## 4. 新的同步模型

### 4.1 总体原则

本次采用：**单活跃会话租约 + 前端操作账本 + 服务端连续确认光标**。

它不是多人协作协议，但它的字段设计会为将来扩展保留空间。

### 4.2 关键概念

#### 会话身份

前端打开文档后，获得或创建：

- `sessionId`：当前编辑会话唯一标识
- `sessionEpoch`：会话纪元，用于“接管编辑权”
- `leaseExpiresAt`：活跃租约过期时间

#### 本地操作账本

前端不再只维护一个松散 dirty 队列，而是维护按顺序递增的本地操作序列：

- `clientOpSeq`：当前会话内的递增操作编号
- 每条 `SyncEntry` 绑定一个不可回退的 `clientOpSeq`
- flush 发送的不是“随便挑一批 dirty 项”，而是“从某个 seq 开始的一段连续操作”

#### 服务端确认光标

服务端对当前活跃会话记录：

- `lastAcceptedOpSeq`
- `lastAppliedBatchId`
- `draftRevision`
- `head`
- `sessionId`
- `sessionEpoch`

服务端返回 ack 时明确告诉前端：

- 已接受到哪个 `clientOpSeq`
- 当前会话是否仍持有租约
- 是否需要 reload / reacquire session

### 4.3 真相源重组

改造后，真相源分层如下：

1. **服务端会话草稿状态**：唯一远端事实源
2. **本地快照 + 本地操作账本**：唯一前端恢复源
3. **编辑器渲染内容**：由“服务端已确认内容 + 本地未确认操作”推导得到

换句话说，编辑器内容不再直接被当作同步协议事实，而是账本投影结果。

---

## 5. 单活跃会话机制

### 5.1 当前约束

本次允许“单文档单活跃编辑会话”，但不能写死为永远单人，因为未来要上多人协作。

因此后端要增加的是**租约机制**，不是硬编码用户锁。

### 5.2 会话行为

打开编辑页时：

1. 前端调用 `acquireSyncSession(docId)`
2. 服务端返回：
   - `sessionId`
   - `sessionEpoch`
   - `leaseExpiresAt`
   - `head`
   - `draftRevision`
   - 草稿树/编辑内容
3. 若已有其他活跃会话：
   - 返回“需要接管”或“当前不可写”状态

编辑过程中：

1. flush / commit / discardDraft / reload 都必须带上 `sessionId + sessionEpoch`
2. 前端定期 `renewSyncSessionLease()`
3. 若续租失败，前端立即进入只读/需刷新状态

### 5.3 为什么这比直接用户锁更好

- 未来可以把“单会话写”放宽成“多会话读写”
- 前端协议已经有 `sessionId / epoch / ack cursor`
- 不会把同步协议和“用户身份唯一性”绑死

---

## 6. 前端状态机重构

### 6.1 现状问题

当前 `SyncReducerState` 只有：

- `entries`
- `dirtyOrder`
- `inflightBatchId`
- `inflightEntryIds`
- `baseVersion`
- `draftRevision`

这不足以表达会话边界。

### 6.2 新状态结构

新增或收紧：

- `sessionId: string | null`
- `sessionEpoch: number | null`
- `leaseExpiresAt: number | null`
- `nextClientOpSeq: number`
- `lastAckedOpSeq: number`
- `ledger: Record<number, SyncEntry>`
- `pendingOpSeqs: number[]`
- `inflightRange: { batchId: string; fromSeq: number; toSeq: number } | null`
- `syncState: "idle" | "dirty" | "flushing" | "error" | "conflicted" | "lease-lost" | "reloading"`

### 6.3 reducer 语义变化

1. `enqueueChange()` 不再只是覆盖 `entries[clientId]`
   - 仍然允许对同一 `clientId` 做压缩合并
   - 但必须保留明确的 `clientOpSeq`
2. `resolveBatchSuccess()` 不再以 `results.length === 0` 推断成功
3. `resolveBatchSuccess()` 依据服务端 `ackedThroughOpSeq` 截断账本
4. `resolveBatchFailure()` 细分：
   - 网络失败
   - lease 丢失
   - 版本冲突
   - 会话纪元失效
5. `delete + update`、`delete + move` 等冲突合并要统一归约到 delete 终态

---

## 7. 批次与 ack 协议重构

### 7.1 前端 flush 规则

flush 改为：

1. 只允许一个 `inflightRange`
2. 只发送从最小 `pendingOpSeq` 开始的一段连续操作
3. 请求中附带：
   - `sessionId`
   - `sessionEpoch`
   - `fromOpSeq`
   - `toOpSeq`
   - `baseVersion`
   - `draftRevision`
   - `clientBatchId`
4. 收到响应后，不再凭空按 `results` 数量清 dirty，而是以 `ackedThroughOpSeq` 为准

### 7.2 ack 结构

后端响应新增/收紧：

- `sessionId`
- `sessionEpoch`
- `ackedThroughOpSeq`
- `acceptedBatchId`
- `serverHead`
- `draftRevision`
- `needsReload`
- `leaseLost`
- `conflicts`
- `results`

### 7.3 空结果不再视为成功

如果 `bodyOperations.length > 0`，服务端就必须返回：

- `ackedThroughOpSeq`
- 与请求批次一致的 `acceptedBatchId`
- 至少可用于映射的确定性结果信息

前端若收到非空请求却空结果且无 ack cursor，直接判为协议错误。

---

## 8. 手动保存与提交屏障

### 8.1 新的保存流程

手动保存必须变成真正的提交边界：

1. 暂停 autosync 派发
2. 采集编辑器最新内容，生成本地操作账本尾部
3. flush 直到 `pendingOpSeqs` 清空
4. 确认服务端 `ackedThroughOpSeq >= latestLocalOpSeq`
5. 调用 `commitVersion(docId, { sessionId, sessionEpoch, ackedThroughOpSeq })`
6. commit 成功后更新 `head / draftRevision`
7. 恢复 autosync

### 8.2 必须避免的旧行为

- flush 完后让 autosync 继续并发派发
- commit 不知道提交边界是哪条本地操作
- commit 成功后只更新版本号，不更新会话确认光标

---

## 9. 刷新恢复与本地快照

### 9.1 恢复原则

刷新页面后，前端恢复分两层：

1. 从服务端拿到当前活跃会话信息和草稿内容
2. 从本地拿到上次未确认账本与快照

如果本地账本属于：

- 同 `sessionId + epoch`：可尝试重放未确认操作
- 旧 epoch：丢弃本地未确认账本，避免污染新会话
- 不同 session：提示会话已切换，使用服务端内容重建

### 9.2 解决“刷新后全空”的思路

当前“刷新后全空”通常意味着：

- 前端把某批删除视为已稳定事实
- 但后续插入并未被正确记录/回放
- 刷新时又只按服务端草稿恢复，导致新内容丢失

新的恢复模型中：

- 删除和重新插入都有连续 `clientOpSeq`
- 服务端确认光标保证“删到哪、建到哪”可追踪
- 本地仅在 ack 明确覆盖后才裁剪账本
- 刷新时若本地还有同会话未确认操作，会在服务端内容之上重放

---

## 10. 初始快照、嵌套 ack 与结构变更

### 10.1 初始快照

废弃 `shouldCreateInitialUnsyncedContent()` 的“单节点特判”模型。

新规则：

- 任何无服务端身份但存在有效编辑内容的顶层块，都应进入账本
- 不再限制 `nodes.length === 1`
- 初始内容生成规则由统一 diff/账本逻辑承担，而不是单独的特殊分支

### 10.2 ack 回填

`applyServerAck()` 不能只扫顶层节点。

需要：

- 递归遍历整棵 TipTap 文档
- 同时回填：`blockId`、`sortKey`、`clientId` 清理、`syncCreateId` 清理
- 保证嵌套结构块也能拿到服务器身份

### 10.3 大量 create/delete/recreate 场景

前端账本层必须支持：

- `create -> delete` 折叠成 tombstone 或直接消解
- `create -> delete -> create(new clientId)` 保留两段独立历史
- 同一 clientId 的 create 被删除后，后续 update/move 不得把 delete 覆盖掉

---

## 11. legacy 路径清理策略

### 11.1 前端

- `document.ts` 里旧 `batchOperations()` / `saveDocumentContent()` / `saveJsonContent()` 不再作为编辑主链路使用
- `saveDocumentContentV2()` 继续保留仅作为 legacy fallback 包装，但默认直接报错或走新同步协议
- `EditorPage.tsx` 禁止在同步引擎开启时回退到 legacy 自动保存

### 11.2 后端

- 旧的无 `baseVersion` / 无 `draftRevision` / 无 `clientBatchId` 写法彻底废弃
- 新接口强制要求 session 信息
- 旧客户端必须升级

---

## 12. 前后端接口调整

### 12.1 前端新增服务

前端需要新增/改造：

- `acquireSyncSession(docId)`
- `renewSyncSessionLease(docId, sessionId, sessionEpoch)`
- `postSyncBatch()` 增加会话字段与 opSeq 字段
- `commitVersion()` 增加会话屏障字段
- `discardDraft()` 增加会话字段

### 12.2 后端新增能力

后端需要补：

1. 会话租约实体/字段
2. 获取编辑内容时返回会话元信息
3. batch 接口校验：
   - `sessionId`
   - `sessionEpoch`
   - `fromOpSeq`
   - `toOpSeq`
4. batch 回执返回 `ackedThroughOpSeq`
5. commit / discard 校验当前会话是否仍有效

---

## 13. 测试策略

### 13.1 前端

重点补以下单测：

1. `delete + update` 不覆盖 delete
2. 非空请求 + 空结果 → 协议错误
3. 多节点初始快照会生成 create 账本
4. 顶层/嵌套 ack 都能回填 blockId
5. flush 成功后按 `ackedThroughOpSeq` 裁剪账本
6. 手动保存期间禁止 autosync 并发派发
7. `create -> delete -> recreate` 不会导致刷新后空白

### 13.2 后端

重点补以下测试：

1. 非当前会话 batch 被拒绝
2. 旧 epoch 的 batch 被拒绝
3. ack 正确返回 `ackedThroughOpSeq`
4. commit 必须在服务端已确认到目标 opSeq 后才允许成功
5. discardDraft 只能由当前会话执行

### 13.3 端到端场景

必须补至少一条回归场景：

- 大量 create
- flush 未完成
- 连续 delete 全部
- 再 create 新内容
- 等待同步完成
- 刷新页面
- 内容仍正确可恢复

---

## 14. 分阶段实施

### 第一阶段：协议收紧

- 清理前端错误语义
- 清理 legacy 路径主入口
- 补 `delete + update` / 空结果 / 初始多节点 / 嵌套 ack 等明显漏洞

### 第二阶段：会话化

- 引入 `sessionId / sessionEpoch / lease`
- 改造 batch / commit / discard
- 改造前端状态机为账本 + ack cursor 模型

### 第三阶段：刷新恢复加固

- 本地快照与账本恢复
- 会话切换与 lease 丢失处理
- 回归高频结构变更场景

---

## 15. 预期结果

本次完成后，应达到：

1. 单活跃会话下，批量插入/删除/重建不会再因 ack 交错导致刷新空白。
2. 手动保存有明确提交边界，不再把未定义批次混进 commit。
3. 前端与后端只保留一条同步主通道。
4. 当前设计虽然不支持多人协作，但已经具备未来升级到多会话协议的骨架。

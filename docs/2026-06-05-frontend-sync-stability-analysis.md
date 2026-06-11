# 前端同步链路稳定性分析

> 分析范围：F:\yuediter 前端仓库同步模块  
> 重点场景：大量内容同步过程中全部删除再插入新内容，刷新后出现问题  
> 分析日期：2026-06-05  

---

## 一、同步链路架构总览

```
编辑器内容变化
  │
  ▼
captureContentSnapshot(content)            ← snapshot.ts
  │ advanceSyncSnapshot(prev, next)
  │   ├─ deriveSyncEntries(prev, next)     ← engine.ts (diff 核心)
  │   ├─ reconcilePendingEntriesWithSnapshot
  │   └─ applyLocalSortKeys
  ▼
enqueueChange(state, entry) × N            ← reducer.ts (状态机)
  │ 合并规则：create+update→merge, create+delete→cancel, ...
  ▼
flush()                                    ← useDocumentSync.ts (编排)
  │ rebasePendingCreatesToSnapshotOrder
  │ selectSyncBatchOperations               ← batching.ts (批次裁剪)
  │ markBatchInflight
  │ postSyncBatch                           ← api.ts (HTTP)
  │ resolveBatchSuccess / resolveBatchFailure
  │ captureContentSnapshot(latestContent)
  │ collectOrphanedCreateDeletes
  │ applyServerAck → onContentPatched
  ▼
编辑器 attrs 补丁                           ← editorIdentity.ts
```

### 核心数据流

| 阶段 | 输入 | 输出 | 关键文件 |
|------|------|------|----------|
| Diff | prevSnapshot, nextDoc | SyncEntry[] | engine.ts |
| Enqueue | entries × N | SyncReducerState | reducer.ts |
| Select | dirtyOrder, entries | SyncEntry[] (≤500) | batching.ts |
| Dispatch | entries | BatchOperationBody[] | api.ts |
| Resolve | results | state patch | reducer.ts |
| ACK Patch | mappings | TiptapDoc | engine.ts |

---

## 二、目标场景分析：全选删除再粘贴

用户描述的核心场景：

> "复制一大段内容在同步的过程中然后马上全部删除再插入新的内容"

### 2.1 时序分解

```
T0: 用户粘贴 200 段内容
    → 200 个 create entry 入队

T1: flush #1 开始
    → 选取 100 create（批次限制）
    → markBatchInflight → POST /blocks/batch

T2: 用户 Ctrl+A → Delete → 粘贴 150 段新内容
    → snapshot 变化：200 create(旧)消失，150 create(新)出现
    → reconcilePendingEntriesWithSnapshot:
        200 个 inflight create 的 clientId 不在新快照 → 补发 200 个 delete
    → 但其中 100 个正在 inflight！

T3: flush #1 响应到达
    → resolveBatchSuccess: 100 create 成功 → 返回 blockId
    → captureContentSnapshot(latestContent): 此时快照是 150 个新块
    → collectOrphanedCreateDeletes: 100 个刚创建的 blockId 不在当前快照
        → 补发 100 个 delete

T4: flush #2 开始
    → 队列中有：~200 delete + 150 create
    → 批次限制：500 delete + 100 create
    → 实际选取：200 delete + 100 create

T5: flush #3（如果还有剩余）
    → 50 个剩余 create
```

### 2.2 关键风险点

#### 风险 1：delete 的 syncCreateId 匹配时序窗口 [严重度: 高]

**位置**: `reducer.ts` L97-116, `reconcilePendingEntriesWithSnapshot` L62-84

当 inflight create 的 clientId 不在新快照中时，`reconcilePendingEntriesWithSnapshot` 会为其补发 delete entry。但此时的处理逻辑：

```typescript
// reducer.ts L97-105 — inflight create + incoming delete
if (current?.opType === "create" && incoming.opType === "delete") {
    if (state.inflightEntryIds.includes(incoming.clientId)) {
      return upsertEntry(state, {
        clientId: incoming.clientId,
        blockId: incoming.blockId ?? current.blockId,  // ← 此时 blockId 为 null
        opType: "delete",
        syncCreateId: current.syncCreateId,
      });
    }
```

**问题**：create 还在 inflight（尚无 blockId），delete entry 的 blockId 为 null。后端需要通过 `syncCreateId` 匹配。但如果 create ACK 和 delete 请求交错：

1. create ACK 返回 blockId → `resolveBatchSuccess` 把 entry 转为 update（因为 revision 已变）
2. 下一个 flush 发送 delete，此时 delete 的 blockId 来自 `withServerBlockId` 回填

这个流程 **本身是正确的**，但依赖 `resolveBatchSuccess` 中 revision 比较的精确性。如果 `inflightEntryRevisions` 中的 revision 因为多次 enqueueChange 已被覆盖，就会出问题。

**实际场景**：`reconcilePendingEntriesWithSnapshot` 在 `advanceSyncSnapshot` 内被调用，而 `advanceSyncSnapshot` 在 `captureContentSnapshot` 中执行。但 `captureContentSnapshot` 在 flush 循环的 L601 被调用时，用的是 `latestContentRef.current`——这是用户操作后的最新内容。此时 state 中的 entries 可能已经被 `markBatchInflight` 锁定了 inflightEntryIds，但 `reconcilePendingEntriesWithSnapshot` 调用的是 `enqueueChange`，它检查的是 `state.inflightEntryIds`——这已经是当前 flush 的 inflight IDs。

**关键时序问题**：
- `markBatchInflight` 设置了 `inflightEntryIds`
- 用户编辑触发 `captureContentSnapshot` → `advanceSyncSnapshot` → `reconcilePendingEntriesWithSnapshot`
- 此时 `stateRef.current` 的 `inflightEntryIds` 包含正在 flush 的 entries
- `reconcilePendingEntriesWithSnapshot` 为这些 inflight create 补发 delete → 走 L97-105 分支
- flush 响应到达 → `resolveBatchSuccess` → revision 不匹配（因为 delete 的 revision 更高）→ entry 保留为 delete
- 下一轮 flush 发送 delete → 正确

**但有一个边界问题**：如果 `reconcilePendingEntriesWithSnapshot` 补发的 delete 的 `syncCreateId` 来自 `current.syncCreateId`，而 `current` 是 `create` 类型的 entry，那 `syncCreateId = "sync-create:{clientId}"`。但如果原始 entry 的 `syncCreateId` 在 `normalizeCreatePayload` 中被设置过，后来又在 `withCreateIdentity` 中被 delete 掉（L238-240），这个 delete entry 的 `syncCreateId` 可能丢失。

#### 风险 2：大批次拆分的 sortKey 退化 [严重度: 高]

**位置**: `order.ts` L34-62, `engine.ts` L247-295

当粘贴 200 段内容时，`allocateCreateSortKeys` 为 200 个新块分配 sortKey。如果插入位置在两个已有块之间（gap 可能是 1000），`createSortKeysBetween` 的分配逻辑：

```typescript
// order.ts L56-61
if (gap > count) {
    const step = Math.max(1, Math.floor(gap / (count + 1)));
    // gap=1000, count=200 → step=4 → 可行
} else {
    // gap=1000, count=2000 → 每个分 1 → 刚好用完
    return Array.from({ length: count }, (_, index) => formatSortKey(left + index + 1));
}
```

**问题 1**：当 `gap ≤ count` 时，每个块分配 1 的间距。如果后续再插入块，间距为 0，`formatSortKey(left + 0 + 1)` 会产生相同值。

**问题 2**：sortKey 格式化为 6 位 pad（`padStart(6, "0")`），但数值上没有上限保护。当 sortKey 超过 999999 时，字符串长度变为 7 位，可能影响后端排序。

**问题 3**：`rebasePendingCreatesToSnapshotOrder` 在每次 flush 时重新分配 sortKey。如果快照已经变化（用户删除了所有内容），rebase 会基于空快照重新分配。但如果部分 create 已经 inflight 且 ACK 还没返回，rebase 不会修改 inflight entries 的 sortKey（因为它们不在 `entries` 中作为 create 了），导致 inflight 和非 inflight 的 sortKey 不一致。

#### 风险 3：批次拆分导致的操作乱序 [严重度: 高]

**位置**: `batching.ts` L32-69, `useDocumentSync.ts` L434-701

`selectSyncBatchOperations` 按 `dirtyOrder`（FIFO）选取操作。在全删全插场景中：

```
dirtyOrder: [delete_1, delete_2, ..., delete_200, create_1, create_2, ..., create_150]
批次限制: total=500, create=100, delete=500

Batch 1: 200 delete + 100 create  (total=300)
Batch 2: 50 create                (total=50)
```

**问题**：Batch 1 中同时有 delete 和 create。后端事务内串行执行，如果某个 delete 失败（比如 tombstone 冲突），整个 batch 的 `draftRevision` 仍然推进（后端已知问题），导致 Batch 2 的 `draftRevision` 不匹配。

但更严重的是 **delete 和 create 的执行顺序**：后端 `batch()` 方法按 operations 数组顺序串行执行。如果 200 个 delete 在 100 个 create 之前执行，中间状态是一个空文档。如果此时另一个客户端在查看，会看到文档短暂变空。

**对刷新后问题的影响**：如果 Batch 1 成功但 Batch 2 失败（网络中断、lease 过期），50 个 create 丢失。刷新后文档只有 100 个新块 + 旧块被删除 → 内容不完整。

#### 风险 4：captureContentSnapshot 的双重调用 [严重度: 中]

**位置**: `useDocumentSync.ts` L601, L670

flush 循环中的关键序列：

```typescript
// L588-601: resolve + capture
updateSyncState((prev) => prev ? resolveBatchSuccess(prev, ...) : prev);
captureContentSnapshot(latestContentRef.current);   // ← capture #1

// L657-679: ACK patch + onContentPatched
if (currentSnapshot && serverAckMappings.length > 0) {
    const patched = applyServerAck(currentSnapshot, serverAckMappings);
    snapshotRef.current = patched;                    // ← 直接修改 snapshotRef
    if (onContentPatched && patched !== currentSnapshot) {
        const applied = onContentPatched(patched);
        if (applied && applied.type === "doc") {
            captureContentSnapshot(applied);           // ← capture #2
        }
    }
}
```

**问题**：
1. Capture #1 用 `latestContentRef.current`（编辑器当前内容）做 diff，生成新的 entries
2. 然后 `snapshotRef.current` 被 ACK patch 修改为 `patched`（基于 capture #1 之前的快照）
3. Capture #2 用 `applied`（编辑器应用 ACK 后的内容）做 diff，但 `snapshotRef.current` 已经是 `patched`

在正常流程中，这不会产生问题，因为 capture #1 已经处理了用户编辑的增量，capture #2 只处理 ACK 补丁。但在边缘场景中：

- 用户在 flush 期间编辑了内容 → capture #1 产生了 entries
- ACK patch 修改了 snapshot → 但 snapshot 是 capture #1 之前的值（因为 capture #1 更新了 snapshotRef）
- `applyServerAck` 作用在 capture #1 输出的 snapshot 上

**等等，让我重新追踪**：

```
L245: advanced = advanceSyncSnapshot(current, prevSnapshot, nextContent)
L250: snapshotRef.current = advanced.snapshot  // capture #1 更新了 snapshotRef

L601: captureContentSnapshot(latestContentRef.current)
      // 这里 prevSnapshot = snapshotRef.current（capture #1 的结果）
      // nextContent = latestContentRef.current

L630: const currentSnapshot = snapshotRef.current;  // ← 这是 capture #1 的输出
L658: const patched = applyServerAck(currentSnapshot, serverAckMappings);
L665: snapshotRef.current = patched;  // ← 直接更新为 patched
L670: captureContentSnapshot(applied);  // ← capture #2
      // prevSnapshot = patched (ACK patched snapshot)
      // nextContent = applied (editor after ACK callback)
```

**问题**：capture #1 和 L630 之间，`snapshotRef.current` 没有变化（都是 capture #1 的输出）。然后 L658 对它做 ACK patch，L665 更新。capture #2 是基于 patched snapshot 做的。

这个流程 **在语义上正确**，但有一个微妙问题：capture #1 可能已经为用户的新内容生成了 create entries，而这些 create 的 clientId 和 ACK 返回的 clientId 相同（如果 ACK 是针对之前的 create）。`resolveBatchSuccess` 已经处理了这些 ACK，但 capture #1 不知道 ACK 的结果，可能为同一个 clientId 生成重复的 create entry。

**实际影响**：`reconcilePendingEntriesWithSnapshot` 会清理不在快照中的 entries，但不会阻止为已有 entry 的 clientId 生成新 create（因为 `deriveSyncEntries` 只看快照，不看 reducer state）。

#### 风险 5：reconcilePendingEntriesWithSnapshot 误删 [严重度: 中]

**位置**: `snapshot.ts` L62-84

```typescript
for (const entry of Object.values(state.entries)) {
    if (entry.opType === "delete") continue;
    const hasLiveClient = liveKeys.has(entry.clientId);
    const hasLiveBlock = entry.blockId ? liveKeys.has(entry.blockId) : false;
    if (hasLiveClient || hasLiveBlock) continue;
    // → 补发 delete
}
```

**问题**：如果 entry 是 `create`（无 blockId），且 clientId 不在当前快照中（用户删除了这个块），则补发 delete。但如果这个 create 还在 inflight，delete 走 L97-105 分支。

**更严重的问题**：如果 create ACK 刚刚返回，`resolveBatchSuccess` 把 entry 转为 `update`（因为 revision 已变），此时 entry 有 blockId 但 opType 是 "update"。如果用户在 ACK 到达前删除了这个块，`reconcilePendingEntriesWithSnapshot` 发现 entry.blockId 不在快照中 → 补发 delete。这是 **正确的**。

但如果 `resolveBatchSuccess` 还没来得及执行（因为 flush 的 await 还在等响应），而用户已经编辑了内容触发了 `captureContentSnapshot`——**这是可能的**，因为 React 的 useEffect 可以在 await 期间执行。

等等，JavaScript 是单线程的。`captureContentSnapshot` 在 `useEffect` 中被调用，而 `useEffect` 在微任务队列中执行。flush 的 `await` 会让出控制权，允许 React 处理 effects。所以 **确实可能出现**：

1. flush 发出 POST 请求（await 中）
2. React 处理 content 变化 → useEffect → `captureContentSnapshot`
3. `advanceSyncSnapshot` → `reconcilePendingEntriesWithSnapshot`
4. 此时 state 是 `flushing`，inflightEntryIds 包含正在等待 ACK 的 entries
5. 这些 entries 的 clientId 如果不在新快照中 → 补发 delete
6. flush 响应到达 → `resolveBatchSuccess` → entry 的 revision 已变 → 保留 entry
7. 下一轮 flush 发送 delete

这个流程 **本身是正确的**，但步骤 2-5 发生在 flush await 期间，意味着 state 的修改是通过 `updateSyncState` 异步的。如果 `captureContentSnapshot` 中的 `replaceSyncState` 和 flush 中的 `updateSyncState` 交错执行，可能导致 state 丢失。

**实际上不会**，因为 `replaceSyncState` 和 `updateSyncState` 都是同步的 `setState` 调用（在 React 18 中可能被批处理，但 `stateRef.current` 的更新是同步的）。所以不会有竞态。

#### 风险 6：identity.ts 重复 blockId 清洗 [严重度: 中]

**位置**: `identity.ts` L96-107

```typescript
if (blockId) {
    if (seenBlockIds.has(blockId)) {
        // 重复 blockId → 删除，视为新建块
        delete attrs.blockId;
        delete attrs["data-block-id"];
    }
}
```

**场景**：ACK 返回后 `applyServerAck` 为 create 块设置了 blockId。但如果编辑器中有两个块意外获得了相同的 blockId（比如 Tiptap 的 undo/redo 恢复了旧的 attrs），`ensureDocumentIdentity` 会把第二个块的 blockId 删除，使其变成"新建"块。

**后果**：这会导致一个已有 blockId 的块被重新 create，后端会因为 `syncCreateId` 幂等性返回已存在的块（如果 tombstone 还在），或者创建一个重复块。

#### 风险 7：editorIdentity 的 hasMatchingDocumentContent 过于严格 [严重度: 低]

**位置**: `editorIdentity.ts` L134-160

`patchEditorBlockIdentityFromMatchingDoc` 先调用 `hasMatchingDocumentContent` 做严格匹配（节点数、类型、内容指纹）。如果用户在 ACK 到达期间继续编辑，严格匹配失败，回退到 `patchEditorBlockIdentityByClientIdFromDoc`。

回退路径只按 clientId 匹配更新 blockId 和 sortKey，**不检查内容是否一致**。如果用户在 ACK 到达前修改了某个块的内容，回退路径仍然会把 ACK 的 blockId 写到这个块上——这是正确的行为，因为块身份不依赖内容。

---

## 三、残余问题清单

### P0 — 直接导致刷新后数据不一致

| # | 问题 | 文件位置 | 影响 |
|---|------|----------|------|
| 1 | **批次拆分 + 网络中断 = 数据丢失** | batching.ts + useDocumentSync.ts | 200 delete + 100 create 成功，50 create 丢失。刷新后少 50 段内容 |
| 2 | **inflight create 的 sortKey 与 rebase 后 sortKey 不一致** | useDocumentSync.ts L135-204 | ACK 返回的 sortKey 是旧的，rebase 分配了新的，但 inflight 的不能改 |
| 3 | **createSortKeysBetween 数值溢出** | order.ts L16-18 | sortKey 超过 999999 后 pad 失效，排序不稳定 |

### P1 — 间接导致边缘场景异常

| # | 问题 | 文件位置 | 影响 |
|---|------|----------|------|
| 4 | **resolveBatchSuccess 中 create ACK 回填后的 entry 类型混乱** | reducer.ts L351-357 | create ACK 后 entry 变成 update，但 payload 可能已经过时 |
| 5 | **captureContentSnapshot 在 flush await 期间被 React effect 触发** | useDocumentSync.ts L302 + L601 | 时序依赖 JavaScript 单线程保证，逻辑正确但脆弱 |
| 6 | **reconcilePendingEntriesWithSnapshot 对 inflight create 的 delete 补发** | snapshot.ts L62-84 | 依赖 reducer 的 inflight 检测正确性，任何 state 管理 bug 都会导致泄漏 |
| 7 | **update entry 附带 sortKey 时额外生成 move 操作** | api.ts L152-159 | 一个 update entry 变成两个后端操作（update + move），增加 batch 体积 |

### P2 — 体验问题和长期退化

| # | 问题 | 文件位置 | 影响 |
|---|------|----------|------|
| 8 | **sortKey 重复不检测** | engine.ts L370-377 | corruption 只检测和抑制 move，不修复 create 的 sortKey 冲突 |
| 9 | **batching 限制不考虑操作依赖** | batching.ts L54-66 | 可能把 create 和其关联的 move 分到不同批次 |
| 10 | **dirtyOrder 是简单 FIFO** | reducer.ts L170-172 | 不考虑操作之间的因果关系 |

---

## 四、重点问题深度分析

### 4.1 问题 #1：批次拆分导致的数据丢失（P0）

**完整场景还原**：

```
用户粘贴 200 段 → 全选删除 → 粘贴 150 段新内容

T1: flush #1
    队列: 200 delete(旧) + 150 create(新)
    选取: 200 delete + 100 create (total=300, create cap=100)
    POST /blocks/batch → 成功

T2: flush #2
    队列: 50 create(新)
    选取: 50 create
    POST /blocks/batch → 网络超时 → resolveBatchFailure

T3: 用户刷新页面
    → 服务端有: 旧块全删 + 100 个新块
    → 丢失: 50 个新块
```

**根本原因**：flush 循环在 `resolveBatchFailure` 后 `return`（L699-701），不再尝试发送剩余的 50 个 create。

```typescript
// useDocumentSync.ts L693-701
} catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    updateSyncState((prev) =>
      prev ? resolveBatchFailure(prev, clientBatchId, message, false) : prev,
    );
    return;  // ← 直接退出 flush 循环
}
```

**修复方向**：
- **方案 A**：flush 失败后不立即 return，而是短暂退避后重试（最多 N 次）
- **方案 B**：flush 失败后标记 error 状态，但保留 entries 在队列中。用户手动触发或自动 retry 时继续
- **方案 C**：把 create 和 delete 拆成独立的 batch，保证 create 优先发送

### 4.2 问题 #2：inflight create 的 sortKey 不一致（P0）

**完整场景还原**：

```
T0: 编辑器中有块 A(sortKey=001000) 和块 B(sortKey=002000)
T1: 用户在 A 和 B 之间粘贴 50 段
    → allocateCreateSortKeys: 在 001000 和 002000 之间分配 50 个 sortKey
    → step = (2000-1000)/51 ≈ 19
    → sortKeys: 001019, 001038, ..., 001961

T2: flush #1 开始
    → 选取 50 create → markBatchInflight → POST

T3: 用户把块 A 移到了块 B 后面
    → 快照变化 → captureContentSnapshot
    → A 的 sortKey 变为 003000, B 的 sortKey 保持 002000

T4: flush #1 响应到达
    → resolveBatchSuccess: create ACK 返回 sortKey = 001019...001961
    → rebasePendingCreatesToSnapshotOrder: 不会修改 inflight entries（已不在 entries 中）
    → applyServerAck: 编辑器中的块获得 ACK 的 sortKey = 001019...

T5: 此时编辑器中的 sortKey 顺序:
    B(002000), create_1(001019), create_2(001038), ..., create_50(001961), A(003000)
    → 但视觉顺序应该是: B, creates..., A → sortKey 应该是 002001-002050
```

**根本原因**：`rebasePendingCreatesToSnapshotOrder` 只 rebase 还在 entries 中的 create，不修改已经 inflight 且 ACK 已返回的块。ACK 返回的 sortKey 是基于发送时的快照分配的，但用户已经在 flush 期间改变了文档结构。

**修复方向**：
- ACK 返回后，如果 ACK 的 sortKey 和当前快照中的视觉位置不一致，补发 move 操作
- 或者在 `applyServerAck` 后重新做 `captureContentSnapshot`，让 deriveSyncEntries 检测到 sortKey 不一致并生成 move entries

### 4.3 问题 #4：create ACK 后 entry 类型混乱（P1）

**位置**: `reducer.ts` L341-358

```typescript
const inflightRevision = state.inflightEntryRevisions[clientId];
if (currentEntry.revision === inflightRevision) {
    delete nextEntries[clientId];  // entry 未变 → 清除
    continue;
}
// entry 已变（用户继续编辑了）
if (result.operation === "create" && result.blockId) {
    nextEntries[clientId] = withServerBlockId(currentEntry, result.blockId, result.sortKey);
    continue;
}
```

`withServerBlockId` 把 entry 的 opType 改为 "update"（L262），并带上 ACK 的 blockId。但 `currentEntry` 可能是用户在 inflight 期间修改的最新版本——它可能是一个 **update**（原始 create 被 merge 后的结果），payload 已经是最新内容。

**问题**：如果用户在 create inflight 期间修改了块内容，enqueueChange 把 create+update merge 为 create（L88-95），payload 更新为新内容。ACK 返回后，`withServerBlockId` 把这个 merge 后的 create 转为 update，payload 是最新内容。下一轮 flush 发送 update + 最新 payload → **正确**。

但如果用户在 create inflight 期间 **删除** 了块再 **重新创建** 同 clientId 的块（理论上不太可能，因为 clientId 是唯一的），entry 可能变成一个 delete。`withServerBlockId` 对 delete 只设置 blockId（L251-256），不改变 opType。下一轮 flush 发送 delete → **正确**。

所以这个问题实际上 **不会出现**，但代码的可读性和可维护性较差，容易在后续修改中引入 bug。

---

## 五、sortKey 系统的数值退化分析

### 5.1 sortKey 空间耗尽

`createSortKeysBetween` 的分配策略是二分法：

```
初始: null, null → 1000, 2000, 3000, ...
插入: 1000 和 2000 之间 → 1500
再插: 1000 和 1500 之间 → 1250
再插: 1000 和 1250 之间 → 1125
...
极限: 间距为 1 时 → formatSortKey(left + 1) → 碰撞！
```

当两个相邻 sortKey 的间距为 1 时，`createSortKeyBetween` 返回 `formatSortKey(left + 1)`，等于 `right`。这意味着新块和右边块的 sortKey 相同。

**后端处理**：`reserveUniqueSortKey` 会在 sortKey 冲突时自动偏移，但偏移后的值可能又和下一个块冲突，形成级联。

### 5.2 pad 溢出

`formatSortKey` 使用 `padStart(6, "0")`。sortKey 的数值范围是 0-999999。在大量操作后，尾部的 sortKey 可能超过 999999：

```typescript
// order.ts L26
if (previousValue != null && nextValue == null) return formatSortKey(previousValue + 1000);
```

如果 `previousValue = 999000`，下一个 sortKey = 1000000，格式化为 "1000000"（7 位）。字符串排序 "1000000" < "999999"（字典序），导致排序错误。

### 5.3 corruption 检测后无自动修复

`analyzeSortKeyIntegrity` 检测到重复和非单调后，只设置 `hasCorruptedSortKeys` 标志。`deriveSyncEntries` 在 corruption 时抑制 move 操作，但不触发 sortKey 重新分配。这意味着一旦 sortKey 退化，只能靠 manifest reconcile 或手动刷新来修复。

---

## 六、与后端交互的协议脆弱性

### 6.1 draftRevision 不匹配后的恢复

后端 batch() 方法要求 `draftRevision` 精确匹配。如果前端 flush #1 成功（draftRevision 推进），但 flush #2 因为 draftRevision 不匹配失败，前端的 `resolveBatchFailure` 设置 error 状态。

**当前恢复路径**：
- 用户手动刷新 → 重新加载文档
- 或者 manifest reconcile 更新 draftRevision → 但 reconcile 只在 idle 状态执行

**问题**：error 状态阻断了自动 flush（`flush` 函数在 `dirtyOrder.length === 0` 时才 reconcile，但 error 状态下 dirtyOrder 不为空）。用户只能手动刷新。

### 6.2 syncSession 过期后的队列保留

Session 5 分钟 lease，前端每 2 分钟续约。如果续约失败（L321-327），标记 `lease-lost`。但队列中的 entries 被保留——如果用户重新获取 session，队列可以继续 flush。

**问题**：新 session 的 `sessionEpoch` 不同，后端的 SyncCreateTombstone 可能已经过期（30 分钟 TTL），导致 late create 回流。

---

## 七、优化建议

### 短期（1-2 周）

1. **flush 失败自动重试**：网络错误后指数退避重试 3 次，避免批次拆分导致的数据丢失
2. **sortKey 空间监控**：当 gap ≤ 2 时触发 sortKey 重分配（不只是抑制 move）
3. **pad 溢出保护**：sortKey 超过 999000 时触发整体重分配

### 中期（1 个月）

4. **原子批次保证**：delete 和 create 混合批次中，如果 delete 全部成功但 create 部分失败，前端自动重试失败的 create
5. **ACK 后 sortKey 校正**：applyServerAck 后比较 ACK sortKey 与当前视觉位置，不一致时生成 move entry
6. **reducer 状态机简化**：把 inflight create → ACK → update 的隐式转换改为显式状态

### 长期（2-3 个月）

7. **CRDT 融合**：在同步协议层引入 sortKey 的 fractional indexing（如 Yjs 的 relative position），避免整数间距耗尽
8. **操作依赖图**：batching 选择时考虑操作之间的因果关系，确保 create 和其关联操作在同一批次
9. **端到端验证**：flush 完成后做一次 manifest 校验，确认服务端状态与前端快照一致

---

## 八、测试建议

### 需要自动化覆盖的边缘场景

| 场景 | 预期结果 | 当前状态 |
|------|----------|----------|
| 粘贴 200 段 → 全选删除 → 粘贴 150 段 → 等待同步完成 → 刷新 | 150 段新内容完整 | 不稳定 |
| 粘贴 50 段 → 同步中删除前 25 段 → 等待同步 → 刷新 | 后 25 段保留 | 基本稳定 |
| 粘贴 200 段 → 同步中全选删除 → 不粘贴 → 等待同步 → 刷新 | 文档为空 | 待验证 |
| 粘贴 50 段 → 同步中反复修改同一段 10 次 → 等待同步 → 刷新 | 最后一次修改的内容 | 基本稳定 |
| 弱网(3G)粘贴 100 段 → 同步中切换网络 → 刷新 | 100 段完整 | 近期已修复 |
| 粘贴 200 段 → 同步中关闭标签页 → 重新打开 | 200 段完整（服务端已持久化） | 待验证 |

### 手动验证步骤

1. 打开 Sync Trace Log（localStorage `sync-debug-log-enabled=true`）
2. 执行目标场景
3. 导出 AI Debug Bundle
4. 检查 trace 中的 `flush:dispatch` 和 `flush:response` 是否覆盖所有操作
5. 检查 `orphaned-create:delete-enqueued` 是否误触发
6. 检查 `ack:patch` 后的 manifest 是否与预期一致

---

## 九、结论

前端同步链路的整体设计是合理的——reducer 状态机、snapshot diff、orphan detection、manifest reconcile 构成了多层防护。但在 **大批量操作 + 快速编辑交替** 的边缘场景下，存在以下核心不稳定因素：

1. **批次拆分 + 网络中断 = 数据丢失**（最严重，直接导致刷新后内容缺失）
2. **sortKey 分配在大规模插入时退化**（导致排序混乱，间接影响后续操作）
3. **inflight ACK 的 sortKey 与 rebase 后的视觉位置不一致**（导致块顺序错误）

这些问题在 80% 的场景中不会触发（因为网络良好、操作量小、用户不会在同步中大幅修改），但在剩余 20% 的边缘场景中会导致可观察到的数据不一致。建议按优先级逐步修复上述 P0 问题。

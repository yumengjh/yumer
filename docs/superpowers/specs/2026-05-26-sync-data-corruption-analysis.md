# 协作文档同步数据错乱问题分析

**日期：** 2026-05-26  
**前端：** `E:\workspace\editor-demo\app`  
**后端：** `E:\workspace\yuweb\back\server`  
**范围：** 文档块同步、草稿同步、手动保存、保存后内容回填  
**不在本次范围内：** S3 不可用回退本地存储，后端图片存储策略已由人工处理

---

## 1. 问题摘要

当前编辑器在已经保存过的文档中间插入复杂块组合后，保存或草稿同步可能导致文档结构错乱。常见表现是本次新增的最后几段内容被移动到后续已有标题下面，或者撤回后再次同步时同一批输入被重复写入，例如 `123` 变成 `112233`。

问题集中在“本次新增或修改的块”，尤其是从 todo/list 结构断开后新增的 taskList、highlightBlock、paragraph 等组合块。现象不是随机渲染问题，而是前后端同步协议没有稳定表达“当前 UI 的完整块顺序”和“同一批 create 的幂等身份”。

---

## 2. 关键结论

### 2.1 首要根因：新增块 sortKey 与已有块碰撞

前端在 `src/services/sync/engine.ts` 中用顶层数组位置生成新块排序键：

```ts
function createSortKey(index: number): string {
  return String((index + 1) * 1000).padStart(6, "0");
}
```

当已有文档为：

```text
A sortKey=001000
B sortKey=002000
C sortKey=003000
```

用户在 A 与 B 中间插入新块 X 时，前端会把 X 的 index 识别为 1，于是生成：

```text
X sortKey=002000
```

此时 X 与原本的 B 产生相同 sortKey。后端读取文档树时按 sortKey 排序，sortKey 相同再按 blockId 或数据库结果顺序兜底，最终 UI 顺序不再由用户看到的编辑器顺序决定。

这解释了为什么“新增的最后几段文字被移动到后面已有二级标题下方”：保存后服务端重建出的块顺序已经和保存时 editor 的顺序不同，随后前端又把服务端内容重新加载进编辑器。

### 2.2 第二根因：diff 只检测 payload，不检测已有块顺序变化

`deriveSyncEntries(prevDoc, nextDoc)` 只比较：

- 新增顶层块：create
- 已有顶层块 payload 变化：update
- 消失顶层块：delete

它没有检测“已有块在数组中的相对位置改变”，也不会生成 move/reorder 操作。

因此，中间插入后，后续已有块虽然在 UI 上被后移，但同步 payload 不会告诉后端“B、C 的顺序也变了”。后端只能保留 B、C 原有 sortKey，再插入 X 的 sortKey，最终产生顺序冲突。

### 2.3 第三根因：客户端 create 缺少幂等保护

前端每次 flush 生成 `clientBatchId` 并传给 `/blocks/batch`，但后端目前只是返回 acceptedBatchId，没有持久化批次，也没有基于 `clientBatchId + clientId` 做 create 去重。

如果出现以下情况，同一批 create 可能重复落库：

- 请求实际成功但响应丢失
- 前端因为冲突或状态未清理而重试
- 旧请求返回时状态已经推进
- create ack 没有正确回填 blockId，后续仍被当作新块

这与“撤回后再次草稿同步，再保存时出现重复写入”一致。

### 2.4 第四根因：手动保存后直接 reload 覆盖当前 UI

`src/components/EditorPage.tsx` 中手动保存成功后会执行：

```ts
const loaded = await loadContent(currentDoc.docId);
setContent(loaded.content || DEFAULT_CONTENT);
```

这个 reload 没有比较：

- 保存发起时 editor hash
- 请求返回时当前 editor hash
- 服务端返回 content hash
- 当前同步 requestId / revision

如果用户在保存过程中继续编辑，或者旧响应晚到，服务端旧内容可能直接覆盖当前 UI。即使 `setContent(..., { emitUpdate: false })` 避免了 onUpdate 回声，也不能避免旧远端内容覆盖新本地内容。

### 2.5 第五根因：加载链路全局 flatten 后按 sortKey 排序，会丢失树结构边界

`src/services/document.ts` 中 `flattenBlockTree(root)` 先 DFS 展平 block tree，随后执行：

```ts
result.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
```

这会把不同 parent 下的块放到同一个全局排序空间中。只要后端树里出现非 root 子块，前端重组 TipTap JSON 时就可能破坏原本 parent/children 的局部顺序。

当前同步引擎主要把 TipTap 顶层块作为后端 root 子块存储，因此这个问题不一定是当前复现的第一触发点，但它是保存后 reload 过程中放大错乱的高风险点。

---

## 3. 为什么 todo/list 断开后更容易复现

TipTap 的 taskList 是顶层节点，taskItem 是 taskList 的内部内容。当前同步引擎只索引顶层 block：

```ts
function indexTopLevel(doc: TiptapDoc): Record<string, IndexedNode>
```

当用户在已有 todo 列表中断开连续结构并插入 paragraph、highlightBlock 或新的 todo 时，编辑器可能产生以下变化：

1. 原 taskList payload 更新
2. 新 taskList 或 paragraph 创建
3. 后续已有块在 UI 中后移
4. 某些 list 内部节点 clientId/blockId 重新分配或被剥离

当前同步模型只能表达第 1、2 点，不能可靠表达第 3 点。新块 sortKey 又刚好按新的 index 生成，从而撞上后续已有块的旧 sortKey。

---

## 4. 现有链路证据

### 4.1 前端同步入口

- `src/components/EditorPage.tsx`
  - `useDocumentSync({ content })` 接收当前 TipTap JSON
  - 自动同步调用 `sync.flush("autosync")`
  - 手动保存调用 `sync.flushAndCommitBarrier(...)`
  - 保存后再次 `loadContent` 并 `setContent`

### 4.2 前端 diff

- `src/services/sync/snapshot.ts`
  - `advanceSyncSnapshot` 将当前 content 标准化后交给 diff
- `src/services/sync/engine.ts`
  - `indexTopLevel` 只索引顶层节点
  - `deriveSyncEntries` 只生成 create/update/delete
  - `createSortKey(index)` 用数组 index 直接生成 sortKey
  - `applyCreateAck` 只回填 create ack 的 blockId

### 4.3 前端 API payload

- `src/services/sync/api.ts`
  - create 操作固定发送 `parentId: input.rootBlockId`
  - create 操作发送 `sortKey: entry.sortKey`
  - update 操作不发送 sortKey 或 parentId
  - 当前没有 move/reorder 的前端同步输出

### 4.4 后端批量写入

- `back/server/src/modules/blocks/blocks.service.ts`
  - `batch` 使用事务处理 operations
  - `handleBatchCreate` 直接保存前端传入的 sortKey
  - `handleBatchUpdate` 保留 latestVersion 的 parentId/sortKey
  - `clientBatchId` 未持久化，不能防重复 create

### 4.5 后端文档重建

- `back/server/src/modules/documents/documents.service.ts`
  - 文档树按 parentId 找 children
  - siblings 按 sortKey 排序
  - sortKey 相同会导致顺序依赖兜底逻辑

---

## 5. 风险分级

### P0：会导致用户数据错位或重复

- 新块 sortKey 与已有块碰撞
- 已有块 reorder 未同步
- create 请求无幂等
- 保存后旧远端内容直接覆盖当前 UI

### P1：会放大错乱或增加排障难度

- flattenBlockTree 全局排序破坏树结构边界
- 缺少 editor/payload/server/current hash 日志
- sync ack 与 remote content 没有强边界

### P2：体验或架构债

- 状态文案里 saved/draft-synced/loaded 语义混杂
- legacy HTML 路径仍存在但不是本次主要问题

---

## 6. 修复原则

1. 保存时服务端结构必须等价于保存发起时用户看到的 editor 结构。
2. 新增块不能与已有块复用同一 sortKey。
3. 只要 UI 中已有块顺序发生变化，就必须同步 move/reorder。
4. create ack 只能补身份，不能被当成远端内容再次 apply。
5. 服务端 ack 不能直接覆盖当前 UI，除非 hash 证明当前 UI 没有继续变化。
6. 同一文档的 flush/commit 必须串行化，旧响应不能覆盖新状态。
7. create 操作必须具备幂等语义，至少基于 `docId + clientBatchId + clientId` 防重复。
8. 修复必须先有可复现的失败测试，再改实现。

---

## 7. 验收标准

### 正确性

- 在已有块中间插入 paragraph 后保存，刷新后顺序与保存前一致。
- 在已有 todo 列表中断开并插入 taskList、highlightBlock、paragraph 后保存，刷新后顺序与保存前一致。
- 同一 create batch 重放不会产生重复块。
- 保存过程中继续输入，旧响应不会覆盖新输入。
- create ack 只更新 blockId，不触发 payload 二次写入。

### 可观测性

日志至少包含：

- docId
- requestId/clientBatchId
- source: autosync/manual-save
- baseVersion/serverHead
- editorBeforeHash
- payloadHash
- responseHash
- currentEditorHash
- operation count
- create/update/delete/move count
- 是否调用 setContent
- 是否跳过旧响应

### 回归保护

前端 Vitest 覆盖：

- 中间插入 sortKey 不碰撞
- 已有块顺序变化会生成 move/reorder
- flattenBlockTree 不破坏树顺序
- create ack 不触发内容覆盖
- 保存响应旧于当前编辑时被跳过

后端 Jest 覆盖：

- `/blocks/batch` create 幂等
- sortKey 冲突时拒绝或规范化
- batch 事务内顺序稳定
- baseVersion 冲突返回 needsReload/conflict

---

## 8. 推荐修复路线

先修协议和数据一致性，再优化 UI 提示：

1. 补前端纯函数测试，锁定 sortKey/reorder bug。
2. 引入稳定的块序列计算，不再用 index 直接生成会碰撞的 sortKey。
3. 前端 diff 生成 move/reorder 操作。
4. 后端支持 batch move/reorder 与 create 幂等。
5. 保存响应应用前增加 requestId/hash guard。
6. 保存后 reload 改为受保护的 reconcile，不允许无条件覆盖 UI。
7. 加同步诊断日志。


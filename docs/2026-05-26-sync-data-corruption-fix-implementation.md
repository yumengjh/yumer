# 2026-05-26 协作文档同步数据错乱修复实现说明

## 1. 文档定位

这份文档记录 2026-05-26 这轮协作文档同步数据错乱修复的最终实现。它面向后续维护者、提交审阅者和排查线上同步问题的人，重点说明：

- 问题为什么会发生
- 这次修复采用了什么设计
- 前后端如何协调同步协议
- 编辑器内容如何 diff、排队、发送、确认和回填
- 保存后为什么不能再无条件 reload
- 后端如何保证 create 重放幂等
- 本次验证结果和仍需观察的风险

对应的前置分析与计划文档：

- `docs/superpowers/specs/2026-05-26-sync-data-corruption-analysis.md`
- `docs/superpowers/plans/2026-05-26-sync-data-corruption-fix.md`

---

## 2. 背景与问题表现

协作文档编辑器启用同步引擎后，用户在已有文档中间插入新的段落、列表、任务列表或高亮块时，偶尔会在保存或刷新后看到内容顺序错乱。典型表现包括：

1. 在 A 和 B 两个已有块之间插入 X，保存后 X 没有稳定留在 A/B 中间。
2. 从 todo/list 结构中断开后继续输入，后续内容可能被移动到已有标题或块的下面。
3. 同一批 create 请求在旧响应、重试或状态回放下可能写入两次，表现为内容重复。
4. 手动保存成功后立即 reload 服务端内容，可能把用户保存期间继续输入的新内容覆盖掉。
5. 加载服务端 block tree 时做了全局排序，可能破坏不同 parent 下 children 的局部顺序边界。

这类问题本质上不是 TipTap 渲染问题，而是同步协议没有完整表达“当前编辑器看到的块顺序”和“同一个客户端 create 的幂等身份”。

---

## 3. 根因总结

### 3.1 新块 sortKey 与已有块碰撞

旧实现用顶层数组 index 直接生成 sortKey：

```ts
String((index + 1) * 1000).padStart(6, "0")
```

当已有文档是：

```txt
A sortKey=001000
B sortKey=002000
C sortKey=003000
```

用户在 A 与 B 中间插入 X 时，X 的新 index 是 1，于是旧逻辑生成：

```txt
X sortKey=002000
```

这会和 B 发生排序键碰撞。后端再按 sortKey 重建文档树时，最终顺序就不再严格等于用户保存时看到的 UI 顺序。

### 3.2 diff 不表达已有块重排

旧 `deriveSyncEntries(prevDoc, nextDoc)` 只表达：

- create
- update
- delete

它不表达已有块在同级中的顺序变化。只要用户移动或插入导致已有块位置变化，但 payload 本身没变，后端就收不到任何 reorder 语义。

### 3.3 create 缺少幂等身份

前端每次 flush 都会带 `clientBatchId`，create entry 也有 `clientId`，但后端旧逻辑没有把这组身份持久化到 block payload，也没有在重放时查找既有块。

如果同一个批次请求已经成功落库，但响应丢失或前端重试，后端会再次创建新 block。

### 3.4 保存后无条件 reload 会覆盖当前 UI

手动保存链路原来会在 commit 后直接：

```ts
const loaded = await loadContent(currentDoc.docId);
setContent(loaded.content || DEFAULT_CONTENT);
```

这个 reload 不判断：

- reload 发起时 editor 的内容 hash
- reload 返回时当前 editor 是否又发生变化
- 服务端返回内容是否仍对应发起 reload 时的内容

所以旧响应有机会覆盖用户保存期间继续输入的新内容。

### 3.5 加载时全局 flatten sort 破坏树边界

旧 `flattenBlockTree(root)` 先 DFS 展平，再对所有 block 做全局 sortKey 排序。这会把不同 parent 下的 block 放进同一个排序空间，破坏树结构的局部 sibling 顺序。

---

## 4. 总体设计

这次没有推翻现有架构，仍然沿用：

```txt
TipTap JSON -> frontend sync diff -> /blocks/batch -> backend block tree
```

修复重点是收紧同步协议：

1. **新块排序键必须基于相邻已有 sibling 生成**
   - 插入 A/B 中间时生成 `001500`，不再复用 index 对应的 `002000`。

2. **已有块排序变化必须表达为 move**
   - 前端 `SyncEntry.opType` 扩展为 `create | update | delete | move`。

3. **update 与 move 可以合并在同一个 dirty entry 上**
   - reducer 保留 payload 与 sortKey。
   - API 序列化时先发送 update，再发送 move。

4. **create 必须具备幂等语义**
   - 后端以 `docId + clientBatchId + clientId` 查找已创建 block。
   - 命中时直接返回原 blockId，不再创建第二个 block。

5. **保存后 reload 必须受 hash guard 保护**
   - 只有当前 editor hash、reload 发起 hash、服务端响应 hash 一致时，才允许 `setContent`。

6. **加载路径保持树的局部顺序**
   - 对每个 parent 的 children 按 sortKey 排序，然后 DFS。
   - 不再把整棵树展平后全局排序。

---

## 5. 前端实现细节

### 5.1 稳定排序 helper

新增文件：

- `src/services/sync/order.ts`

核心 API：

```ts
createSortKeyBetween(previous: string | null, next: string | null): string
readTopLevelOrder(doc: TiptapDoc): OrderedBlockRef[]
```

`createSortKeyBetween` 的行为：

| 场景 | 输入 | 输出 |
| --- | --- | --- |
| 插入两个已有块之间 | `001000`, `002000` | `001500` |
| 插入第一个块之前 | `null`, `001000` | `000500` |
| 插入最后一个块之后 | `003000`, `null` | `004000` |
| 空文档插入 | `null`, `null` | `001000` |

这解决了中间插入新块时 sortKey 复用已有块的问题。

### 5.2 diff 生成 create 和 move

修改文件：

- `src/services/sync/engine.ts`
- `src/services/sync/types.ts`

`SyncOpType` 扩展为：

```ts
export type SyncOpType = "create" | "update" | "delete" | "move";
```

diff 现在会读取节点 attrs 中已有的 `sortKey`。如果没有，则使用 index 作为 fallback，但新建块不会直接使用 fallback，而是根据相邻已有 block 计算非碰撞 sortKey。

对于已有块，diff 会检查：

1. index 是否变化
2. 根据目标位置计算出的 sortKey 是否不同于原 sortKey

只有两者都满足时，才生成 move entry。这样可以避免“在 A/B 中间插入 X 导致 B index 后移，但 B 的 sortKey 不需要变化”时产生无意义 move。

### 5.3 reducer 合并 update 与 move

修改文件：

- `src/services/sync/reducer.ts`

当同一个块既编辑了 payload，又发生了排序变化，旧 reducer 容易用后来的 entry 覆盖前面的 payload 或排序信息。

现在 reducer 对 `incoming.opType === "move"` 做了专门处理：

- 当前 entry 是 create：继续保持 create
- 当前 entry 是 update：继续保持 update
- 合并 `parentId` 与 `sortKey`
- 不丢弃已有 `payload`

这样同一块“内容变了 + 顺序变了”可以在一个 dirty entry 中保留下来。

### 5.4 batch API 序列化 move

修改文件：

- `src/services/sync/api.ts`

前端发送 `/blocks/batch` 时现在支持四类操作：

- create
- update
- delete
- move

如果 entry 是纯 move：

```json
{
  "type": "move",
  "blockId": "...",
  "parentId": "rootBlockId",
  "sortKey": "001500"
}
```

如果 entry 是 update 且带有 `sortKey`，说明这个 entry 同时包含内容修改和排序变化。序列化会输出两个后端操作：

1. update payload
2. move sortKey

顺序固定为 update 在前、move 在后。后端每个操作都会创建新的 block version，最终 latest version 会保留最新 sortKey 与最新 payload。

### 5.5 batching 支持 move 限额

修改文件：

- `src/services/sync/batching.ts`

批次限额加入：

```ts
move: 100
```

同时兼容旧测试或旧调用方传入的自定义 `byOperation`，如果没有 `move` 字段，会用默认值补齐。

### 5.6 保存响应 hash guard

新增文件：

- `src/services/sync/hash.ts`

修改文件：

- `src/components/EditorPage.tsx`

新增逻辑：

1. commit 完成后，reload 前读取当前 editor JSON，计算 `hashAtReloadStart`。
2. `loadContent` 返回后，再次读取当前 editor JSON，计算 `currentEditorHash`。
3. 对服务端返回内容计算 `responseHash`。
4. 只有以下条件成立才允许 `setContent`：

```ts
currentEditorHash === hashAtReloadStart &&
responseHash === hashAtReloadStart
```

如果用户在 reload 期间继续编辑，`currentEditorHash` 会变化，旧响应不会覆盖当前 UI。

如果服务端返回内容和 reload 发起时的本地内容不一致，也不会直接覆盖 UI，而是把保存状态置为 error 并提示用户检查同步状态。

### 5.7 加载路径保持树顺序

修改文件：

- `src/services/document.ts`

新增：

```ts
flattenBlockTreeInDocumentOrder(root: Block): Block[]
```

它的规则是：

1. 先 push 当前 block
2. 对当前 block 的 children 按 sortKey 排序
3. sortKey 相同则按 blockId 稳定排序
4. 对每个 child 递归执行相同逻辑

`loadDocumentContent` 和 `loadDocumentContentV2` 都改为使用这个新 helper。

旧的 `flattenBlockTree` 暂时保留，避免影响历史保存路径中可能仍依赖全局排序的旧逻辑。

### 5.8 同步诊断日志

修改文件：

- `src/hooks/useDocumentSync.ts`

开发环境下新增：

```txt
[sync] flush:dispatch
[sync] flush:response
```

dispatch 日志包含：

- docId
- clientBatchId
- baseVersion
- operationCount
- createCount
- updateCount
- deleteCount
- moveCount

response 日志包含：

- docId
- acceptedBatchId
- serverHead
- needsReload
- resultCount

这些字段可以直接用于排查“某次保存到底有没有发送 move / create / update”。

---

## 6. 后端实现细节

### 6.1 后端原有 move 能力

后端 DTO 和 service 已经支持 batch move：

- `BatchOperationType.MOVE`
- `BatchMoveOperation`
- `handleBatchMove`

因此本次后端重点不在新增 move DTO，而在 create 幂等和 batch 诊断。

### 6.2 create 幂等身份持久化

修改文件：

- `E:\workspace\yuweb\back\server\src\modules\blocks\blocks.service.ts`

`handleBatchCreate` 现在会把客户端 create 身份写入 payload attrs：

```ts
attrs: {
  ...payload.attrs,
  clientBatchId,
  clientId,
}
```

保存后的 block payload 既保留原 TipTap 节点 attrs，也额外记录批次身份。

### 6.3 create 重放查找逻辑

新增内部方法：

```ts
findExistingCreateByClientIdentity(
  manager,
  docId,
  clientBatchId,
  clientId,
)
```

查找条件：

- 同一个 docId
- block 未删除
- block latest version payload attrs 中的 `clientBatchId` 相同
- block latest version payload attrs 中的 `clientId` 相同

如果命中，则 `handleBatchCreate` 直接返回：

```ts
{ blockId: existing.blockId }
```

不会再创建新的 block。

### 6.4 后端 batch 诊断日志

batch 成功处理后新增日志：

```txt
sync batch: docId=..., clientBatchId=..., source=..., operations=..., serverHead=...
```

这可以和前端 `[sync] flush:*` 日志串起来，定位某个 batch 是否到达后端、是否创建 pending version、最终 serverHead 是多少。

---

## 7. 前后端协议协同

### 7.1 请求结构

前端发送：

```json
{
  "docId": "doc_1",
  "baseVersion": 5,
  "clientBatchId": "batch_xxx",
  "source": "autosync",
  "createVersion": false,
  "operations": []
}
```

`operations` 现在可能包含：

```json
{ "type": "create", "clientId": "c_x", "data": { "sortKey": "001500" } }
{ "type": "update", "blockId": "b_x", "data": { "payload": {} } }
{ "type": "move", "blockId": "b_x", "parentId": "root_1", "sortKey": "003000" }
{ "type": "delete", "blockId": "b_x" }
```

### 7.2 create ACK

后端返回：

```json
{
  "operation": "create",
  "success": true,
  "clientId": "c_x",
  "blockId": "b_server"
}
```

前端仍然只把 ACK 用于身份回填：

- 给当前 TipTap node 写入 `blockId`
- 更新 sync snapshot
- 不把 ACK 当作远端内容覆盖当前 editor

### 7.3 update + move 的一致性

当前协议没有单个“updateAndMove”操作，所以前端把它拆成两个后端操作。后端按数组顺序在同一个 batch transaction 内执行。

这意味着：

- update 先创建带新 payload、旧 sortKey 的版本
- move 再创建带新 sortKey、同 payload 的版本
- latest version 最终同时具备新 payload 与新 sortKey

这是最小侵入方案，不需要改后端 DTO 或新增复合操作类型。

---

## 8. 同步流程

### 8.1 普通 autosync

```txt
TipTap onChange
  -> React content
  -> useDocumentSync effect
  -> advanceSyncSnapshot(prev, next)
  -> deriveSyncEntries
  -> enqueueChange
  -> dirtyOrder
  -> flush("autosync")
  -> /blocks/batch
  -> resolveBatchSuccess
  -> applyCreateAck
```

关键点：

- 新建块的 sortKey 在 diff 阶段就已稳定生成。
- 已有块需要排序变化时生成 move。
- create ACK 只修补 identity，不覆盖 payload。

### 8.2 手动保存

```txt
用户点击保存
  -> editorRef.current.getJSON()
  -> flushAndCommitBarrier(latestContent)
  -> commitVersion
  -> guarded loadContent
  -> hash 校验通过才 setContent
```

关键点：

- 保存前强制读取 TipTap 当前真实 JSON，避免 React state/effect 落后一拍。
- 保存后的 reload 只能在 hash 证明安全时应用。

### 8.3 create 重放

```txt
第一次 create batch
  -> 后端创建 block
  -> payload.attrs 写入 clientBatchId + clientId

同一 create batch 重放
  -> 后端按 docId + clientBatchId + clientId 查找
  -> 命中 existing latest version
  -> 返回原 blockId
  -> 不创建新 block
```

---

## 9. 测试覆盖

### 9.1 前端新增/扩展测试

- `src/services/sync/__tests__/order.test.ts`
  - 新块插入两个已有块之间生成 `001500`
  - 插入首尾位置生成稳定 sortKey
  - 可读取顶层块顺序

- `src/services/sync/__tests__/engine-order.test.ts`
  - 中间插入新块不再复用已有块 sortKey
  - 已有块相对顺序变化会生成 move

- `src/services/sync/__tests__/reducer.test.ts`
  - 同一个已有块 update 后 move，不丢 payload，也保留 sortKey

- `src/services/sync/__tests__/stale-response.test.ts`
  - editor 未变化时允许应用响应
  - editor 已变化时拒绝旧响应

- `src/services/__tests__/document-load-order.test.ts`
  - block tree 展平时保持每个 parent 的局部 sortKey 顺序

### 9.2 后端新增测试

- `E:\workspace\yuweb\back\server\src\modules\blocks\blocks-sync-idempotency.spec.ts`

覆盖：

- 同一个 `clientBatchId + clientId` create batch 重放时，第二次返回第一次的 blockId
- 内存 fake manager 中最终只存在一个 paragraph block

---

## 10. 验证结果

已执行并通过：

```bash
cd E:\workspace\editor-demo\app
pnpm exec vitest run src/services/sync/__tests__/order.test.ts src/services/sync/__tests__/engine-order.test.ts src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/stale-response.test.ts src/services/__tests__/document-load-order.test.ts src/services/sync/__tests__/batching.test.ts
pnpm build
```

结果：

- 6 个前端测试文件通过
- 21 个前端测试通过
- Next.js production build 通过

已执行并通过：

```bash
cd E:\workspace\yuweb\back\server
pnpm test -- blocks-sync-idempotency.spec.ts
pnpm build
```

结果：

- 后端 idempotency 测试通过
- Nest build / TSC 通过

### lint 说明

前端全量：

```bash
pnpm lint
```

当前仍失败，主要是仓库既有 lint 债务，包含多个未改文件中的 `react-hooks/set-state-in-effect`、`react-hooks/refs`、`no-explicit-any`、未使用变量等问题。本次改动没有尝试修复这些无关问题。

后端：

```bash
pnpm lint
```

当前脚本在 Windows 下会失败，因为 `back/server/package.json` 中的脚本调用 `pnpm --dir ../.. lint:server`，而当前上层 package 未提供 `lint:server`。本次用 `pnpm build` 和目标 Jest 测试作为后端验证门禁。

---

## 11. 设计取舍

### 11.1 为什么不重写同步架构

这次问题可以通过补强现有协议解决：

- sortKey 生成更稳定
- move 语义补齐
- create 幂等补齐
- reload guard 补齐

如果直接重写同步架构，风险会大幅扩大，且很难在短时间内验证所有编辑器操作。

### 11.2 为什么 move 不总是在 index 变化时发送

插入新块会导致后续已有块 index 后移，但如果它们原来的 sortKey 仍然正确，就不需要移动它们。

因此最终条件是：

```txt
index changed && computed target sortKey != previous sortKey
```

这减少无意义后端版本，也降低同步噪声。

### 11.3 为什么 hash guard 只保护 reload，不阻止 commit

commit 表示“把当前已同步 draft 固化为版本”，reload 只是保存后的 UI 回填动作。旧响应覆盖 UI 是 reload 的问题，不应该把 commit 语义和 UI 回填语义混在一起。

所以当前设计是：

- flush/commit 正常执行
- reload 返回后再判断是否可应用
- 不可应用时保留当前 UI，并提示用户

### 11.4 为什么后端幂等身份写入 payload attrs

最小侵入方案是不新增表、不新增迁移，直接利用 block latest payload 中已有的 TipTap attrs 空间记录客户端身份。

代价是查询没有专门索引，适合当前规模和本次修复范围。未来如果 batch 幂等成为高频能力，可以考虑独立的 `sync_batches` 或 `client_create_keys` 表。

---

## 12. 后续观察点

1. 大量连续插入时，`createSortKeyBetween` 在间隙耗尽后会退化为 `left + 1`，后续可以考虑更强的 fractional indexing。
2. `update + move` 当前拆成两个后端版本，语义正确但版本数更多；如果后续版本膨胀明显，可以设计复合 batch operation。
3. 后端 create 幂等查询目前依赖 latest payload attrs，未来可以抽成专用幂等记录表并加唯一约束。
4. 保存后 hash guard 拒绝旧响应时，目前提示用户检查同步状态；后续可以加入更明确的“重新加载/保留本地/再次保存”交互。
5. 全量 lint 仍有仓库既有债务，建议单独安排一次 lint 基线清理，不和同步修复混在同一个提交里。

---

## 13. 总结

这次修复把同步链路从“只同步内容差异”补强为“同步内容差异 + 块顺序差异 + create 幂等身份 + 保存响应边界”。

最终效果是：

- 中间插入新块不再产生 sortKey 碰撞
- 已有块真实重排可以通过 move 同步给后端
- 同一 create batch 重放不会产生重复 block
- 手动保存后的旧 reload 不会覆盖用户继续编辑的内容
- 文档加载不再用全局排序破坏树结构局部顺序
- 前后端日志可以用同一个 `clientBatchId` 串联排查

这套方案保留了现有 TipTap JSON + `/blocks/batch` 架构，同时把最容易导致用户数据错位和重复写入的协议缺口补齐了。

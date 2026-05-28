# 2026-05-28 同步 ack sortKey 回灌与前后端兜底复盘

## 1. 背景

这次修复承接前一次连续换行/空行同步修复。前一次修复已经解决了多个明显问题：

- 连续 create 需要唯一 `sortKey`。
- 新块必须使用稳定且独立的 `syncCreateId`。
- create/update 合并时不能继承旧块身份。
- 编辑器同步确认回写不能用 `setContent` 重建全文导致光标漂移。

但在继续手工测试时，仍然偶发出现“空格/空行被吃掉”的现象。用户整理的三份 `/blocks/batch` 请求响应日志显示：前端请求、后端响应、下一轮前端 update 之间仍有状态不一致。

本轮修复的核心不是再补一个排序算法，而是修补前后端同步协议里“服务端最终确认值没有成为客户端下一轮事实来源”的断点。

---

## 2. 现象与日志证据

### 2.1 后端已经修正 sortKey，但前端下一轮仍使用旧值

在 `log/2.txt` 中，新建块请求携带：

```json
"sortKey": "001000"
```

后端响应为：

```json
{
  "operation": "create",
  "clientId": "cid_0fc68d75-c156-47cb-a95e-7edd6e864326",
  "blockId": "b_1779925770617_6b6ef480",
  "sortKey": "000984"
}
```

这说明后端为了避开已有 sibling，已经选择了最终排序键 `000984`。

但在 `log/3.txt`，同一个 block 的 update payload 又携带：

```json
"blockId": "b_1779925770617_6b6ef480",
"attrs": {
  "sortKey": "001000"
}
```

这证明前端没有吸收后端 create ack 返回的最终 `sortKey`，而是继续使用本地旧 `sortKey`。

### 2.2 重复 sortKey 仍然会出现

日志中还可以看到多个 create 同时请求同一个 `sortKey`：

- `log/1.txt`：3 个 create 都请求 `002000`。
- `log/3.txt`：10 个 create 都请求 `002000`。

后端目前会兜底分配 `002008`、`002009`、`002010` 等最终值。但如果这些最终值没有回灌给前端，前端下一轮 diff 仍然会基于旧的、重复的本地排序锚点运行。

---

## 3. 根因链路

### 3.1 前端只回灌 blockId，没有回灌 sortKey

前端收到 create ack 后，原逻辑只提取：

```ts
{ clientId, blockId }
```

并通过 `applyCreateAck` 写回本地 snapshot/editor content。后端响应里的 `sortKey` 被类型层和映射层一起丢掉。

结果是：

1. 后端决定最终 `sortKey`。
2. 前端没有记录这个最终值。
3. 下一次输入触发 update，payload 仍携带旧 `sortKey`。
4. 后端继续接收一个与真实排序列不一致的 payload。

### 3.2 sync 元数据变化被当作内容变化

前端 diff 的 `normalizePayload` 之前只剥离：

- `blockId`
- `clientId`
- `data-block-id`
- `data-client-id`

但没有剥离：

- `sortKey`
- `syncCreateId`
- `clientBatchId`
- `data-sort-key`
- `data-sync-create-id`

这些字段都是同步元数据，不是用户正文内容。如果它们变化也触发 update，就会制造“伪内容变更”，增加 autosync 与编辑器 patch 的扰动概率。

### 3.3 后端 update 信任了客户端 payload.attrs.sortKey

后端 update 时会把旧 payload attrs 和 incoming payload attrs 合并：

```ts
attrs: {
  ...previousAttrs,
  ...incomingAttrs,
}
```

如果旧客户端或异常状态发来 stale `payload.attrs.sortKey`，它会覆盖 payload 里的 sortKey。与此同时，`BlockVersion.sortKey` 列仍沿用当前版本真实排序键。

这样会形成分裂：

```txt
BlockVersion.sortKey = 000984
BlockVersion.payload.attrs.sortKey = 001000
```

这种分裂会让后续读取、diff、渲染或调试时无法确定哪一个才是事实来源。

---

## 4. 本轮前端修复

### 4.1 扩展 SyncBatchResult

前端同步响应类型增加：

```ts
sortKey?: string
```

这让后端 create ack 里的最终排序键进入类型系统，而不是被静默丢弃。

### 4.2 create ack 同时回灌 blockId 与 sortKey

`useDocumentSync` 现在会把 create ack 映射为：

```ts
{
  clientId,
  blockId,
  sortKey,
}
```

`applyCreateAck` 会写回：

- `blockId`
- `data-block-id`
- `sortKey`
- `data-sort-key`

因此后端最终确认的排序键会进入本地 snapshot，并通过已有局部 editor patch 进入编辑器节点 attrs。

### 4.3 inflight create 的后续 update 保留服务端 sortKey

如果用户在 create 请求 inflight 期间继续输入，create ack 回来时 reducer 会把本地 entry 转成 follow-up update。本轮修复保证这个 update 也带上服务端最终 `sortKey`，避免下一轮请求继续发送旧值。

### 4.4 内容 diff 忽略同步元数据

前端 diff 现在把以下字段视为同步元数据，不参与正文内容指纹比较：

- `blockId`
- `clientId`
- `sortKey`
- `syncCreateId`
- `clientBatchId`
- `data-block-id`
- `data-client-id`
- `data-sort-key`
- `data-sync-create-id`

编辑器局部 identity patch 也同步忽略这些字段，避免 metadata-only ack 因比较失败而退回全文 `setContent`。

---

## 5. 本轮后端修复

### 5.1 update 时使用 canonical sortKey

后端 `handleBatchUpdate` 在合并 payload 时传入当前版本的 canonical `sortKey`：

```ts
latestVersion?.sortKey
```

`mergePayloadPreservingSyncAttrs` 会用这个值覆盖 incoming payload attrs 中的 `sortKey`。

这保证即使客户端发来 stale sortKey，后端保存的新版本仍然满足：

```txt
BlockVersion.sortKey === BlockVersion.payload.attrs.sortKey
```

### 5.2 后端测试覆盖

新增测试模拟客户端 update 携带过期 sortKey：

```json
"sortKey": "stale-client-sort-key"
```

断言后端保存的新版本 payload attrs 中的 sortKey 仍等于当前版本真实 sortKey，而不是客户端传来的旧值。

---

## 6. 为什么之前只是“有隐患”而不是必现

这个问题依赖多个时序条件叠加，所以表现为偶发：

1. 用户快速输入或连续换行，产生 create 与 update 交错。
2. 后端因为冲突或占位需要调整最终 sortKey。
3. create ack 返回时，前端没有回灌最终 sortKey。
4. 下一轮 update 恰好携带旧 sortKey。
5. 后端如果信任 payload attrs，就可能把旧元数据写入 payload。

如果用户输入慢、后端没有调整 sortKey、或者没有后续 update，问题就不明显。因此它不像普通逻辑错误一样每次复现，但一旦出现，会破坏前后端对块顺序事实来源的共识。

---

## 7. 前后端之后应如何协调

### 7.1 协议事实来源

- `blockId`：由后端最终确认，前端只能在 create ack 后采用。
- `sortKey`：create/move 后以后端最终响应为准。
- `syncCreateId`：由前端为每个本地 create 稳定生成，用于后端幂等识别。
- `clientId`：前端本地块身份，用于 ack 回填和未提交变更追踪。

原则：**前端可以提出期望 sortKey，但后端响应的 sortKey 才是下一轮同步的事实来源。**

### 7.2 前端职责

1. 发送 create 时必须提供稳定 `clientId` 与 `syncCreateId`。
2. 接收 create ack 时必须回灌后端返回的 `blockId` 与最终 `sortKey`。
3. diff 时不能把同步元数据当作正文内容变化。
4. metadata-only patch 必须走局部事务，不能全文重建编辑器内容。
5. inflight create 后续转 update/delete 时必须继承 ack 中的服务端最终身份与排序键。

### 7.3 后端职责

1. create 必须按 `syncCreateId` 做跨 batch 幂等。
2. create/move 必须在服务端 sibling 空间里保留唯一 `sortKey`。
3. create/move 响应必须返回最终采用的 `sortKey`。
4. update 不能信任客户端传来的 `payload.attrs.sortKey`，必须用当前版本 canonical sortKey 兜底。
5. 后端持久化时应保持 `BlockVersion.sortKey` 与 `payload.attrs.sortKey` 一致。

### 7.4 推荐同步流程

```txt
用户输入
  ↓
前端 TipTap JSON 变化
  ↓
前端 diff：只比较正文内容，忽略 sync 元数据
  ↓
前端生成 SyncEntry：create/update/delete/move
  ↓
POST /blocks/batch
  ↓
后端执行幂等、排序唯一性、payload canonical 化
  ↓
后端返回逐操作 ack：blockId + sortKey + version
  ↓
前端 reducer 更新 inflight entry
  ↓
前端 snapshot/editor 局部 patch ack 元数据
  ↓
下一轮 diff 基于后端确认后的 blockId/sortKey 继续
```

---

## 8. 后续建议

1. 把 create ack 的 `{ clientId, blockId, sortKey }` 抽成明确的类型，避免再遗漏响应字段。
2. 把“同步元数据剥离列表”集中维护，避免 engine/editorIdentity 两处规则漂移。
3. 增加浏览器级 E2E：快速输入、连续换行、空行、同步 ack 后继续输入、刷新回读。
4. 后端增加一个数据一致性检查：扫描 `BlockVersion.sortKey !== payload.attrs.sortKey` 的历史脏数据，并决定是否修复。
5. 开发调试日志中打印 create ack 的最终 `sortKey` 与前端下一轮 update 的 attrs.sortKey，方便快速判断是否回灌成功。

---

## 9. 总结

这次修复的本质是让前后端重新建立同步协议的单一事实来源：

> 前端可以提出本地排序意图，但后端最终确认的 `sortKey` 必须被前端吸收，并由后端在后续 update 中继续兜底保持一致。

前端修复消除了 ack 丢失导致的本地状态漂移；后端修复防止旧客户端或异常请求污染持久化 payload。两边合起来，才能降低连续换行、空行、快速输入场景下“偶发吃空格/空行”的风险。

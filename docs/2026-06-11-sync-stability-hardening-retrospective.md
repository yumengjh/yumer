# 2026-06-11 内容同步稳定性加固复盘

## 1. 背景

在高频编辑场景（连续换行、删除、改写、拖拽排序）下，用户报告刷新后**块顺序或正文与编辑结束前不一致**。日志中的典型文档为 `doc_1781186605449_fedfca56`：多个 batch 全部 ACK 成功，但下一批仍对同一 `clientId` 发送 `blockId: null` 的 CREATE，随后出现 `identity:resurrected` 与 sortKey 漂移。

本轮工作不是单一 bugfix，而是一次**同步基础设施加固**：前后端统一 fractional sortKey、批次 ACK 语义修正、manifest 轻量对账、corruption 自修复、flush 退避重试、update 瘦身等。用户界面无可见变化，但刷新后内容与顺序的稳定性显著提升。

## 2. 影响范围

### 用户可见影响（修复前）

- 高频编辑后刷新，段落顺序与编辑结束前不同；
- 已删除块在刷新后重新出现（resurrected）；
- 同一批 CREATE 被重复发送，服务端块数膨胀、sortKey 震荡；
- 偶发「保存成功」但本地快照与服务端 manifest 不一致。

### 数据层影响

- 客户端 `snapshotRef` 在 batch ACK 后仍保留无 `blockId` 的块 → diff 误判为新建；
- DELETE ACK 未从快照移除块 → 后续 diff 认为块仍存在；
- 整数 sortKey 在密集插入/移动时易冲突，触发服务端重分配与客户端二次 move；
- `manifestDigest` 仅比对 blockId **集合**，无法单独发现纯顺序漂移（已知限制）。

## 3. 根因分析

### 3.1 ACK 后 rescan 竞态（主因）

`useDocumentSync` 在 `resolveBatchSuccess` 之后立即执行：

```text
captureContentSnapshot(latestContentRef.current, "batch-ack-rescan")
```

此时编辑器正文尚未写入服务端返回的 `blockId`/`sortKey`，而 `snapshotRef` 也未提前补丁。`deriveSyncEntries(prev, next)` 将「上一快照无 blockId、当前文档亦无 blockId」的块再次识别为 CREATE，导致：

```text
batch_1781186668976  ACK 9 个 create
batch_1781186669330  对相同 clientId 再发 CREATE（blockId: null）
```

### 3.2 DELETE ACK 未更新快照（次因）

删除操作 ACK 成功后，快照仍保留已删块。diff 在后续编辑中可能将其视为「复活」或触发错误的 update/move。

### 3.3 结构性弱点（放大因素）

| 弱点 | 后果 |
|------|------|
| 整数步进 sortKey | 密集操作易冲突、需频繁 move |
| 无 manifest 捎带对账 | reconcile 只能全量拉取或盲目信任 |
| flush 单批失败即中断 | 队列积压、ACK 与编辑器状态进一步错位 |
| update 携带冗余字段 | 批次体积大、冲突面更广 |

## 4. 修复与加固措施

### 4.1 ACK 处理顺序（前端，关键修复）

`src/hooks/useDocumentSync.ts`：

1. 从 `response.results` 构建 `createMappings` / `serverAckMappings` / `deleteAckMappings`；
2. `applyBatchAckToDoc` = `applyServerAck` + `applyServerDeleteAck`；
3. **先**补丁 `snapshotRef` 与 `snapshotIndexRef`；
4. **再**对 `applyBatchAckToDoc(latestContentRef.current)` 做 `batch-ack-rescan`；
5. trace 段对快照二次应用相同映射（与步骤 3 幂等）。

`src/services/sync/engine.ts` 新增 `applyServerDeleteAck`，按 `blockId`/`clientId` 从顶层 content 移除块。

### 4.2 Fractional indexing（前后端）

- 前端：`fractional-key.ts` + `order.ts` 全面替换整数 sortKey 规划；
- 后端：`fractional-key.ts` + `sort-key.util.ts`，`blocks.service` 使用相同字母表与 `between` 语义；
- 迁移：`scripts/migrate-sortkeys-to-fractional.ts`（幂等，部署后执行 `pnpm sortkeys:migrate`）。

### 4.3 Manifest digest 捎带对账

- 前端 `manifest-digest.ts`：批次请求捎带本地 blockId 集合摘要；
- 后端比对 digest，**仅 mismatch 时**触发 `sync-reconcile`，减少全量拉取。

### 4.4 其他前端加固

- **corruption 修复**：检出重复/乱序 sortKey 时重分配并入队 move；
- **ACK 位置校正**：`repairSnapshotSortKeyOrder` 检测 server sortKey 与视觉顺序不一致；
- **flush 退避重试**：部分失败不阻断后续批次；
- **update 瘦身**：去掉 plainText、剥离 attrs 冗余、合并结构字段；
- **create 与关联 move 同批**：减少首屏顺序抖动。

### 4.5 后端配套

- batch 响应返回 `manifestDigest`；
- activity 记录移出响应关键路径并采样；
- idempotency / tombstone / draftRevision 既有防线保持不变。

## 5. 验证

| 范围 | 结果 |
|------|------|
| 前端 `src/services/sync` 单测 | 99/99 通过 |
| 后端 `blocks-sync-idempotency` | 19/19 通过 |
| 用户复测（高频编辑 + 刷新） | 正常 |

新增/更新用例覆盖：delete ACK 快照移除、双快照均有 blockId 时不重复 CREATE、ACK 前快照补丁顺序（source test）。

## 6. 部署说明

1. **先后端、后前端**（fractional sortKey 协议需对齐）。
2. 后端部署后执行：`pnpm sortkeys:migrate`（生产前在 staging 验证幂等）。
3. 无需清库；旧整数 sortKey 由迁移脚本就地改写。
4. 观察指标：`sync batch` 日志中重复 CREATE 同一 `clientId`、`identity:resurrected`、reconcile 触发率。

## 7. 已知限制与后续

- `manifestDigest` 不感知顺序，仅感知 blockId 集合；纯 sortKey 漂移依赖 ACK 位置校正或 reconcile。
- 请求飞行期间的**并发编辑**仍依赖 diff + reducer 合并规则；极端多标签页场景继续依赖 `draftRevision` 与 sync session。
- 可考虑：order-aware digest（排序敏感哈希）或周期性轻量 reconcile。

## 8. 经验总结

### 8.1 快照基线必须在 rescan 前反映已确认事实

不能把「编辑器当前 DOM/文档」直接当作「服务端已 ACK 的状态」做 diff 起点。ACK 映射必须先写入 `snapshotRef`，再 `captureContentSnapshot`。

### 8.2 CREATE 与 DELETE 的 ACK 语义应对称

CREATE ACK 写 `blockId`；DELETE ACK 必须从快照**移除**块，否则 diff 会制造幽灵块或重复 CREATE。

### 8.3 基础设施改动可以零 UX 差异

fractional key、digest、退避、瘦身对用户透明，但直接决定大规模编辑后的数据一致性。

### 8.4 日志按 block 生命周期读比按 batch 读更有效

典型案例：`CREATE 成功 → 下一批又对同一 clientId CREATE` 一眼可见 ACK 竞态，而非 sortKey 或网络问题。

## 9. 相关文档

- 前端链路分析：`docs/2026-06-05-frontend-sync-stability-analysis.md`
- 后端优化分析：`yumer-server/docs/session/sync-stability-analysis-and-optimization.md`
- 块复活专项（2026-06-04）：`docs/2026-06-04-sync-block-resurrection-fix-retrospective.md`

## 10. 最终结论

本轮修复了 ACK 后 rescan 导致的**重复 CREATE**与 DELETE 快照残留，并系统性替换 sortKey 规划、加强对账与容错。核心 invariant：

> **batch ACK 成功后，客户端同步基线（snapshot）必须与服务端已确认的身份与删除事实一致，然后才能对编辑器内容做下一次 diff。**

在此 invariant 下，高频编辑后刷新应与编辑结束前一致；剩余风险主要集中在多标签页并发与纯顺序漂移的轻量检测缺口。

# 前端同步 Diff 引擎运行机制

日期：2026-06-07
仓库：`E:\workspace\editor-demo\app`
范围：解释前端按需块级 diff 引擎如何运行、为什么有时是 `FAST` 有时是 `FULL`、以及当前 console 日志应该怎么判断。

## 1. 结论

编辑器里有的触发 `FAST`，有的触发 `FULL`，这是正常的。

新的 diff 引擎不是为了让每一次快照推进都走 `FAST`。它的目标是：普通文本输入时，不再对整篇大文档做全量 payload diff；但在内容来源不可信、结构变化、身份修复、加载、ACK patch 等场景，仍然保守回退到完整 diff，优先保证同步正确性。

当前有三种模式：

- `content-hint`：日志显示为 `[sync:diff:FAST]`。
- `structure-hint`：日志显示为 `[sync:diff:STRUCTURE]`。
- `fallback-full`：日志显示为 `[sync:diff:FULL]`。

普通输入的理想日志是：

```txt
[sync:diff:FAST]
mode: content-hint
blocks: 495
dirtyCandidates: 1
fingerprints: 1
entries: 1
```

这表示 495 个顶层块里，只对 1 个候选脏块做了 payload fingerprint。按需块级 diff 生效。

`FULL` 不等于优化失效。只有在“普通单块文本输入”长期触发 `FULL + fingerprints 接近 blocks + entries > 0` 时，才说明 hint 没有正确传到同步引擎。

## 2. 完整运行链路

普通编辑器输入链路如下：

```txt
TipTap transaction
  -> MarkdownEditor 从 transaction 推导 SyncDiffHint
  -> 80ms debounce 后生成完整 TipTap JSON
  -> onChange(full JSON, hint)
  -> EditorPage 用 ref 绑定 content 和 hint
  -> startTransition(setContent)
  -> useDocumentSync 监听 content 变化
  -> captureContentSnapshot(content)
  -> consumeDiffHint(content)
  -> advanceSyncSnapshotIndexed(previousSnapshot, previousIndex, content, hint)
  -> deriveSyncEntriesWithMetrics(...)
  -> reducer 产生 dirty queue
  -> flush 发送 /blocks/batch
```

需要注意：编辑器当前仍然会在 debounce 后输出完整 TipTap JSON。这不是本轮优化的目标。本轮优化的位置在 `advanceSyncSnapshotIndexed()` 之后：同步 diff 不再对每个顶层块都做深层 payload stringify，而是根据 hint 只对变动块做 payload fingerprint。

## 3. 关键运行状态

`useDocumentSync` 内部维护三个关键 ref：

- `snapshotRef`：同步引擎认可的上一份规范化 TipTap 文档。
- `snapshotIndexRef`：上一份 snapshot 的顶层块索引和 payload fingerprint 缓存。
- `latestContentRef`：hook 当前看到的最新编辑器内容。

`EditorPage` 维护一个临时 hint ref：

- `syncDiffHintRef`：把某一次 `MarkdownEditor` emit 出来的 content 对象和对应 `SyncDiffHint` 绑定在一起。

hint 不放进 React state，这是刻意设计。dirty metadata 是高频临时信息，不应该触发额外 render。

## 4. Snapshot Index 是什么

`SyncSnapshotIndex` 是同步引擎的块级索引。它基于规范化后的顶层 TipTap 节点生成。

每个顶层块会记录：

- `clientId`
- `blockId`
- `matchKey`
- `index`
- `sortKey`
- `node`
- `payloadFingerprint`

索引还包含：

- `byClientId`
- `byBlockId`
- `byMatchKey`
- `orderKey`
- `sortKeyCorruptionReport`

其中 `orderKey` 是顶层块身份顺序的轻量字符串。它用来判断“这次看起来像内容编辑的变更，是否实际改变了顶层结构”。如果前后 `orderKey` 不一致，同步引擎不会走 `FAST`，会切到 `STRUCTURE`。

## 5. SyncDiffHint 是什么

`SyncDiffHint` 来自 `MarkdownEditor` 对 TipTap transaction 的保守分析。

结构如下：

```ts
{
  source: "editor-transaction" | "programmatic" | "unknown";
  changedClientIds: string[];
  changedBlockIds: string[];
  structureChanged: boolean;
  identityChanged: boolean;
  reason?: string;
}
```

语义：

- `changedClientIds` / `changedBlockIds`：本次 transaction 影响到的块身份。
- `structureChanged`：是否可能发生了顶层结构变化，比如新增、删除、拆分、合并、粘贴、拖拽、跨块修改。
- `identityChanged`：是否可能发生了身份修复或身份不稳定。
- `reason`：调试原因，例如 `content-change`、`structure-change`、`identity-change`、`unknown`。

这里的原则是保守：

- 能确定只是某个顶层块内部内容变化，才允许走 `FAST`。
- 只要可能涉及结构或身份，就不能冒险走 `FAST`。
- 不能确定时宁可 `FULL`，也不能漏同步。

## 6. 模式选择规则

模式选择发生在 `deriveSyncEntriesWithMetrics()`。

### 6.1 FAST：`content-hint`

只有同时满足这些条件才会走 `FAST`：

- 已经有 previous snapshot index。
- hint 里至少有一个 dirty candidate。
- `identityChanged === false`。
- `structureChanged === false`。
- previous `orderKey` 和 next `orderKey` 一致。

运行行为：

- 构建轻量 next top-level index。
- 不跑 sort-key planning。
- 不扫描 delete。
- 只 fingerprint hint 命中的 dirty blocks。
- 只有 dirty block payload fingerprint 变化时才生成 `update`。

复杂度：

```txt
O(n 顶层身份扫描) + O(k payload fingerprint)
```

普通输入时，`k` 通常是 1。

### 6.2 STRUCTURE：`structure-hint`

有可信 hint，但可能存在结构变化时，会走 `STRUCTURE`。

典型场景：

- 新增顶层块。
- 删除顶层块。
- 拆分块。
- 合并块。
- 粘贴内容。
- 拖拽或重排。
- `structureChanged === true`。
- `orderKey` 发生变化。

运行行为：

- 构建 next top-level index。
- 跑 create/delete/move planning。
- 必要时跑 sort-key planning。
- 尽量只 fingerprint dirty candidates 和新建块。
- 未变化块复用 previous index 里的 fingerprint。

复杂度：

```txt
O(n 结构/顺序规划) + O(k payload fingerprint)
```

结构变化必须看全局顺序，所以它不会像 `FAST` 那样便宜。但它仍然尽量避免对所有未变化块做深层 stringify。

### 6.3 FULL：`fallback-full`

没有可信 hint，或者身份/基线不可靠时，会走 `FULL`。

典型场景：

- 文档第一次进入同步引擎。
- 打开文档。
- 切换文档。
- 服务端内容加载。
- 本地恢复。
- 放弃草稿后重载。
- batch ACK 后做身份 patch。
- checkpoint ACK 后做映射 patch。
- 手动保存路径传入了未绑定 hint 的最新内容。
- 内容不是通过 `MarkdownEditor -> handleEditorChange(content, hint)` 进入的。
- `identityChanged === true`。
- previous index 丢失。

运行行为：

- 重建完整 index。
- 跑完整结构/顺序规划。
- 对所有顶层块计算 payload fingerprint。
- 保持旧 diff 的正确性语义。

这条路径是兜底，不是 bug。同步系统宁愿多做一次完整扫描，也不能在不确定时漏掉 create/delete/move/update。

## 7. 为什么一次编辑会看到 FAST 后又看到 FULL

常见日志：

```txt
[sync:diff:FAST] { mode: "content-hint", fingerprints: 1, entries: 1 }
[sync:diff:FULL] { mode: "fallback-full", fingerprints: 495, entries: 0 }
```

这不是同一个 editor transaction 被 diff 了两遍。

第一条是用户真实编辑：

```txt
MarkdownEditor onChange(content, hint)
  -> EditorPage 暂存 hint
  -> useDocumentSync 消费 hint
  -> FAST
```

第二条通常是 batch ACK 成功后的同步侧校准扫描：

```txt
/blocks/batch 成功
  -> resolveBatchSuccess(...)
  -> captureContentSnapshot(latestContentRef.current)
  -> 这次没有 editor transaction hint
  -> FULL fallback
  -> entries: 0
```

如果第二条是：

```txt
entries: 0
dirtyQueue: 0
```

那它没有产生额外同步任务，只是 ACK 后的一次无变更校准。当前 console 把它和真实编辑 diff 用同样级别输出，所以视觉上容易误判。

## 8. 哪些 FULL 是正常的

这些场景看到 `FULL` 是正常的：

- 初次加载文档。
- 切换文档。
- 服务端内容覆盖本地 content。
- 本地快照恢复。
- 放弃草稿后重新加载。
- batch ACK 回填 `blockId` / `sortKey`。
- checkpoint ACK 回填映射。
- 手动保存前主动捕获最新编辑器内容。
- 程序调用 `setContent(...)`，但没有对应 transaction hint。
- 编辑器身份修复或 identity patch。

这些 `FULL` 通常不代表性能问题，尤其当 `entries=0` 时，它只是同步基线校准。

## 9. 哪些 FULL 需要排查

这些情况需要排查：

- 用户只是持续在一个已有块里输入文字。
- 该块已经有稳定的 `clientId` 和 `blockId`。
- 没有切换文档、加载、恢复、ACK patch、手动保存。
- 控制台长期出现 `[sync:diff:FULL]`。
- `fingerprints` 接近 `blocks`。
- `entries > 0`。

这种组合说明普通输入没有带着可用 hint 到达 `useDocumentSync`。

可能原因：

- `MarkdownEditor` 没有为该 transaction 生成 hint。
- hint 绑定的 content 对象和 `useDocumentSync` 收到的 content 对象不是同一个引用。
- 在 sync effect 消费 hint 之前，程序化 content 更新覆盖了编辑器内容。
- transaction 被保守标记成 `identityChanged`。
- previous snapshot index 不存在或被重置。

## 10. 当前日志字段怎么读

日志前缀：

```txt
[sync:diff:FAST]
[sync:diff:STRUCTURE]
[sync:diff:FULL]
```

关键字段：

- `mode`：真实 diff 模式。
- `blocks`：当前顶层块数量。
- `dirtyCandidates`：hint 命中的候选脏块数量。
- `fingerprints`：本次实际计算 payload fingerprint 的块数。
- `sortPlan`：是否跑了 sort-key planning。
- `entries`：本次快照推进生成的 sync entries 数量。
- `dirtyQueue`：reducer 更新后的待同步队列长度。
- `durationMs`：本地耗时。
- `hint.reason`：hint 产生原因。
- `hint.structureChanged`：是否可能涉及结构变化。
- `hint.identityChanged`：是否可能涉及身份变化。

典型判断：

```txt
普通输入：
FAST, dirtyCandidates=1, fingerprints=1, entries=1

新增/删除/拆分/拖拽：
STRUCTURE, sortPlan=true, fingerprints 通常小于 blocks

ACK 后无变更校准：
FULL, fingerprints=blocks, entries=0, dirtyQueue=0

初次加载：
FULL, entries 通常为 0，正常
```

## 11. 正确性护栏

新的 diff 引擎必须保留现有同步语义：

- 已有块内容变化生成 `update`。
- 新块生成 `create`。
- 已同步块删除生成 `delete`。
- 未发出的 create 随后 delete，可以在 reducer 中取消。
- inflight create 随后 delete，仍然进入 tombstone 语义。
- move 仍然走现有 sort-key planning 和 LIS 最小移动策略。
- ACK metadata-only patch 不应该生成内容 update。
- sortKey 腐化时继续抑制危险 move。
- batch ACK 仍然要把 `blockId` / `sortKey` 回填到 editor、snapshot、React content。

因此，当前策略是：能确定局部时走快路径，不能确定时回退完整路径。

## 12. 当前日志的改进建议

现在的 console 日志还缺少 caller source，所以容易把 ACK 后 no-op full scan 误认为普通输入退化。

建议下一步做一个很小的诊断增强：

- 给 `captureContentSnapshot()` 增加 `source` 参数。
- 日志增加 `source` 字段。
- 建议 source 枚举：
  - `editor-effect`
  - `batch-ack-rescan`
  - `ack-content-patch`
  - `checkpoint-patch`
  - `manual-save`
  - `load`
- 对 `fallback-full + entries=0 + dirtyQueue=0` 降级为 `console.debug`，或者显示为 `[sync:diff:NOOP]`。

这只是诊断口径优化，不改变 diff 结果。

## 13. 验收标准

可以认为按需 diff 工作正常，当满足：

- 普通单块输入出现 `FAST`。
- `fingerprints` 远小于 `blocks`，通常是 1。
- 结构变化出现 `STRUCTURE` 或保守 `FULL`。
- 加载、恢复、ACK patch、checkpoint patch 可以出现 `FULL`。
- no-op `FULL` 的 `entries=0`，且不会扩大 `dirtyQueue`。
- 保存、ACK、reconcile、checkpoint、session recovery 语义不变。

需要继续修，当出现：

- 普通单块输入稳定触发 `FULL`。
- `FAST` 出现但 `fingerprints` 接近 `blocks`。
- `entries=0` 后 dirty queue 反而增长。
- ACK metadata patch 触发内容 update。
- 稳定文本输入产生 create/delete/move。

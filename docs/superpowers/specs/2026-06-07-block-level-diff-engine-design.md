# 按需块级 Diff 引擎设计

> 日期：2026-06-07
> 仓库：`E:\workspace\editor-demo\app`
> 目标：把前端同步中的全量 payload diff 收缩为按需块级 diff，降低超大文档编辑后的同步准备成本，同时保持现有后端同步契约不变。

## 1. 当前结论

当前同步稳定性已经足够支撑继续开发，但大文档性能瓶颈已经很明确：前端每次内容变更都会把整篇 TipTap JSON 送入 `advanceSyncSnapshot()`，再由 `deriveSyncEntries(previousSnapshot, nextDoc)` 对整篇顶层文档重新建索引、规划 sortKey，并对每个顶层块做 payload 指纹比较。

对小文档这可以接受。对几千到几万块的文档，单次输入后的同步准备会变成：

```txt
emit full TipTap JSON
  -> normalize whole doc
  -> index all top-level blocks
  -> plan order for all top-level blocks
  -> JSON.stringify normalized payload for every block
  -> enqueue changed entries
```

真正昂贵的是最后两类工作：

- 对所有块做 payload normalize + `JSON.stringify`。
- 在纯文本编辑场景里仍然执行结构排序规划。

第一版优化目标不是消灭所有 O(n) 扫描，而是把每次编辑后的重活从“整篇 payload diff”降到“只对变动块做 payload diff”。顶层 manifest 扫描仍可保留，因为它只读 `attrs/type/index/sortKey`，成本远低于深层 payload 序列化，也能继续保护 delete、move、tombstone 和 pending queue 收敛语义。

## 2. 设计边界

本轮要做：

1. 只优化前端 batch diff 生成。
2. 保持 `/blocks/batch`、`/sync-reconcile`、`/draft-checkpoint` 请求协议不变。
3. 保持 reducer 的 `SyncEntry`、`dirtyOrder`、`revision`、`ackedThroughOpSeq` 语义不变。
4. 保留 full checkpoint 作为最终态兜底，不把 checkpoint 改成 partial coverage。
5. 第一版只做“顶层块级 diff”。列表、表格、highlightBlock 内部变化仍作为所属顶层块的 payload update。

本轮不做：

1. 不引入后端 partial checkpoint。
2. 不改 sortKey 算法为 fractional indexing。
3. 不把 nested list item / table cell 拆成独立服务端块。
4. 不把同步状态塞进 React 高频 state。
5. 不用耗时型 benchmark 作为 CI 准入，性能测试以可重复的计数指标为主。

## 3. 现有热路径

当前核心入口：

- `src/modules/editor-kit/MarkdownEditor.tsx`
- `src/components/EditorPage.tsx`
- `src/hooks/useDocumentSync.ts`
- `src/services/sync/snapshot.ts`
- `src/services/sync/engine.ts`
- `src/services/sync/reducer.ts`
- `src/services/sync/api.ts`

现有链路：

```txt
Tiptap transaction
  -> MarkdownEditor 80ms debounce
  -> editor.getJSON()
  -> onChange(full TipTap JSON)
  -> EditorPage setContent(startTransition)
  -> useDocumentSync effect(content)
  -> captureContentSnapshot(content)
  -> advanceSyncSnapshot(previousSnapshot, content)
  -> deriveSyncEntries(previousSnapshot, normalizedContent)
  -> enqueueChange()
```

已有优化已经把每个 transaction 的 `getJSON()` 延后到 80ms 合并任务中。这说明新的 diff 引擎不需要先碰输入即时路径，应该先优化 `advanceSyncSnapshot()` 之后的同步准备。

## 4. 现有正确性约束

新的 diff 引擎必须保持这些行为：

1. 已有块内容变化生成 `update`。
2. 新块生成 `create`，并带稳定 `syncCreateId = sync-create:${clientId}`。
3. 已有块删除生成 `delete`。
4. 未发送 create 随后 delete，可以从 queue 中取消。
5. inflight create 随后 delete，必须转成 delete tombstone。
6. 已有块移动生成 `move`，并继续复用现有 LIS 最小移动策略。
7. 同一块同时内容变化和位置变化时，最终 entry 必须同时保留 payload 与 sortKey。
8. sync metadata-only 变化不能生成内容 update。
9. sortKey 腐化时继续抑制 existing move，避免把坏基线扩散成大批移动。
10. batch ack 回填后，snapshot、editor attrs、React content 三者不能再次失去 `blockId/sortKey`。

这些约束来自现有测试：

- `src/services/sync/__tests__/engine-order.test.ts`
- `src/services/sync/__tests__/snapshot.test.ts`
- `src/services/sync/__tests__/reducer.test.ts`
- `src/hooks/useDocumentSync.source.test.ts`

## 5. 总体方案

新增一个“索引化 snapshot + diff hint”的增量 diff 层：

```txt
MarkdownEditor transaction
  -> 生成 SyncDiffHint
  -> debounce 后 emit full JSON + hint
  -> EditorPage 用 ref 绑定 content 与 hint
  -> useDocumentSync captureContentSnapshot(content, hint)
  -> advanceSyncSnapshotIndexed(previousIndex, content, hint)
  -> 只对 dirty candidate 做 payload fingerprint
  -> 必要时才跑结构 diff 和 sortKey plan
```

核心变化：

1. snapshot 不再只有 `TiptapDoc`，还要维护顶层块索引。
2. 每个顶层块的 payload fingerprint 缓存在 snapshot index 中。
3. 编辑器 transaction 产生 dirty hint，标记本次变更涉及哪些块，以及是否可能有结构变化。
4. diff 引擎根据 hint 选择路径：
   - 内容变更路径：只比较 dirty 块 payload，不做全局 sort 规划。
   - 结构变更路径：扫描顶层 manifest 并复用现有 create/delete/move 规划，但只对 dirty 块做 payload 比较。
   - 无 hint / programmatic load 路径：回退到完整 diff，保证正确性。

## 6. 新数据结构

### 6.1 SyncDiffHint

建议新增到 `src/services/sync/types.ts` 或单独 `diff-hint.ts`：

```ts
export type SyncDiffHintSource =
  | "editor-transaction"
  | "programmatic"
  | "unknown";

export interface SyncDiffHint {
  source: SyncDiffHintSource;
  changedClientIds: string[];
  changedBlockIds: string[];
  structureChanged: boolean;
  identityChanged: boolean;
  reason?: string;
}
```

字段语义：

- `changedClientIds`：本次 transaction 影响的本地块身份。
- `changedBlockIds`：本次 transaction 影响的服务端块身份。
- `structureChanged`：顶层块数量、顺序、插入、删除、拆分、合并、拖拽等可能变化。
- `identityChanged`：本次 transaction 可能产生新 clientId 或修复身份。
- `reason`：调试用，记录 `text-edit`、`insert`、`delete`、`split`、`paste`、`unknown` 等。

### 6.2 SyncSnapshotIndex

建议新增到 `src/services/sync/block-index.ts`：

```ts
export interface IndexedSyncBlock {
  clientId: string;
  blockId: string | null;
  matchKey: string;
  node: TiptapNode;
  index: number;
  type: string;
  sortKey: string;
  payloadFingerprint: string | null;
}

export interface SyncSnapshotIndex {
  doc: TiptapDoc;
  blocks: IndexedSyncBlock[];
  byClientId: Map<string, IndexedSyncBlock>;
  byBlockId: Map<string, IndexedSyncBlock>;
  byMatchKey: Map<string, IndexedSyncBlock>;
  orderKey: string;
  sortKeyCorruptionReport: SortKeyCorruptionReport | null;
}
```

`orderKey` 可以是顶层块身份序列的轻量字符串，例如：

```txt
client:c1|block:b2|client:c3
```

它只用于快速判断顶层顺序是否变化，不参与服务端协议。

### 6.3 SyncDiffMetrics

用于测试和 trace：

```ts
export interface SyncDiffMetrics {
  mode: "content-hint" | "structure-hint" | "fallback-full";
  topLevelCount: number;
  dirtyCandidateCount: number;
  fingerprintCount: number;
  sortPlanRan: boolean;
  derivedEntryCount: number;
  durationMs: number;
}
```

不要用真实耗时作为测试断言。测试只断言 `fingerprintCount`、`sortPlanRan`、`mode`。

## 7. Diff Hint 生成

`MarkdownEditor` 当前已经能拿到 `transaction`。新增一个只读 transaction 的 helper：

```ts
function deriveTransactionSyncDiffHint(
  editor: Editor,
  transaction: Transaction,
): SyncDiffHint
```

建议逻辑：

1. 如果 `!transaction.docChanged`，返回空 hint。
2. 遍历 `transaction.mapping.maps` 的 changed ranges。
3. 从 `transaction.before` 的 old ranges 收集受影响的顶层块身份。
4. 从 `editor.state.doc` 的 new ranges 收集受影响的顶层块身份。
5. 如果 old/new 涉及多个顶层块、doc childCount 变化、range 横跨顶层块边界，标记 `structureChanged = true`。
6. 如果 `transactionMayNeedIdentityPatch()` 为 true，标记 `identityChanged = true`。
7. 如果无法可靠判断，返回 `structureChanged = true` 且 `reason = "unknown"`，交给结构 diff 兜底。

这里的目标不是完美分类，而是保守分类：

- 能确定只是某一个顶层块内部文本/mark/attrs 变化时，走 content hint。
- 只要有插入、删除、拆分、合并、粘贴、拖拽、未知 transaction，就走 structure hint。

### 7.1 onChange 传递方式

把 `MarkdownEditorProps.onChange` 扩展为：

```ts
onChange?: (content: EditorContentType, syncDiffHint?: SyncDiffHint) => void;
```

`EditorPage` 不把 hint 放进 React state，而是用 ref 绑定本次 content：

```ts
const syncDiffHintRef = useRef<{
  content: EditorContent;
  hint: SyncDiffHint;
} | null>(null);

const handleEditorChange = useCallback((nextContent, hint) => {
  if (hint) {
    syncDiffHintRef.current = { content: nextContent, hint };
  }
  contentRef.current = nextContent;
  startTransition(() => setContent(nextContent));
  ...
}, [...]);
```

`useDocumentSync` 新增可选参数：

```ts
consumeDiffHint?: (content: TiptapDoc) => SyncDiffHint | null;
```

`captureContentSnapshot()` 调用时消费 hint：

```ts
const hint = consumeDiffHint?.(nextContent) ?? null;
const advanced = advanceSyncSnapshotIndexed(current, previousIndex, nextContent, hint);
```

这样不会让高频 dirty metadata 触发额外 React render。

## 8. Diff 引擎路径

### 8.1 内容变更路径

适用条件：

- 有 hint。
- `structureChanged === false`。
- 有 changed clientId 或 blockId。
- 当前顶层 `orderKey` 与 previous index 相同。

流程：

1. 对 next doc 做轻量顶层 manifest 索引。
2. 用 hint 找出 dirty candidate。
3. 对每个 dirty candidate：
   - previous 不存在：生成 create。
   - next 不存在：生成 delete。
   - previous/next 都存在且 blockId 存在：计算 next payload fingerprint。
   - fingerprint 不同：生成 update。
4. 不运行 `planDesiredSortKeys()`。
5. 不对未命中 dirty candidate 的块计算 payload fingerprint。
6. 仍运行 cheap live-key reconciliation，清理已经从当前 snapshot 消失的 pending 非 delete entry。

预期复杂度：

```txt
O(n attrs scan) + O(k payload stringify)
```

其中 `n` 是顶层块数，`k` 是变动块数。普通输入时 `k = 1`。

### 8.2 结构变更路径

适用条件：

- `structureChanged === true`。
- 或顶层 `orderKey` 与 previous index 不同。
- 或 hint 缺失但 next/prev 顶层数量不同。

流程：

1. 构建 next 顶层 manifest index。
2. 复用现有 `allocateCreateSortKeys()`、`planDesiredSortKeys()`、sortKey corruption 检测。
3. 生成 create/delete/move。
4. payload update 只对以下块计算 fingerprint：
   - hint 指定的 dirty candidate。
   - 新 create 块。
   - 无 hint 时的全部 existing 块。
5. 对 moved but payload unchanged 的块，只生成 move。
6. 对 moved and payload changed 的块，仍通过 reducer 合并为单个 entry，保留 payload + sortKey。

预期复杂度：

```txt
O(n order planning) + O(k payload stringify)
```

结构变化本身必须看全局顺序，所以保留 O(n) 是合理的。关键是避免对所有未改内容块做深层 stringify。

### 8.3 回退完整路径

适用条件：

- 没有 previous index。
- programmatic load / local recovery / discard draft / checkpoint ack patch 后状态不可信。
- hint 与当前 content 不是同一个对象。
- hint 为空且无法用 orderKey 快速证明结构不变。
- diff 引擎发现 identity 缺失或重复，需要 full normalize。

流程：

1. 调用兼容路径，行为等价于现有 `deriveSyncEntries()`。
2. 生成新的 indexed snapshot。
3. trace 标记 `mode = "fallback-full"`。

第一版宁可多回退，也不能漏 diff。

## 9. Fingerprint 策略

现有 `payloadFingerprint()` 会 normalize payload 并删除 sync attrs：

- `blockId`
- `clientId`
- `sortKey`
- `syncCreateId`
- `clientBatchId`
- `data-*`

新引擎继续沿用这个语义，但要缓存结果。

规则：

1. previous index 中每个 block 持有上一次 payload fingerprint。
2. next block 只有在 dirty candidate 或 fallback full 时才计算 fingerprint。
3. 如果 update 发送成功并被 ack 清理，下一次 snapshot index 使用 ack patch 后的 fingerprint。
4. sync metadata-only patch 不应该让 payload fingerprint 变化。
5. `plainText` 只在确定生成 update 后调用 `extractPlainText()`。

这样普通文本输入从“全量 stringify 每个 block”变成“只 stringify 当前 block”。

## 10. Snapshot 推进

新增 `advanceSyncSnapshotIndexed()`：

```ts
export function advanceSyncSnapshotIndexed(
  state: SyncReducerState,
  previousIndex: SyncSnapshotIndex | null,
  content: TiptapDoc,
  hint?: SyncDiffHint | null,
): {
  state: SyncReducerState;
  snapshot: TiptapDoc;
  index: SyncSnapshotIndex;
  metrics: SyncDiffMetrics;
}
```

兼容策略：

1. 保留现有 `advanceSyncSnapshot()` 作为 wrapper，内部可以调用 indexed 版本。
2. `useDocumentSync` 新增 `snapshotIndexRef`。
3. 初始化文档时同时设置 `snapshotRef` 和 `snapshotIndexRef`。
4. checkpoint 成功后用 patched doc 重建 full index。
5. ack patch 后用 patched snapshot 重建 index，但不需要生成 diff。

`applyLocalSortKeys()` 继续保留。新 create 的 sortKey 必须写回 snapshot/index，否则后续连续输入和创建新块仍会重复计算或碰撞。

## 11. Trace 与调试

扩展现有 `snapshot:advance` trace payload：

```ts
{
  prevNodeCount,
  nextNodeCount,
  nextManifest,
  derivedEntryCount,
  dirtyOrderLength,
  diff: {
    mode,
    dirtyCandidateCount,
    fingerprintCount,
    sortPlanRan,
    durationMs
  }
}
```

新增可选事件：

```txt
diff:fallback
```

触发条件：

- hint 缺失。
- hint 与 content object 不匹配。
- identity 不可信。
- index/orderKey 不一致但 hint 声称非结构变化。

这能在真实大文档联调时快速判断是否真的走到了按需 diff，而不是一直回退 full diff。

## 12. 测试计划

### 12.1 单元测试

新增：

- `src/services/sync/__tests__/block-index.test.ts`
- `src/services/sync/__tests__/block-diff.test.ts`

重点用例：

1. 5000 个 paragraph 中只编辑 1 个块：
   - `mode = "content-hint"`
   - `fingerprintCount = 1`
   - `sortPlanRan = false`
   - 只生成 1 个 update

2. 5000 个 paragraph 中间插入 1 个新块：
   - `mode = "structure-hint"`
   - 生成 1 个 create
   - unchanged existing blocks 不生成 update
   - sortKey 位于前后块之间

3. tail block 移动到 front：
   - 复用现有 LIS 语义
   - 只生成必要 move
   - 不对全部块生成 update

4. 已有块被删除：
   - 生成 delete
   - pending create/delete 语义继续由 reducer 压缩

5. 同一块内容变化 + 移动：
   - entries 经 reducer 后保留 payload + sortKey

6. sync metadata-only patch：
   - 不生成 update

7. hint 缺失：
   - fallback full
   - 输出与现有 `deriveSyncEntries()` 对同一 fixture 一致

8. hint 声称 content-only，但 orderKey 变化：
   - 强制转 structure path 或 fallback
   - trace `diff:fallback`

### 12.2 Source contract 测试

扩展：

- `src/hooks/useDocumentSync.source.test.ts`
- `src/components/__tests__/sync-session-plumbing.source.test.ts`

验证：

1. `useDocumentSync` 持有 `snapshotIndexRef`。
2. `captureContentSnapshot()` 会消费 diff hint。
3. diff hint 通过 ref 传递，不进入 React state。
4. `commit/checkpoint/reconcile/session` 现有语义不被改动。

### 12.3 现有回归集

至少跑：

```powershell
pnpm vitest run src/services/sync/__tests__/engine-order.test.ts src/services/sync/__tests__/snapshot.test.ts src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/batching.test.ts src/hooks/useDocumentSync.source.test.ts src/services/__tests__/document-commit-api.test.ts
pnpm build
```

如果实现触碰 `MarkdownEditor.tsx`，追加：

```powershell
pnpm vitest run src/modules/editor-kit/__tests__/identity-selection.test.ts src/modules/editor-kit/__tests__/editorContentNormalization.test.ts
```

## 13. 分阶段落地

### Phase 1：纯 service 层 indexed diff

目标：

- 新增 block index 和 indexed diff。
- 不接入 `MarkdownEditor` hint。
- `advanceSyncSnapshot()` 内部先用 indexed full/fallback 路径。
- 用 metrics 证明 fallback full 行为与现有 `deriveSyncEntries()` 一致。

交付：

- `block-index.ts`
- `block-diff.ts`
- indexed diff tests

这一步主要是把算法边界做稳。

### Phase 2：接入 editor transaction hint

目标：

- `MarkdownEditor` 生成并合并 `SyncDiffHint`。
- `EditorPage` 用 ref 绑定 content 和 hint。
- `useDocumentSync` 消费 hint。
- 普通文本输入走 `content-hint`。

交付：

- `MarkdownEditor.tsx`
- `EditorPage.tsx`
- `useDocumentSync.ts`
- source tests

这一步开始产生真实性能收益。

### Phase 3：诊断与大文档验证

目标：

- trace 中暴露 diff metrics。
- 手动构造 5k/10k block 文档验证普通输入不再 full payload diff。
- 确认弱网保存、session recovery、manual checkpoint 仍走通。

交付：

- debug trace 扩展
- 大文档 fixture 或测试 helper
- 验证复盘

## 14. 风险与防线

### 14.1 漏删风险

风险：hint 错误地把结构变化标成内容变化，导致删除未被枚举。

防线：

- 每次仍做顶层 manifest scan。
- content path 必须检查 `orderKey`。
- `orderKey` 不一致时强制 structure/fallback。
- `reconcilePendingEntriesWithSnapshot()` 继续清理当前 snapshot 不存在的 pending entry。

### 14.2 漏 move 风险

风险：纯 dirty block diff 看不到全局相对顺序变化。

防线：

- 任何 childCount 变化、range 跨顶层块、拖拽/replaceAround/未知 step 都标 structure。
- content path 禁止运行在 orderKey 变化时。
- 现有 move tests 必须继续通过。

### 14.3 identity 风险

风险：跳过 full normalize 后，缺失 clientId 的块进入 diff。

防线：

- `MarkdownEditor` 的 identity patch 仍在 emit 前执行。
- hint 标记 `identityChanged` 时走 structure/fallback。
- indexed diff 发现顶层块缺少 clientId 时强制 fallback full。
- fallback 仍调用现有 `ensureDocumentIdentity()`。

### 14.4 ACK 竞态风险

风险：ack patch 后 index 仍持旧 fingerprint，后续 diff 误判。

防线：

- `applyServerAck()` 和 checkpoint ack 后重建 index。
- `onContentPatched()` 返回 applied doc 后立即 `captureContentSnapshot(applied)` 或直接重建 index。
- source test 固定该行为。

### 14.5 性能指标误判

风险：看起来接了 hint，但实际一直 fallback full。

防线：

- metrics 进入 trace。
- source test 检查普通 editor change 能传 hint。
- 大文档单元测试断言 `fingerprintCount`。

## 15. 最终设计判断

按当前代码结构，最合理的改造不是先改后端协议，也不是绕开 TipTap JSON emission，而是在 `advanceSyncSnapshot()` 处引入 indexed diff，并通过 editor transaction hint 把 payload diff 范围缩到变动块。

第一版可以接受每次轻量扫描顶层 manifest，因为它同时承担 delete/move/session debug 的事实基础。真正必须消掉的是“每次都深层 stringify 所有块”。这样能在不牺牲现有同步稳定性的前提下，把普通大文档输入后的同步准备成本从整篇 payload 级别降到单块 payload 级别。

## 16. 当前实现状态

本设计已开始落地，当前实现覆盖：

1. `src/services/sync/types.ts`
   - 新增 `SyncDiffHint`
   - 新增 `SyncDiffMetrics`

2. `src/services/sync/engine.ts`
   - 新增 `createSyncSnapshotIndex()`
   - 新增 `deriveSyncEntriesWithMetrics()`
   - 保留 `deriveSyncEntries()` 兼容旧调用
   - `content-hint` 路径只对 dirty candidate 做 payload fingerprint
   - `structure-hint` 路径保留 sort/order 规划，但跳过未变块 payload diff
   - hint 缺失或身份不可信时回退 `fallback-full`

3. `src/services/sync/snapshot.ts`
   - 新增 `advanceSyncSnapshotIndexed()`
   - 旧 `advanceSyncSnapshot()` 继续保留
   - snapshot 推进时返回 index 和 metrics

4. `src/modules/editor-kit/MarkdownEditor.tsx`
   - transaction 阶段生成 conservative `SyncDiffHint`
   - 80ms debounce 内合并多次 transaction hint
   - `onChange(content, syncDiffHint)` 随完整 JSON 一起发出

5. `src/components/EditorPage.tsx`
   - 用 ref 暂存 content 对应的 hint
   - 只在同一个 content object 被 `useDocumentSync` 消费时传入 hint

6. `src/hooks/useDocumentSync.ts`
   - 增加 `snapshotIndexRef`
   - 初始化、checkpoint ack、batch ack 后维护 index
   - `snapshot:advance` trace 增加 diff metrics

7. 测试覆盖
   - `src/services/sync/__tests__/block-diff.test.ts`
   - `src/modules/editor-kit/MarkdownEditor.source.test.ts`
   - `src/hooks/useDocumentSync.source.test.ts`

当前已验证的关键性能语义：

- 5000 个顶层块中只编辑 1 个块时，`content-hint` 路径只计算 1 次 payload fingerprint。
- 中间插入新块时，`structure-hint` 会运行 sort plan，但不会 payload-diff 未变块。
- hint 声称 content-only 但实际顺序变化时，会自动升级到 `structure-hint`。
- hint 缺失时保留 `fallback-full`，继续维持原有正确性。

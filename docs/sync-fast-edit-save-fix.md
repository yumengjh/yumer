# 快速编辑保存丢失更新修复说明

## 背景

富文本编辑器启用同步引擎后，用户在输入较快、频繁使用 Markdown 语法转换，或在多个块之间快速跳转编辑时，偶尔会出现点击“保存”后内容被自动改回旧状态的问题。

这次问题的核心表现不是编辑器 UI 没有接收输入，而是 UI 层已经展示了最新内容，但同步队列在某些时序下没有完整保留这些最新变更。手动保存随后会触发 flush、commit 和重新加载服务端内容，于是未同步到后端的局部编辑被服务端旧内容覆盖，用户看到的结果就是“保存后自动修改了我刚改好的内容”。

## 根因分析

### 1. inflight 批次确认会误删同一块的新编辑

原同步 reducer 使用 `clientId` 作为 dirty entry 的合并键。同一个块发生多次编辑时，后来的更新会合并到同一个 entry 中。

问题发生在以下时序：

1. 块 A 的旧内容变更进入 dirty 队列。
2. autosync 将块 A 的 update 发送到后端，entry 进入 inflight 状态。
3. 请求尚未返回时，用户继续修改块 A。
4. 新修改仍然合并到同一个 `clientId` entry。
5. 旧请求 ACK 返回后，旧逻辑按 `clientId` / `blockId` 直接删除该 entry。
6. 第 3 步产生的新修改也被一起删除，后续保存不会再发送它。

这正好符合“输入太快、后台同步没跟上、点击保存后部分修改丢失”的体验。

### 2. 手动保存前没有强制捕获编辑器当前快照

同步队列主要通过 React state / effect 从 `content` 派生 dirty entries。正常输入时这个路径可用，但如果用户在编辑器 UI 刚更新后立刻点击保存，存在一个短暂窗口：

- TipTap 内部文档已经是最新；
- React state 或同步派生 effect 还没完全推进；
- 手动保存开始 flush 时看到的 dirty 队列可能不是最新。

因此手动保存不能只依赖“后台已经派生好的同步队列”，需要在保存屏障前主动读取编辑器当前 JSON，并同步推进快照差异。

## 修复内容

### reducer 增加 revision 保护

相关文件：

- `src/services/sync/types.ts`
- `src/services/sync/reducer.ts`

每个 `SyncEntry` 新增 `revision`。每次 `enqueueChange` 都会推进本地 revision，并把该 revision 写入 entry。

flush 开始时，`markBatchInflight` 会记录本批次每个 entry 的 `inflightEntryRevisions`。ACK 返回后，只有当当前 entry 的 revision 仍等于 inflight 时记录的 revision，才允许清理该 entry。

如果 ACK 返回时 entry revision 已经变化，说明请求发送后用户又编辑了同一块，这个 entry 必须保留为 dirty，等待下一次 flush。

### create ACK 期间的后续编辑/删除处理

新建块在 create 请求发送时还没有服务端 `blockId`。如果 create inflight 期间用户继续编辑或删除该块，ACK 返回后需要把服务端分配的 `blockId` 回填到后续操作里。

本次修复覆盖两种场景：

- create inflight 期间继续编辑：ACK 后将 pending entry 转为后续 `update`，并写入服务端 `blockId`。
- create inflight 期间删除：ACK 后将 pending entry 转为后续 `delete`，并写入服务端 `blockId`。

这样可以避免“新块刚创建又快速修改/删除”时出现无 blockId 导致的遗漏。

### 抽出同步快照推进逻辑

新增文件：

- `src/services/sync/snapshot.ts`

新增 `advanceSyncSnapshot`，用于把“上一份快照 + 当前编辑器快照”同步转换成 dirty entries。

这个逻辑从 hook 中抽出后，可以单独测试，也方便手动保存时立即复用，而不是只能等待 React effect 异步执行。

### 手动保存前读取 TipTap 当前 JSON

相关文件：

- `src/components/EditorPage.tsx`
- `src/hooks/useDocumentSync.ts`

点击保存时，页面会通过 `editorRef.current?.getJSON()` 读取 TipTap 当前真实文档。如果返回的是 `doc`，会把这份最新 JSON 传给 `flushAndCommitBarrier`。

`flushAndCommitBarrier` 在真正 flush 前会先调用快照推进逻辑，把最新编辑器内容立即纳入 dirty 队列。这样手动保存不再依赖后台 autosync effect 是否已经追上。

### 同步状态 ref 与 React state 保持同步

`useDocumentSync` 内部原先通过 effect 把 `syncState` 同步到 `stateRef`。在高频输入和保存屏障场景下，这会引入额外一拍延迟。

本次修复增加统一的状态写入方法：

- `replaceSyncState`
- `updateSyncState`

所有同步状态变更都会先写入 `stateRef.current`，再写 React state。flush 和保存屏障读取 `stateRef` 时可以拿到最新状态机结果。

## 回归测试

新增/扩展测试文件：

- `src/services/sync/__tests__/reducer.test.ts`
- `src/services/sync/__tests__/snapshot.test.ts`

重点覆盖：

1. 旧 update inflight 期间继续编辑同一块，ACK 后新编辑必须保留为 dirty。
2. create inflight 期间继续编辑，新编辑必须转为带服务端 blockId 的后续 update。
3. create inflight 期间删除，新删除必须转为带服务端 blockId 的后续 delete。
4. 初始快照不会错误入队。
5. 当前快照与上一快照的差异可以被同步派生为 dirty entry。

## 验证结果

本次修复后已执行：

```bash
pnpm test:unit
pnpm exec tsc --noEmit
pnpm build
```

结果均通过。

另外对本次涉及的同步相关文件执行了定向 ESLint 检查并通过。

全量 `pnpm lint` 当前仍会失败，但失败主要来自仓库已有的 `.worktrees/.next` 生成物和其它既有 lint 问题，不属于本次同步修复引入。

## 影响范围

主要影响前端同步状态机与保存屏障：

- 不改变后端 batch API 协议。
- 不改变文档块 payload 格式。
- 不改变 autosync 的触发间隔。
- 不改变 commit version 的后端语义。

## 后续观察点

虽然这次已经修复了最主要的“快速编辑 + 保存导致旧 ACK 覆盖新编辑”问题，但用户反馈仍可能存在小细节。后续可以继续观察：

1. 多块快速拖拽、删除、输入混合操作时，块顺序是否需要更强的 sortKey / move 语义。
2. 手动保存期间如果 autosync 正在 inflight，是否需要等待当前 inflight 完成后自动再 flush 一轮，而不是只返回当前状态。
3. 保存后重新 loadContent 会重建外部 content，仍可能造成轻微光标或选择区扰动，需要结合具体复现场景继续优化。

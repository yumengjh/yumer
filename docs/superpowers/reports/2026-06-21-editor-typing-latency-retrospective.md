# 编辑器输入延迟深度优化复盘

> 日期：2026-06-21
> 仓库：`F:\yuediter`
> 基准文档：326～328 个顶层块，其中约 46～47 个代码块
> 初始设计：`docs/superpowers/specs/2026-06-20-editor-typing-latency-design.md`
> 初始实施计划：`docs/superpowers/plans/2026-06-20-editor-typing-latency.md`
> 最终状态：普通输入热路径已从数百毫秒降到一帧以内；同步准备与调试追踪不再形成长任务。

## 1. 摘要

本次优化最初由一个非常明确的体验问题触发：在大文档中输入文字后，字符和相关 UI 往往要约半秒才更新。用户同时指出，不能只盯着代码块高亮或 Block Diff，因为纯文字输入同样卡顿。

最终调查证明，这不是单一算法慢，而是多个层次的工作被叠加到了同一个输入周期中：

1. 本地输入生成的完整 JSON 曾被当作受控 `content` 再次回灌编辑器，放大 React 更新并增加内容时序风险。
2. 工具栏、查找替换、列表排版 decorations 等辅助功能对高频 transaction 存在不必要的事件扇出和扫描。
3. 最主要的渲染瓶颈来自 Tiptap React NodeView 的位置检查机制：在文档前部输入时，后方几十个代码块位置变化，46 个代码块 NodeView 会一起进入 React 更新。
4. 代码块问题解决后，autosync 仍有约 175ms 的定时器长任务；进一步拆分发现，业务同步计算不足 1ms，真正的成本是调试追踪每次同步读写、解析、序列化整份 `sessionStorage`。

最终方案没有关闭同步、没有粗暴增加输入 debounce，也没有把整个同步引擎重写到 Worker。修复集中在四个原则：

- ProseMirror 继续作为即时编辑事实源；
- React 只接收非紧急的派生状态，不把本地输出重新当作外部输入；
- NodeView 与辅助 UI 只在语义内容确实变化时更新；
- 调试与持久化工作不得阻塞编辑和 autosync 热路径。

最终日志 `localhost-1782038949958.log` 显示：

- `MarkdownEditor.handleUpdate`：0～0.3ms；
- `MarkdownEditor.flushPendingChange`：0.8～1.6ms；
- 活跃编辑阶段的 `EditorContent` 提交：约 1.7～11.2ms；
- `BlockToolbar.transactionFrame`：0～0.1ms；
- `documentSync.flushTracePersist`：0.1～0.3ms；
- `documentSync.flushPrepare`：通常 0.8～1.3ms，样本最大值 8.3ms；
- 没有与本轮输入对应的 `input` 或 `setTimeout` 长任务。

## 2. 初始症状与约束

### 2.1 用户可见症状

- 普通文字和代码块输入都存在明显延迟；
- 按键后字符不是立即出现，而是约 0.5 秒后集中更新；
- 开发者控制台可见 300～500ms 的 rAF 长任务和 forced reflow；
- 在中间修复阶段一度出现无限 Diff、持续网络请求和内容重复；
- 内容重复的典型表现是每个块从 `123` 变成 `112233`；
- 一次 React memo 尝试在 Fast Refresh 后触发 `Component is not a function`。

### 2.2 不能接受的“优化”

本轮明确拒绝以下方式：

1. 关闭 autosync 或延长到用户明显可感知的保存延迟；
2. 用更大的全局 debounce 掩盖输入链路问题；
3. 忽略 ACK、远端替换和本地恢复的内容时序；
4. 为减少渲染而跳过真正的节点、decorations 或工具栏状态变化；
5. 把 Block Diff 直接认定为根因而不测量 React、NodeView、布局和 Storage。

## 3. 初始证据：Block Diff 不是主要瓶颈

最早的运行日志 `localhost-1781963518314.log` 包含以下信息：

- 单块普通输入走 `sync:diff:FAST`；
- `mode` 为 `content-hint`；
- `dirtyCandidates` 通常只有 1；
- 同期却出现 392ms、467ms、485ms 的 `requestAnimationFrame` 长任务；
- forced reflow 最高达到 345ms。

这组证据非常重要：它说明同步 Diff 已经知道“只改了一个块”，但 UI 线程仍然做了数百毫秒工作。也就是说，块级 Diff 的输入规模不是当时的主导成本。

后续性能标签进一步确认：

- `MarkdownEditor.handleUpdate` 通常仅 0.1～0.4ms；
- 328 块文档的 `editor.getJSON()` 通常约 1ms；
- `flushPendingChange` 通常 1～2ms；
- BlockToolbar 自身单次渲染通常不足 1ms。

因此调查方向从“继续压缩 Diff”转向“找到是谁在一次 transaction 后触发了大规模 React/NodeView 工作”。

## 4. 调查与修复过程

### 4.1 第一阶段：降低输入事件扇出

这一阶段先处理确定存在、且不会改变业务语义的热路径问题。

#### 4.1.1 按 touched range 收集同步身份

`MarkdownEditor` 原有逻辑在构造 SyncDiffHint 时可能遍历所有顶层块。现在改为：

- 非空变化范围使用 `doc.nodesBetween(from, to)`；
- 光标点变化通过 resolved position 直接定位顶层节点；
- 只收集 transaction 实际触达的 `clientId` / `blockId`；
- 不使用 idle queue，保持 80ms 有序内容发射。

这让 Diff hint 继续保持准确，同时避免每次按键都扫描 300 多个块。

#### 4.1.2 列表排版 decorations 缓存

`ListTypography` 从每次读取 decorations 时执行 `doc.descendants()`，改为插件 state 持有 `DecorationSet`：

- 初始化时构建 decorations；
- 非文档 transaction 只映射旧 decorations；
- 文档变化后重建；
- 顶层纯文本块直接跳过，不进入 descendants 扫描；
- 递归只进入 list item 与 list container。

这不是最终最大瓶颈，但移除了纯文字输入中一个没有必要的全篇扫描。

#### 4.1.3 辅助 UI 降噪

- BlockToolbar：transaction 合并到单个 rAF；当前 hover 目标仍在 DOM 中时立即返回，只在目标被删除或脱离时执行 fallback。
- FloatingSelectionToolbar：`selectionUpdate`、`transaction`、scroll、resize 合并到一帧；隐藏状态幂等，不重复 `setState`。
- FindReplace：面板关闭或 query 为空时不订阅每次 editor update；激活时同一帧只搜索一次。
- Local Snapshot：hash、build、write 增加边界计时，用证据排除快照链路。

用户指出左侧六点浮动工具栏会随着 hover 自动跟踪块位置，日志确实显示大量 BlockToolbar render；但测量结果通常为 0.2～1ms，transaction frame 为 0～0.1ms。它解释了“为什么日志很多”，却解释不了 300～500ms 的输入延迟。

### 4.2 第二阶段：隔离外部内容与本地实时内容

`EditorPage` 过去只有一个 `content` state，它同时承担：

1. 外部加载/远端替换/ACK 修补后传给 Tiptap 的受控输入；
2. 本地按键后供同步、快照、输出预览使用的实时 JSON。

这两个职责合并后，本地输入会形成如下反馈环：

```text
ProseMirror transaction
  -> getJSON / onChange
  -> React setContent
  -> MarkdownEditor content prop 改变
  -> 外部内容同步 effect 再检查或写回 editor
```

最终实现将它拆为：

- `content`：只代表显式外部内容源，用于加载、远端应用、ACK identity patch、恢复和手动替换；
- `liveContent`：本地输入后的最新 JSON，供 autosync、local snapshot、导出和保存 barrier 使用；
- `contentRef`：同步保存最新编辑内容，供回调与 ACK 竞态读取；
- `replaceContent()`：需要同时替换编辑器与实时状态时的唯一入口。

普通本地输入只在 `startTransition()` 中更新 `liveContent`，不再改变传给 MarkdownEditor 的 `content` prop。这样 ProseMirror 的 DOM 输入反馈不等待页面级 React 内容回灌。

### 4.3 中间回归：无限 Diff 与 `123 -> 112233`

在隔离内容状态的中间版本中，曾出现两个严重回归：

- autosync 不断生成 Diff 并持续发送请求；
- 输入 `123` 后块内容变成 `112233`。

这类表现说明问题已经不是单纯慢，而是同一编辑事实被重复应用。修复策略不是继续 debounce，而是重新明确时序 invariant：

1. 本地 transaction 只在 ProseMirror 中应用一次；
2. 本地发出的 JSON 只更新 `liveContent`，不得作为新的外部 `content` 回灌；
3. editor-effect snapshot 必须立即捕获，不能再套一层可能落后于 autosync timer 的延迟；
4. ACK/远端内容必须通过 `replaceContent()` 显式进入外部替换路径；
5. SyncDiffHint 与对应 JSON 必须在同一个 80ms 发射批次中有序提交。

修正后，无限 Diff 停止，内容不再重复。

### 4.4 失败尝试：`memo(forwardRef)` 与 Fast Refresh

初始计划建议把 MarkdownEditor 改成：

```text
forwardRef component -> memo(component) -> default export
```

这一做法在静态分析上合理，但当前 Next/React Fast Refresh 环境中触发了 `Component is not a function`。因此最终没有保留该包装方式。

最终替代方案是：

- MarkdownEditor 继续直接导出稳定的 `forwardRef` 组件；
- `EditorPage` 使用 `useMemo()` 缓存完整的 `<MarkdownEditor />` element；
- style、callbacks 和 item sets 均保持稳定依赖；
- 只有真正影响编辑器外部输入或配置的依赖改变时才创建新 element。

这次回归说明：性能边界不能只看理论上的 memo 形态，还要验证框架热更新、ref 类型和运行时组件身份。

### 4.5 第三阶段：Profiler 将根因收敛到代码块 NodeView

仅看 `EditorPage.MarkdownEditor.render` 时，曾看到 424.9ms、540.6ms 的提交，但仍无法知道编辑器子树内是谁最慢。为此加入分层可观测性：

- EditorPage 的 MarkdownEditor 边界；
- Toolbar、FloatingSelectionToolbar、EditorContent、BlockToolbar、LinkToolbar、TOC；
- TaskItem、HighlightBlock、ImageBlock、CodeBlock 四类 React NodeView；
- NodeView 样本使用 microtask 聚合，避免每个实例单独打印日志反过来制造卡顿。

`localhost-1782035222384.log` 给出了决定性证据：

- `EditorContent.render` 最高 345ms；
- CodeBlock NodeView 一次输入聚合消耗约 240ms；
- 文档中有约 46 个 React 代码块 NodeView；
- 普通输入时这些代码块即使内容没变，也会批量重新进入 React render。

这解释了为什么“纯文字也卡”：只要在代码块之前输入，后方代码块的文档位置都会变化。

### 4.6 最核心根因：Tiptap 的 position check 独立于 NodeView update

第一反应是给 `ReactNodeViewRenderer` 提供自定义 `update`，在 node/decorations/innerDecorations 引用未变化时跳过 `updateProps()`。但运行验证表明，这不足以解决问题。

原因是 Tiptap 3.23.1 的 React NodeView 还有一条独立路径：

```text
schedulePositionCheck
  -> 检测 getPos() 变化
  -> updateProps()
  -> React NodeView render
```

即使 ProseMirror 的 NodeView `update` 已经决定“不需要更新 props”，位置注册表仍会因为前方文本长度变化而通知所有后方 NodeView。因此单纯定制 `update` 没有命中真正触发源。

最终修复包括两层：

1. `skipPositionOnlyNodeViewUpdate()`：仅当 node、decorations 或 innerDecorations 引用真正变化时调用 `updateProps()`；
2. `PositionStableReactNodeView`：继承 `ReactNodeView`，在 `mount()` 后取得 Tiptap 注册的 `positionCheckCallback`，调用 `cancelPositionCheck()` 注销位置变化驱动的 React 更新，并清空内部 callback 引用。

代码块的 DOM 位置仍由 ProseMirror 管理；取消的是“位置数字变化就重新渲染整个 React NodeView”的附加机制。代码块内容、attrs、decorations 变化仍正常触发更新。

`localhost-1782035806288.log` 验证了这一点：

- 13 次输入 transaction 中，代码块聚合 render 只出现在初始文档挂载；
- 输入阶段没有 46 个代码块一起 render；
- `handleUpdate` 最大 0.4ms；
- `flushPendingChange` 最大 1.8ms；
- 用户反馈输入延迟“大幅优化，现在舒服多了”。

### 4.7 第四阶段：autosync 的 175ms 不是同步算法

代码块根因解决后，日志仍有约 181～183ms 的 `setTimeout` 长任务。新标签将 autosync 拆成：

- rebase pending create；
- select batch operations；
- dispatch console log；
- queue trace persistence；
- flush trace persistence；
- mark inflight reducer；
- replace React sync state；
- request setup。

`localhost-1782036473513.log` 显示：

- `documentSync.flushPrepare`：175.2～177.9ms；
- rebase：0～0.2ms；
- select：0～0.1ms；
- request setup：0.4～1.6ms。

进一步拆分后的 `localhost-1782037216564.log` 最终确认：

- `flushQueueTracePersist`：34.7～36.9ms；
- `flushTracePersist`：31.5～33.8ms；
- reducer 与 state replace：0～0.2ms；
- 两次调试 trace 写入合计约 68～70ms。

调试追踪原实现每增加一条记录都会同步执行：

```text
sessionStorage.getItem
  -> JSON.parse 全部历史记录
  -> push 新记录
  -> JSON.stringify 全部记录
  -> sessionStorage.setItem
```

trace 最多保留 800 条，并且记录可能包含 manifest 摘要。开发者控制台开启同步调试后，这条诊断链路本身成为 autosync 的主要长任务。

最终改为：

- 首次读取后在模块内缓存 trace records；
- `SyncTraceLog.add()` 只做内存 append；
- 连续追加会重置 3 秒持久化 timer；
- 用户停止操作后才合并序列化并写入一次 `sessionStorage`；
- `getAll()` 与导出直接读取内存缓存；
- `clear()` 同时取消待执行持久化并清理缓存。

最终日志中 `flushTracePersist` 降到 0.1～0.3ms，`flushPrepare` 通常降到 0.8～1.3ms。

## 5. 最终数据流

### 5.1 本地输入

```text
keydown / beforeinput
  -> ProseMirror transaction（即时更新 DOM）
  -> MarkdownEditor.handleUpdate
       - 判断 identity patch 必要性
       - 从 touched ranges 生成 SyncDiffHint
       - 合并到 80ms 有序发射队列
  -> editor.getJSON()
  -> EditorPage.handleEditorChange
       - contentRef 立即更新
       - liveContent 通过 startTransition 更新
       - content prop 保持不变
  -> indexed snapshot diff
  -> autosync flush
```

### 5.2 外部内容替换

```text
文档加载 / 远端内容 / ACK identity patch / 本地恢复
  -> replaceContent(next)
       - contentRef = next
       - setLiveContent(next)
       - setContent(next)
  -> MarkdownEditor 收到新的外部 content prop
  -> 显式替换或 identity patch
```

### 5.3 代码块 NodeView

```text
前方普通文本长度改变
  -> ProseMirror 更新代码块 DOM 位置
  -> 不再通过 Tiptap position registry 更新 React props

代码块自身 node / attrs / decorations 改变
  -> skipPositionOnlyNodeViewUpdate 检测引用变化
  -> updateProps
  -> React CodeBlockView render
```

### 5.4 调试 trace

```text
autosync event
  -> memory append（热路径）
  -> 重置 3 秒 timer
  -> 静默期后一次性 JSON.stringify + sessionStorage.setItem
```

## 6. 主要代码变更

### 6.1 编辑器内容与渲染边界

| 文件 | 变更 |
| --- | --- |
| `src/components/EditorPage.tsx` | 拆分 `content` / `liveContent`；增加 `replaceContent()`；本地输入只更新 live state；缓存 MarkdownEditor element；增加 Profiler 与变更耗时标签。 |
| `src/components/__tests__/editor-live-content.source.test.ts` | 固化“本地输入不回灌受控 content”和显式替换入口。 |
| `src/modules/editor-kit/MarkdownEditor.tsx` | touched-range identity、80ms 有序发射、transaction/getJSON 计时、编辑器子树 Profiler。 |
| `src/modules/editor-kit/MarkdownEditor.source.test.ts` | 覆盖 Fast Refresh 安全导出、范围扫描和禁止 idle queue。 |

### 6.2 NodeView 与 decorations

| 文件 | 变更 |
| --- | --- |
| `src/modules/editor-kit/nodeViewUpdate.ts` | 新增 position-only update guard。 |
| `src/modules/editor-kit/nodeViewUpdate.test.ts` | 验证位置变化不更新 props，node/decorations 变化仍更新。 |
| `src/modules/editor-kit/code/shikiCodeBlock.ts` | 自定义 `PositionStableReactNodeView`，注销 Tiptap position check。 |
| `src/modules/editor-kit/code/CodeBlockView.tsx` | 增加聚合 Profiler 样本。 |
| `src/modules/editor-kit/TaskItemView.tsx` | 增加 TaskItem NodeView 聚合样本。 |
| `src/modules/editor-kit/HighlightBlockView.tsx` | 增加 HighlightBlock NodeView 聚合样本。 |
| `src/modules/editor-kit/ImageBlockView.tsx` | 增加 ImageBlock NodeView 聚合样本。 |
| `src/modules/editor-kit/extensions/listTypography.ts` | decorations 进入 plugin state，纯文本跳过 descendants。 |

### 6.3 辅助 UI

| 文件 | 变更 |
| --- | --- |
| `src/modules/editor-kit/BlockToolbar/index.tsx` | transaction 单帧合并；连接目标早返回；仅 detached target fallback。 |
| `src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.tsx` | 事件单帧合并；visibility 幂等；cleanup pending rAF。 |
| `src/components/FindReplaceBar/useFindReplace.ts` | 仅 active + non-empty query 时响应文档 update。 |
| `src/components/FindReplaceBar/index.tsx` | 将 visible 生命周期传给 hook。 |

### 6.4 同步、快照与诊断

| 文件 | 变更 |
| --- | --- |
| `src/hooks/useDocumentSync.ts` | autosync prepare 分段计时；request setup 与 await 网络响应分离。 |
| `src/hooks/useDocumentSync.source.test.ts` | 固化即时 editor-effect capture 和同步分段标签。 |
| `src/hooks/useLocalDocumentSnapshot.ts` | hash/build/write 性能边界。 |
| `src/services/sync/debug-log.ts` | trace 内存缓存与 3 秒合并持久化。 |
| `src/services/sync/__tests__/debug-log.test.ts` | 证明 `add()` 不同步写 Storage，timer 到期后才持久化。 |
| `src/modules/editor-kit/perfTrace.ts` | 开发环境默认可见、生产默认关闭；支持耗时标签和 NodeView 样本聚合。 |
| `src/modules/editor-kit/perfTrace.test.ts` | 覆盖环境开关、日志级别和样本聚合。 |

## 7. 性能对比

### 7.1 关键阶段

| 阶段 / 日志 | 主要现象 | 结论 |
| --- | --- | --- |
| `1781963518314` | rAF 392～485ms；forced reflow 345ms；Diff FAST 仅 1 candidate | Diff 规模不是主因 |
| `1781966836788` | MarkdownEditor commit 424.9～540.6ms | 大成本位于编辑器 React 子树 |
| `1782035222384` | EditorContent 最高 345ms；CodeBlock 聚合约 240ms | 代码块 NodeView 批量更新是主因 |
| `1782035806288` | 输入阶段不再出现代码块聚合 render；用户确认手感显著改善 | position check 修复有效 |
| `1782036473513` | autosync prepare 175～178ms；业务步骤均不足 2ms | 剩余长任务在未拆分调试路径 |
| `1782037216564` | 两次 trace persistence 合计 68～70ms | sessionStorage 全量重写是根因 |
| `1782038949958` | trace 0～0.5ms；prepare 通常 0.8～1.3ms；无 input/setTimeout violation | 最终热路径达到目标 |

### 7.2 最终日志统计

`localhost-1782038949958.log`：

| 标签 | 样本数 | 平均 | 最大值 | 说明 |
| --- | ---: | ---: | ---: | --- |
| `MarkdownEditor.handleUpdate` | 18 | 0.07ms | 0.3ms | transaction 即时路径 |
| `MarkdownEditor.flushPendingChange` | 7 | 1.30ms | 1.6ms | 含 getJSON 与 onChange |
| `BlockToolbar.transactionFrame` | 24 | 0.01ms | 0.1ms | hover 目标跟踪 |
| `flushQueueTracePersist` | 5 | 0.10ms | 0.5ms | 已变为内存 append |
| `flushTracePersist` | 5 | 0.14ms | 0.3ms | 已变为内存 append |
| `flushPrepare` | 5 | 2.50ms | 8.3ms | 多数样本 0.8～1.3ms |
| `flushRequestSetup` | 5 | 0.66ms | 1.3ms | 不含网络等待 |

最终日志仍包含一次文档首次挂载：

- EditorContent 初次大文档更新约 205.9ms；
- CodeBlock 首次聚合挂载约 258.2ms；
- forced reflow 约 233ms。

这些发生在 328 块文档加载阶段，不是按键热路径。后续如果优化首屏加载，应单独设计虚拟化、渐进 NodeView 挂载或代码块延迟高亮，不应重新修改已经稳定的输入时序。

## 8. 回归测试与验证策略

本轮采用“先写失败测试，再做最小实现”的方式覆盖关键行为：

1. 纯文字文档不调用 list descendants 扫描；
2. touched range 不使用全顶层 `doc.forEach()`；
3. 内容发射使用有序 timer，不使用 `requestIdleCallback`；
4. 本地输入不调用受控 `setContent(nextContent)`；
5. BlockToolbar transaction 合并且 connected target 早返回；
6. FindReplace 只有 active + query 时才响应 update；
7. FloatingSelectionToolbar 同一帧只调度一次；
8. position-only NodeView update 不调用 `updateProps()`；
9. CodeBlock NodeView 注销 Tiptap position check；
10. sync trace append 不同步写 `sessionStorage`；
11. autosync 准备与 request setup 标签分离。

运行时验证使用同一篇大文档和连续日志迭代，而不是只依赖单测。每次假设都要求出现可区分的标签：如果标签没有下降，就回到调查阶段，不继续叠加补丁。

### 8.1 提交前验证结果

针对本次改动的 focused suite：

```powershell
pnpm exec vitest run src/modules/editor-kit/perfTrace.test.ts src/modules/editor-kit/editor-perf-instrumentation.source.test.ts src/modules/editor-kit/MarkdownEditor.source.test.ts src/components/__tests__/editor-live-content.source.test.ts src/modules/editor-kit/BlockToolbar/index.source.test.ts src/components/FindReplaceBar/useFindReplace.test.ts src/modules/editor-kit/Toolbar/FloatingSelectionToolbar.source.test.ts src/modules/editor-kit/extensions/listTypography.test.ts src/modules/editor-kit/nodeViewUpdate.test.ts src/hooks/useDocumentSync.source.test.ts src/services/sync/__tests__/debug-log.test.ts --reporter=dot
```

结果：

- 11 个 test files passed；
- 48 个 tests passed；
- 0 个失败。

生产构建：

```powershell
pnpm build
```

结果：Next.js production build、TypeScript、静态页面生成均通过。

核心改动文件 ESLint 检查结果为 0 error；`useFindReplace.ts` 保留 1 条既有 `exhaustive-deps` warning。直接对历史 NodeView 大文件执行当前 React Compiler lint 仍会报告既有的 `set-state-in-effect`、manual memoization、refs 等基线问题，本轮没有借性能修复重构这些交互组件。

全量 `pnpm test:unit` 的 JSON 结果为 455 个 tests 中 451 passed、4 failed。4 个失败均是既有 source-contract 断言：

1. `document-sidebar-create.source.test.ts` 依赖旧格式化文本片段；
2. `TaskItemView.source.test.ts` 仍从兼容入口 `editor.css` 查找已迁移到共享 `content.css` 的选择器；
3. `CodeBlockView.source.test.ts` 有两条断言仍从同一兼容入口查找已迁移 CSS。

这些失败对应的 DocumentSidebar/CSS 迁移不在本次提交范围；本轮新增的 CodeBlock position guard 用例在同一测试文件中通过。

## 9. 已否定的假设与经验

### 9.1 “日志很多，所以 BlockToolbar 是主因”

错误。它确实高频 render，但单次成本通常不足 1ms；数量多不等于总成本最大。

### 9.2 “纯文字卡，所以一定不是代码块”

错误。前方纯文字长度变化会改变后方代码块的 position；位置依赖让未编辑的代码块集体 render。

### 9.3 “自定义 NodeView update 就能阻止所有更新”

错误。Tiptap 的 position registry 是独立更新源，必须单独注销。

### 9.4 “autosync 长任务就是网络或 reducer 慢”

错误。request setup 与 reducer 均不足 2ms，长任务来自同步 Storage 诊断日志。

### 9.5 “统一 debounce 可以解决”

风险过高。内容、Diff hint、ACK 和 autosync 有严格顺序；粗暴延迟曾放大重复应用和无限请求。

### 9.6 性能诊断工具必须自证无害

本次后半段最典型的问题就是 trace 自己制造 70～175ms 长任务。任何诊断设施都必须：

- 默认不影响生产；
- 热路径不做全量序列化；
- 高频样本聚合；
- 支持独立开关；
- 能测量自身成本。

## 10. 风险与已知剩余项

### 10.1 Tiptap 私有字段兼容风险

`PositionStableReactNodeView` 读取 `positionCheckCallback` 内部字段。该字段不是稳定公开 API，升级 `@tiptap/react` / `@tiptap/core` 时必须重新验证：

- callback 是否仍在 `mount()` 注册；
- `cancelPositionCheck()` 签名是否变化；
- stock destroy 是否已修复 callback 生命周期；
- position-only 输入是否重新触发全部代码块 render。

相关 source guard 与运行时 NodeView profiler 应保留到下一次 Tiptap 升级完成。

### 10.2 首次大文档挂载

首次加载仍有约 200～300ms React/代码块挂载和 forced reflow。这是下一轮“加载性能”问题，不应与输入性能混在同一修复中。

### 10.3 工具栏偶发提交

最终日志中固定 Toolbar 在同步状态变化附近仍有约 43～45ms 的 React update，FloatingSelectionToolbar 约 10～12ms。它没有形成 input/setTimeout violation，也不是当前输入延迟主因。如果用户后续感知到“保存状态变化时轻微掉帧”，可单独缩小 Toolbar 状态订阅。

### 10.4 ACK 后 full rescan

`batch-ack-rescan` 仍可能记录 `sync:diff:FULL`。当前日志没有显示它形成长任务，且它承担 ACK 后一致性校验，不应在没有新证据时删除。后续可考虑基于 ACK operation identities 生成更精确的 hint。

### 10.5 重复扩展警告

开发控制台仍有：

```text
Duplicate extension names found: ['link', 'underline']
```

原因是当前 StarterKit 与显式 Link/Underline 扩展存在重复注册。它不是本次卡顿主因，但应在独立小提交中清理，避免扩展行为歧义。

### 10.6 调试 trace 的持久化窗口

trace 现在在 3 秒静默期后写入 Storage。若页面在最后一条 trace 后 3 秒内异常退出，极少量最新诊断记录可能只存在内存中。这是为了避免每次 autosync 阻塞 UI 的明确权衡；手动导出仍直接读取内存，不受影响。

## 11. 回退策略

若后续发现兼容性问题，按层回退而不是整体撤销：

1. NodeView 行为异常：只回退 `PositionStableReactNodeView`，保留 perf trace 观察恢复后的批量 render；
2. 外部内容未刷新：检查 `replaceContent()` 调用覆盖，不要恢复本地 `setContent()` 回灌；
3. 工具栏位置错误：只回退对应 toolbar 的 rAF 合并或 detached guard；
4. trace 丢失不可接受：缩短 debounce 或在显式导出/页面隐藏时 flush，不恢复每条记录全量同步写入；
5. 同步时序异常：优先保留“立即 snapshot capture + 80ms ordered emission”，禁止换成 idle queue。

## 12. 后续建议

### P0：提交后短期观察

- 保留性能标签一段时间；
- 在普通文字、代码块、列表、表格中各做一次持续输入；
- 观察是否重新出现多个 CodeBlock NodeView 同帧 render；
- 观察 autosync prepare 是否稳定低于一帧；
- 确认无无限 Diff、无内容重复、无丢字。

### P1：独立清理

- 去除重复 Link/Underline 扩展注册；
- 缩小 Toolbar 对同步状态的订阅范围；
- 为 `batch-ack-rescan` 设计 ACK identity hint；
- 将 source string guards 逐步替换为可执行行为测试。

### P2：大文档加载性能

- 代码块 NodeView 渐进挂载；
- 首屏外代码块延迟高亮；
- `content-visibility` 或视口级渲染；
- 大文档首次布局与 forced reflow 专项追踪。

## 13. 最终结论

本次工作的核心价值不只是把一个 0.5 秒卡顿降下来，而是建立了编辑器性能问题的分层诊断方法：

> **先证明 transaction 本身是否慢，再区分 React subtree、NodeView、布局、同步准备和诊断持久化；不要根据日志数量或模块名称猜根因。**

最终确立的输入链路 invariant 是：

> **ProseMirror 本地 transaction 只应用一次；本地 JSON 是实时派生状态，不是新的外部受控输入。**

> **未发生语义变化的 NodeView 不得仅因 position 数字变化而进入 React render。**

> **辅助 UI、快照和调试日志不得把单块 transaction 扩散成全篇扫描、批量 NodeView 更新或同步 Storage 长任务。**

在这些约束下，328 块大文档的普通输入、代码块输入与 autosync 准备均进入毫秒级范围，用户主观手感与运行日志一致改善。本轮应在保持现有热路径稳定的前提下收尾；首次加载、工具栏偶发提交和扩展重复警告作为独立问题继续处理。

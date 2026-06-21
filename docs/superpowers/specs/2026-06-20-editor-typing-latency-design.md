# 编辑器输入延迟修复设计

> 状态：初始调查设计。执行过程中通过分层 Profiler 进一步定位到 Tiptap React NodeView position check 与同步 trace 的同步 Storage 持久化；最终实现及设计偏差见 `docs/superpowers/reports/2026-06-21-editor-typing-latency-retrospective.md`。

## 背景与证据

在包含 326 个顶层块的文档中，输入后的 UI 更新存在约 0.5 秒延迟。运行日志显示：

- 输入 Diff 走 `content-hint` 快速路径，通常只有 1 个 dirty candidate；
- 同一时段出现 392–485ms 的 `requestAnimationFrame` 长任务；
- 同一时段出现最高 345ms 的 forced reflow；
- `EditorPage` 的热内容 state 会使整个页面组件重新渲染；
- `MarkdownEditor` 当前没有稳定的 React memo 边界；
- BlockToolbar、FloatingSelectionToolbar 和隐藏状态下的 FindReplace 会对高频编辑器事件继续调度 React state、布局读取或额外 transaction。

因此，本轮把问题定位为“编辑 transaction 被扩散成页面级 React 渲染和辅助 UI 布局工作”，而不是单纯的代码块渲染或 Block Diff 算法问题。

## 目标

1. 普通文字连续输入时，ProseMirror 的 DOM 更新不等待页面级 React 渲染。
2. 单块内容编辑不触发无关辅助 UI 的额外 transaction 或重复 rAF。
3. 保持内容、Diff hint 和同步请求的顺序一致，不使用可能重排编辑事件的 idle 队列。
4. 不破坏块工具栏、浮动工具栏、查找替换、目录和同步功能。

## 非目标

- 不在本轮重写同步引擎或把 Diff 移入 Web Worker。
- 不改变文档持久化协议、批次 ACK 语义或 Block Diff 数据结构。
- 不通过降低编辑器功能、关闭同步或增加明显保存延迟来掩盖卡顿。

## 方案比较

### A. 隔离 React 渲染边界并清除无效事件扇出（采用）

为 MarkdownEditor 建立稳定 memo 边界，并让辅助 UI 只在自身确实需要更新时响应 transaction。改动局部、可逐项验证，并且不改变内容事件时序。

### B. 对所有内容 state 和同步统一 debounce

实现较快，但会扩大保存延迟，并可能重现内容重复、ACK 合并错序或无限 Diff。拒绝采用。

### C. 将编辑运行时迁移到独立 store 或 Worker

长期隔离能力最好，但涉及 EditorPage、同步、快照和工具栏的系统性重构，不适合作为本轮卡顿修复。

## 设计

### 1. 编辑器渲染边界

- 为 MarkdownEditor 的 `forwardRef` 组件增加 memo 边界。
- EditorPage 传给 MarkdownEditor 的对象和回调保持引用稳定，避免仅因 `liveContent`、同步状态或快照状态变化而重新渲染编辑器 React 子树。
- 外部加载、远端替换和 ACK 身份修补仍通过现有受控内容路径进入编辑器；普通本地输入不把 JSON 内容重新作为 `content` prop 回灌。

### 2. BlockToolbar transaction 路径

- transaction 到来时先检查当前目标 DOM 是否仍连接。
- 当前目标仍有效时，不递增仅用于强制刷新的 React state，也不立即重新测量布局。
- 删除导致目标脱离 DOM 时，保留现有 fallback 定位逻辑。
- 鼠标移动、滚动、窗口 resize 等真实位置变化仍负责刷新手柄位置。

### 3. FindReplace 生命周期

- 查找词为空或功能未激活时，编辑器 update 不调度搜索 rAF，也不派发空 Decoration transaction。
- 查找功能激活且 query 非空时，继续在文档变化后更新匹配和 decorations。
- 关闭查找后清除 decorations 的行为保持不变。

### 4. FloatingSelectionToolbar 调度

- rAF 调度采用单帧合并，避免 `selectionUpdate` 与 `transaction` 对同一次输入重复排队。
- 光标选择为空且工具栏已经隐藏时，不重复写入 React state，也不读取坐标布局。
- 非空选区、滚动和 resize 时仍正常计算位置。

### 5. 可观测性

- 开发环境性能追踪必须能在普通控制台级别看到。
- 记录编辑更新、React 编辑器边界提交、工具栏 transaction 帧、查找更新和同步 Diff 的耗时。
- 追踪只用于诊断，不参与业务时序和内容调度。

## 数据与时序约束

1. 每次 ProseMirror `onUpdate` 仍按发生顺序生成内容和 SyncDiffHint。
2. 内容引用立即更新，供手动保存和同步 barrier 获取最新 JSON。
3. React 非紧急状态可以延后提交，但不得改变内容事件先后顺序。
4. ACK 或远端内容只通过显式替换路径更新 `content` prop。
5. 辅助 UI transaction 不得被同步层误判为文档内容变化。

## 测试策略

- 源码/单元测试：MarkdownEditor 具有稳定 memo 边界和稳定 props。
- BlockToolbar 测试：有效目标的普通 transaction 不触发强制 React 刷新；目标删除仍执行 fallback。
- FindReplace 测试：空 query 的编辑 update 不派发 transaction；非空 query 仍更新结果。
- Floating toolbar 测试：同一帧多次事件只产生一个回调；空选择不重复更新隐藏状态。
- 回归测试：内容顺序不重复、不丢失；同步请求不形成无限 Diff；现有 Diff hint 快速路径保持通过。
- 手工性能验收：在同一 326 块文档连续输入，控制台不再出现与输入对应的 300–500ms React/rAF 长任务，输入视觉反馈保持在一帧附近。

## 风险与回退

- memo props 比较遗漏可能导致外部设置未刷新；通过逐项稳定 props，而不是忽略业务 props 来规避。
- 工具栏可能短暂保留旧位置；鼠标移动、滚动和 resize 会刷新，删除目标继续走 fallback。
- 若隔离后长任务仍存在，保留性能标签继续定位具体 React 提交或浏览器扩展干扰，不回退到 idle/debounce 内容队列。

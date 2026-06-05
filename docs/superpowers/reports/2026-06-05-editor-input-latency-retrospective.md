# 编辑器输入延迟优化复盘
> 日期：2026-06-05
> 前端：`E:\workspace\editor-demo\app`
> 状态：已修复并通过针对性验证

## 1. 背景

用户反馈编辑区域输入时存在明显迟滞，尤其打开开发者控制台后更容易感知到：按下键盘后字符不是立即出现，而是存在一个很短但连续可感知的延迟。

这类问题不是单一渲染问题，而是输入 transaction 同步链路里叠加了多项重活。开发者控制台打开后，调试日志、序列化、Storage 写入等同步成本会被进一步放大。

## 2. 根因

本次定位到的主要高频成本如下：

1. `MarkdownEditor.onUpdate` 每次输入都会调用 `patchEditorDocumentIdentity()`，该函数会扫描整篇 ProseMirror 文档。
2. 同一个 `onUpdate` 里每次输入都会立即 `editor.getJSON()`，对整篇文档做 JSON 序列化并同步传给父组件。
3. 父组件收到完整 content 后会触发多条派生链路，包括输出面板 HTML/Markdown/JSON 计算、同步快照、自动保存状态和本地快照策略。
4. 本地恢复备份曾在 dirty/flushing/error 状态变化时同步构建整篇快照并写入 `localStorage`。
5. 同步 trace 在日志未开启时也会提前构造 manifest 等大 payload。
6. 工具栏、块工具条、标题锚点和 Shiki 代码高亮插件在普通输入时存在不必要的整篇或频繁刷新。

## 3. 修复内容

### 3.1 输入 transaction 轻量化

`MarkdownEditor` 的输入回调从“每次 transaction 立即整篇处理”改为“轻量判断 + 80ms 合并刷新”：

- 按键路径不再立即执行整篇 `getJSON()`。
- 身份补齐只在可能新增/拆分块或当前选区缺少 `clientId` 时标记。
- 实际 `patchEditorDocumentIdentity()` 与 `getJSON()` 放到短延迟合并任务中执行。
- 使用 `WeakSet` 记录本地刚发出的 content，父组件回传同一对象时跳过外部 content 同步，避免回声校验和整篇比较。

### 3.2 父组件派生计算后移

`EditorPage` 的输出数据改为弹窗打开时才计算：

- 未打开输出弹窗时不再生成 HTML。
- 未打开输出弹窗时不再由 HTML 转 Markdown。
- JSON 美化也只在输出弹窗且切到 JSON 时执行。

输入后的 React content 更新使用 `startTransition`，让 Tiptap 自身 DOM 输入反馈优先完成。

### 3.3 本地快照与恢复备份降频

本地快照 writer 支持懒 snapshot 工厂：

- 输入时只保留待写内容引用。
- hash、structured clone 和 Storage 写入推迟到防抖触发时执行。
- 本地恢复备份从同步写入改为短延迟写入，并优先读取最新 editor JSON。

### 3.4 调试日志懒构建

同步 trace 改为只有 `SyncTraceLog.isEnabled()` 为 true 时才构建 payload：

- manifest 摘要不再在日志关闭时生成。
- flush/ack/idle 等大对象日志只在调试开关打开后构造。

### 3.5 编辑器插件减少无效扫描

- Shiki 代码高亮只在 transaction 触碰代码块或强制刷新时重建 decorations。
- Heading anchor 只在 transaction 触碰标题时扫描标题并补锚点。
- 固定工具栏通过状态签名判断是否需要刷新，普通文本输入不再无意义重渲染整条工具栏。
- 块工具条在没有悬停目标时不响应每个 transaction。

## 4. 影响范围

本次改动集中在前端编辑器输入链路，不改变服务端协议和文档数据结构。

涉及文件：

- `src/modules/editor-kit/MarkdownEditor.tsx`
- `src/components/EditorPage.tsx`
- `src/hooks/useDocumentSync.ts`
- `src/hooks/useLocalDocumentSnapshot.ts`
- `src/services/local-snapshot.ts`
- `src/modules/editor-kit/code/shikiCodeBlock.ts`
- `src/modules/editor-kit/extensions/headingAnchor.ts`
- `src/modules/editor-kit/Toolbar/*`
- `src/modules/editor-kit/BlockToolbar/index.tsx`

## 5. 验证结果

已通过：

- `pnpm exec tsc --noEmit`
- `pnpm test:unit -- src/modules/editor-kit/__tests__/identity-selection.test.ts src/modules/editor-kit/__tests__/editorContentNormalization.test.ts src/modules/editor-kit/code/codeBlockSelection.test.ts src/modules/editor-kit/code/codeBlockOptions.test.ts src/modules/editor-kit/code/codeBlockCleanup.test.ts src/modules/editor-kit/utils/anchorId.test.ts src/hooks/useLocalDocumentSnapshot.test.ts src/services/local-snapshot.test.ts src/services/sync/__tests__/snapshot.test.ts`
- `pnpm test:unit -- src/hooks/useLocalDocumentSnapshot.test.ts src/services/local-snapshot.test.ts src/services/sync/__tests__/snapshot.test.ts src/modules/editor-kit/Toolbar/toolbarState.test.ts src/modules/editor-kit/BlockToolbar/blockTarget.test.ts`

额外检查：

- `http://localhost:3001` 已有服务监听，可直接在现有 dev server 上试输入手感。

## 6. 已知非本次问题

全量 `pnpm test:unit` 仍有既有 source-contract 失败：

- `TaskItemView.source.test.ts`
- `CodeBlockView.source.test.ts`

失败原因集中在测试仍直接检查旧 CSS 内容，但当前 CSS 文件已经变为 `@import "../../content-styles/content.css"` 的兼容入口。

全量 `pnpm lint` 仍有既有基线问题，包括未使用变量、`any`、React hooks 规则等，分布在多个历史文件中，不是本次输入性能优化引入。

## 7. 结论

本次修复的关键点是把“按键 transaction 内的整篇文档工作”移出输入即时路径。

优化后，按键路径只保留轻量判断，整篇 JSON 序列化、身份补齐、快照构建、输出内容派生、调试 trace payload 和插件全量扫描都被延后、按需或按相关节点触发。这样可以显著降低大文档和开发者控制台打开时的输入迟滞。

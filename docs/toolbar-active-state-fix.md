# 工具栏激活状态修复设计

## 背景

编辑器工具栏此前直接依赖 Tiptap 的 `editor.isActive()` 和 `toggleXxx()` 来显示与切换按钮状态。在简单光标场景下这能工作，但在以下场景中会出现状态不准或行为反直觉：

- 选区中只有一部分文字加粗，工具栏粗体按钮不显示激活。
- 选中“部分加粗 + 部分未加粗”的内容后点击粗体，实际可能把整段都变成粗体，而不是取消已有粗体。
- 光标或选区叠加多种语法时，标题、列表、引用、代码块、链接等状态显示不稳定。
- 点击工具栏按钮时编辑器可能先失焦，导致选区丢失，移动端更明显。

本次修复的目标是让工具栏状态从“调用按钮命令时临时判断”改为“根据当前 selection 主动推导状态”，并让行内 mark 的切换语义更明确。

## 根因

Tiptap 的 `editor.isActive("bold")` 对非空选区的语义更接近“整个选区都拥有 bold mark 才算 active”。但产品期望是：

- 有选区时：选区内只要存在某种语法，就显示对应按钮激活。
- 无选区时：根据光标所在位置的行内 mark 和外层块级节点显示状态。

同时，`toggleBold()` 等命令内部也依赖 active 判断。对于混合选区，直接调用 `toggleBold()` 容易把未加粗部分也加粗，导致用户感觉“无法取消”或“越点越乱”。

## 设计方案

### 1. 统一工具栏状态层

新增 `src/components/markdown-editor/Toolbar/toolbarState.ts`，集中计算工具栏所需状态。

核心接口：

- `getToolbarState(editor)`：从当前编辑器 selection 推导完整工具栏状态。
- `isToolbarItemActive(state, id)`：把状态映射到具体按钮是否激活。
- `selectionContainsMark(editor, markName, attrs)`：判断当前选区或光标上下文是否包含某个 mark。
- `runInlineMarkCommand(editor, markName)`：根据新语义切换行内 mark。

### 2. 行内 mark 状态规则

行内 mark 包括：

- bold
- italic
- strike
- underline
- code
- link
- highlight

规则：

- 选区为空时，读取 `storedMarks` 或光标处 `$from.marks()`。
- 选区非空时，遍历选区内文本节点；只要任一文本节点包含目标 mark，即认为 active。

这样选中“普通文字 + 加粗文字”时，粗体按钮会显示激活。

### 3. 行内 mark 命令规则

对于粗体、斜体、删除线、下划线等按钮，不再盲目调用 `toggleXxx()`。

新规则：

- 如果当前 selection 包含该 mark，则执行 `unsetMark(markName)`。
- 如果当前 selection 不包含该 mark，则执行 `setMark(markName)`。

这样混合选区点击粗体时，会明确移除已有粗体，而不是把整段都加粗。

### 4. 块级状态规则

块级状态从当前光标所在祖先节点或选区范围推导，包括：

- paragraph / heading level
- bullet list
- ordered list
- task list
- blockquote
- code block
- horizontal rule
- highlight block
- text align
- line height
- ordered list style
- code language

无选区时优先读光标所在祖先节点；有选区时也会检查选区内是否包含对应节点。

### 5. 工具栏点击保留选区

`SplitDropdown` 增加 `onMouseDown.preventDefault()`，避免点击工具栏按钮时编辑器先失焦。桌面普通按钮也增加同类处理，降低光标/选区丢失概率。

## 涉及文件

- `src/components/markdown-editor/Toolbar/toolbarState.ts`
  - 新增统一状态计算与行内 mark 命令。
- `src/components/markdown-editor/Toolbar/toolbarState.test.ts`
  - 新增回归测试，覆盖混合选区、光标上下文、标题、对齐、列表和引用状态。
- `src/components/markdown-editor/Toolbar/index.tsx`
  - 在现有桌面工具栏中接入统一状态层，标题/字号/对齐/行高等展示读取 `toolbarState`。
  - 粗体、斜体、删除线、下划线切换改用 `runInlineMarkCommand`。
- `src/components/markdown-editor/Toolbar/SplitDropdown.tsx`
  - 防止按钮鼠标按下时导致编辑器失焦。

## 回归测试

新增测试覆盖：

1. 选区中任意部分加粗时，粗体按钮应显示激活。
2. 混合选区点击粗体时，应移除已有粗体，而不是把全选区加粗。
3. 光标位于二级标题、居中、加粗文本中时，状态应正确。
4. 光标位于引用块中的列表项时，引用和无序列表状态应同时激活。

## 验证命令

本次修复使用以下命令验证：

```bash
pnpm test:unit
pnpm exec tsc --noEmit
pnpm exec eslint src/components/markdown-editor/Toolbar/toolbarState.ts src/components/markdown-editor/Toolbar/toolbarState.test.ts src/components/markdown-editor/Toolbar/SplitDropdown.tsx
```

说明：当前仓库执行全量 `pnpm lint` 会被既有 `.worktrees/.next` 构建产物和历史 lint 问题阻塞，因此本次只把新增/核心改动文件作为直接 lint 验证范围。

## 后续建议

- 移动端工具栏点击区域、层级和触摸事件可以在此状态层稳定后单独优化。
- 如后续需要更精细的 UI，可把 mark 状态扩展为 `active | inactive | mixed`，用于区分“全部命中”和“部分命中”。当前先按用户预期将“部分命中”显示为激活。
- 桌面和移动工具栏还可以进一步合并更多命令逻辑，减少未来状态分叉。

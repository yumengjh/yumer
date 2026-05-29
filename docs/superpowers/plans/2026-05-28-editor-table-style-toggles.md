# Editor Table Style Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为编辑器表格右键菜单增加更紧凑的 UI 与整表样式开关：隐藏外框、等宽排列、标题行、标题列。

**Architecture:** 在 `table` 节点上增加持久化属性，统一由表格命令层读取/切换；右键菜单只负责触发整表级命令；CSS 基于 `data-*` 属性渲染外框、等宽和标题样式。

**Tech Stack:** Tiptap 3、ProseMirror、TypeScript、React、Ant Design、Vitest、CSS

---

### Task 1: 失败测试
- [ ] 为 `tableCommands.test.ts` 增加失败测试：切换隐藏外框、等宽排列、标题行、标题列时，当前表格 attrs 正确变化。
- [ ] 为序号列+标题列组合增加失败测试：标题列开启后，首列序号列同样带标题列属性。
- [ ] 为右键菜单结构增加失败测试或纯函数测试：菜单包含新开关项并使用更紧凑的样式配置。

### Task 2: 表格属性与命令
- [ ] 扩展 `tableIndexColumn.ts`（或拆出更通用扩展），为 `table` 增加 `hideOuterBorder`、`equalWidth`、`headerRow`、`headerColumn` 属性。
- [ ] 在 `tableCommands.ts` 中新增整表属性读取/切换辅助函数，并保证插入序号列后保留其他表格 attrs。
- [ ] 修正右键选中单元格时的安全性，避免 editor view 未挂载时报错。

### Task 3: 右键菜单
- [ ] 调整 `TableInteractions.tsx` 菜单宽度、字号、间距、padding，使整体更小。
- [ ] 新增整表开关菜单项：隐藏外框、等宽排列、标题行、标题列。
- [ ] 按结构操作 / 样式设置分组，点击后仅作用于当前整张表。

### Task 4: CSS 与验证
- [ ] 在 `editor.css` 中增加 table `data-*` 规则：隐藏外框、等宽、标题行、标题列。
- [ ] 运行新增测试和相关表格测试，确认红绿循环与回归结果。

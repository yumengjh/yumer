# Editor Table Index Column Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复编辑器表格样式不跟随全局内容的问题，并让“插入序号列”支持空表头、自动居中、自动随插删行连续重排。

**Architecture:** 通过一个独立的 Tiptap 扩展给 table 节点增加 `indexColumn` 标记；表格命令层统一维护首列序号重排；CSS 层改为让 table 继承编辑器全局字体、字号、行高。

**Tech Stack:** Tiptap 3、ProseMirror、TypeScript、Vitest、CSS

---

### Task 1: 表格命令回归测试
- [ ] 为 `insertIndexColumn` 增加失败测试：首格留空、后续行为连续编号、首列居中、表格带 `indexColumn` 标记。
- [ ] 为 `insertTableRelativeRow` 增加失败测试：在序号列表格中插入行后自动连续重排。
- [ ] 为 `deleteSelectedTableCells(..., "row")` 增加失败测试：删除中间行后自动连续重排。

### Task 2: 序号列实现
- [ ] 新增表格扩展，为 `table` 节点提供 `indexColumn` 属性的 parse/render。
- [ ] 在 `tableCommands.ts` 中抽取“是否为序号列表格 / 重排首列 / 首列居中 / 设置 table 标记”的统一函数。
- [ ] 调整 `insertIndexColumn` 为“插入最左列 + 首格空白 + 从第二行起编号 + 标记表格”。
- [ ] 调整插入行、删除行命令，在结构变更后对序号列表格自动重排。

### Task 3: 样式修复
- [ ] 修改 `editor.css` 中 table 相关规则，改为继承编辑器正文的 `font-family / font-size / line-height`。

### Task 4: 校验
- [ ] 运行新增测试文件确认红绿循环。
- [ ] 运行相关既有表格测试，确认未破坏复制/粘贴逻辑。

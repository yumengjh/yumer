# Editor Toolbar Code Cleanup Display Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展编辑器“代码清理”工具栏分组，在原有文本清理动作基础上新增四个代码块显示批处理动作：全部折叠状态栏、全部展开状态栏、全部打开行号、全部关闭行号，并保持“下拉选择后立即执行且切换当前默认动作”的交互。

**Architecture:** 继续复用现有 `codeBlockCleanup.ts` 作为代码块文档级批处理入口，但将其从“文本清理”扩展为“文本清理 + 属性批处理”统一动作层。工具栏仍只负责菜单渲染、默认动作状态与提示消息，底层模块负责扫描 `codeBlock` 节点、判断 attrs 是否需要变更、批量创建替换事务并返回影响计数。

**Tech Stack:** React, TypeScript, Tiptap, ProseMirror, Ant Design, Vitest

---

## File Structure

### Modified files

- `src/components/markdown-editor/code/codeBlockCleanup.ts`  
  扩展动作枚举与批处理逻辑，支持状态栏和行号属性批量更新。
- `src/components/markdown-editor/code/codeBlockCleanup.test.ts`  
  增加 attrs 批量更新测试，确保 preserve unrelated attrs。
- `src/components/markdown-editor/Toolbar/data.ts`  
  扩展代码清理菜单项并支持 divider 分组元数据。
- `src/components/markdown-editor/Toolbar/DesktopToolbar.tsx`  
  更新动作消息映射与代码清理下拉菜单渲染。
- `src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts`  
  更新源码级集成断言，覆盖新增动作 key 与菜单接线。

### Existing references to inspect during implementation

- `src/components/markdown-editor/code/codeBlockOptions.ts`
- `src/components/markdown-editor/code/CodeBlockView.tsx`
- `src/components/markdown-editor/Toolbar/DesktopToolbar.tsx`
- `src/components/markdown-editor/Toolbar/data.ts`

---

### Task 1: 先写失败测试，定义新增批量显示动作行为

**Files:**
- Modify: `src/components/markdown-editor/code/codeBlockCleanup.test.ts`
- Reference: `src/components/markdown-editor/code/codeBlockOptions.ts`
- Test: `src/components/markdown-editor/code/codeBlockCleanup.test.ts`

- [ ] **Step 1: 阅读现有 code block attrs 结构，确认断言字段名**

Run:
```powershell
Get-Content src/components/markdown-editor/code/codeBlockOptions.ts
Get-Content src/components/markdown-editor/code/codeBlockCleanup.test.ts
```

Expected: 明确要断言的字段为 `statusBarCollapsed`、`lineNumbers`，且需要保留如 `language`、`title`、`codeCollapsed` 等 attrs。

- [ ] **Step 2: 在 `codeBlockCleanup.test.ts` 新增“全部折叠/展开状态栏”的失败测试**

```ts
it("collapses all code block status bars while preserving unrelated attrs", () => {
  const editor = createEditor({
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: {
          language: "typescript",
          title: "A",
          statusBarCollapsed: false,
          codeCollapsed: true,
        },
        content: [{ type: "text", text: "a" }],
      },
      {
        type: "codeBlock",
        attrs: {
          language: "javascript",
          title: "B",
          statusBarCollapsed: true,
          codeCollapsed: false,
        },
        content: [{ type: "text", text: "b" }],
      },
    ],
  });

  const result = cleanupCodeBlocks(editor, "collapseStatusBars");

  expect(result).toEqual({ changed: true, affectedCount: 1 });
  expect(editor.getJSON()).toMatchObject({
    content: [
      {
        type: "codeBlock",
        attrs: {
          language: "typescript",
          title: "A",
          statusBarCollapsed: true,
          codeCollapsed: true,
        },
      },
      {
        type: "codeBlock",
        attrs: {
          language: "javascript",
          title: "B",
          statusBarCollapsed: true,
          codeCollapsed: false,
        },
      },
    ],
  });
});

it("expands all code block status bars and reports unchanged when already expanded", () => {
  const editor = createEditor({
    type: "doc",
    content: [
      { type: "codeBlock", attrs: { statusBarCollapsed: true }, content: [{ type: "text", text: "x" }] },
      { type: "codeBlock", attrs: { statusBarCollapsed: false }, content: [{ type: "text", text: "y" }] },
    ],
  });

  expect(cleanupCodeBlocks(editor, "expandStatusBars")).toEqual({
    changed: true,
    affectedCount: 1,
  });
  expect(cleanupCodeBlocks(editor, "expandStatusBars")).toEqual({
    changed: false,
    affectedCount: 0,
  });
});
```

Expected: 由于动作尚未实现，测试失败。

- [ ] **Step 3: 在 `codeBlockCleanup.test.ts` 新增“全部打开/关闭行号”的失败测试**

```ts
it("enables line numbers for all code blocks currently disabled", () => {
  const editor = createEditor({
    type: "doc",
    content: [
      { type: "codeBlock", attrs: { lineNumbers: false, title: "off" }, content: [{ type: "text", text: "a" }] },
      { type: "codeBlock", attrs: { lineNumbers: true, title: "on" }, content: [{ type: "text", text: "b" }] },
    ],
  });

  const result = cleanupCodeBlocks(editor, "enableLineNumbers");

  expect(result).toEqual({ changed: true, affectedCount: 1 });
  expect(editor.getJSON()).toMatchObject({
    content: [
      { type: "codeBlock", attrs: { lineNumbers: true, title: "off" } },
      { type: "codeBlock", attrs: { lineNumbers: true, title: "on" } },
    ],
  });
});

it("disables line numbers for all code blocks and reports unchanged when already disabled", () => {
  const editor = createEditor({
    type: "doc",
    content: [
      { type: "codeBlock", attrs: { lineNumbers: true }, content: [{ type: "text", text: "a" }] },
      { type: "codeBlock", attrs: { lineNumbers: false }, content: [{ type: "text", text: "b" }] },
    ],
  });

  expect(cleanupCodeBlocks(editor, "disableLineNumbers")).toEqual({
    changed: true,
    affectedCount: 1,
  });
  expect(cleanupCodeBlocks(editor, "disableLineNumbers")).toEqual({
    changed: false,
    affectedCount: 0,
  });
});
```

Expected: 失败，锁定新动作 API。

- [ ] **Step 4: 运行测试并确认正确失败**

Run:
```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockCleanup.test.ts
```

Expected: FAIL，原因是新动作 key 尚未被 `cleanupCodeBlocks` 支持，而不是测试本身语法错误。

- [ ] **Step 5: Commit**

```bash
git add src/components/markdown-editor/code/codeBlockCleanup.test.ts
git commit -m "test: define code block display cleanup actions"
```

### Task 2: 实现代码块属性批处理动作并跑绿测试

**Files:**
- Modify: `src/components/markdown-editor/code/codeBlockCleanup.ts`
- Modify: `src/components/markdown-editor/code/codeBlockCleanup.test.ts`
- Reference: `src/components/markdown-editor/code/codeBlockOptions.ts`
- Test: `src/components/markdown-editor/code/codeBlockCleanup.test.ts`

- [ ] **Step 1: 扩展动作类型枚举**

在 `codeBlockCleanup.ts` 中把动作类型扩展为：

```ts
export type CodeCleanupActionKey =
  | "removeTrailingBlankLines"
  | "removeEmptyCodeBlocks"
  | "collapseStatusBars"
  | "expandStatusBars"
  | "enableLineNumbers"
  | "disableLineNumbers";
```

Expected: 统一动作入口能表达 6 种行为。

- [ ] **Step 2: 增加基于 normalized attrs 的目标判断辅助函数**

```ts
import { normalizeCodeBlockAttrs } from "./codeBlockOptions";

function getAttrUpdateForAction(
  action: CodeCleanupActionKey,
  record: CodeBlockRecord,
): Record<string, unknown> | null {
  const attrs = normalizeCodeBlockAttrs(record.node.attrs);

  switch (action) {
    case "collapseStatusBars":
      return attrs.statusBarCollapsed ? null : { ...record.node.attrs, statusBarCollapsed: true };
    case "expandStatusBars":
      return attrs.statusBarCollapsed ? { ...record.node.attrs, statusBarCollapsed: false } : null;
    case "enableLineNumbers":
      return attrs.lineNumbers ? null : { ...record.node.attrs, lineNumbers: true };
    case "disableLineNumbers":
      return attrs.lineNumbers ? { ...record.node.attrs, lineNumbers: false } : null;
    default:
      return null;
  }
}
```

Expected: 只在目标值与当前 normalized 值不同时返回更新。

- [ ] **Step 3: 扩展 target 构建逻辑，支持 attrs replace 动作**

新增 target 类型：

```ts
type AttrTarget = CodeBlockRecord & {
  kind: "attrs";
  nextAttrs: Record<string, unknown>;
};
```

并在 `buildCleanupTargets(...)` 中分支处理新动作，把 `nextAttrs` 生成出来。

Expected: 所有动作都走同一个 target 收集与逆序执行流程。

- [ ] **Step 4: 在事务执行阶段支持 attrs 替换节点**

```ts
if (target.kind === "attrs") {
  const nextNode = target.node.type.create(
    target.nextAttrs,
    target.node.content,
    target.node.marks,
  );
  tr.replaceWith(target.pos, target.pos + target.node.nodeSize, nextNode);
  continue;
}
```

Expected: 只更新 attrs，不动内容和其他 marks。

- [ ] **Step 5: 运行测试并做最小修正直至通过**

Run:
```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockCleanup.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/markdown-editor/code/codeBlockCleanup.ts src/components/markdown-editor/code/codeBlockCleanup.test.ts
git commit -m "feat: add code block display batch actions"
```

### Task 3: 扩展工具栏菜单项与消息映射

**Files:**
- Modify: `src/components/markdown-editor/Toolbar/data.ts`
- Modify: `src/components/markdown-editor/Toolbar/DesktopToolbar.tsx`
- Test: `src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts`

- [ ] **Step 1: 将 `codeCleanupItems` 扩展为可表示 divider 的菜单结构**

在 `data.ts` 中改为类似结构：

```ts
export const codeCleanupItems = [
  { key: "removeTrailingBlankLines", label: "移除代码块末尾空行" },
  { key: "removeEmptyCodeBlocks", label: "删除空代码块" },
  { key: "divider-content", type: "divider" },
  { key: "collapseStatusBars", label: "全部折叠状态栏" },
  { key: "expandStatusBars", label: "全部展开状态栏" },
  { key: "divider-display", type: "divider" },
  { key: "enableLineNumbers", label: "全部打开行号" },
  { key: "disableLineNumbers", label: "全部关闭行号" },
] as const;
```

如需类型收窄，可同时导出辅助类型：

```ts
export type CodeCleanupMenuItem =
  | { key: string; type: "divider" }
  | { key: CodeCleanupActionKey; label: string };
```

Expected: 菜单项可以按 spec 分组显示。

- [ ] **Step 2: 在 `DesktopToolbar.tsx` 扩展消息映射**

将 `runCodeCleanupAction` 扩展为完整 6 动作消息：

```ts
const codeCleanupMessages: Record<CodeCleanupActionKey, {
  success: (count: number) => string;
  unchanged: string;
}> = {
  removeTrailingBlankLines: {
    success: (count) => `已清理 ${count} 个代码块的末尾空行`,
    unchanged: "未发现需要清理末尾空行的代码块",
  },
  removeEmptyCodeBlocks: {
    success: (count) => `已删除 ${count} 个空代码块`,
    unchanged: "未发现空代码块",
  },
  collapseStatusBars: {
    success: (count) => `已折叠 ${count} 个代码块的状态栏`,
    unchanged: "所有代码块状态栏已折叠",
  },
  expandStatusBars: {
    success: (count) => `已展开 ${count} 个代码块的状态栏`,
    unchanged: "所有代码块状态栏已展开",
  },
  enableLineNumbers: {
    success: (count) => `已打开 ${count} 个代码块的行号`,
    unchanged: "所有代码块行号已打开",
  },
  disableLineNumbers: {
    success: (count) => `已关闭 ${count} 个代码块的行号`,
    unchanged: "所有代码块行号已关闭",
  },
};
```

Expected: 消息逻辑不再散落在 if/else 中。

- [ ] **Step 3: 更新代码清理下拉渲染，支持 divider 与新增动作**

在 `DesktopToolbar.tsx` 渲染 `codeCleanupItems` 时使用分支：

```tsx
{codeCleanupItems.map((cleanupItem) => {
  if (cleanupItem.type === "divider") {
    return <div key={cleanupItem.key} className="ant-dropdown-menu-item-divider" />;
  }

  const active = cleanupItem.key === defaultCodeCleanupAction;
  return (
    <div
      key={cleanupItem.key}
      className={`ant-dropdown-menu-item ${active ? "ant-dropdown-menu-item-selected" : ""}`}
      onClick={() => {
        setDefaultCodeCleanupAction(cleanupItem.key);
        runCodeCleanupAction(cleanupItem.key);
        setOpenDropdown(null);
      }}
    >
      <span className="menu-check-mark">{active ? "?" : ""}</span>
      {cleanupItem.label}
    </div>
  );
})}
```

Expected: 下拉顺序、分组与动作切换都符合 spec。

- [ ] **Step 4: 运行现有相关测试确认不回归**

Run:
```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/toolbarState.test.ts src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts
```

Expected: 若源码级测试还未更新，则此时可能 FAIL，但 code cleanup 测试应保持 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/markdown-editor/Toolbar/data.ts src/components/markdown-editor/Toolbar/DesktopToolbar.tsx
git commit -m "feat: extend toolbar code cleanup menu actions"
```

### Task 4: 更新源码级工具栏集成测试

**Files:**
- Modify: `src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts`
- Test: `src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts`

- [ ] **Step 1: 扩展源码级断言，覆盖新增 action key 与消息接线**

把测试断言扩展为包含：

```ts
expect(source).toContain('"collapseStatusBars"');
expect(source).toContain('"expandStatusBars"');
expect(source).toContain('"enableLineNumbers"');
expect(source).toContain('"disableLineNumbers"');
expect(source).toContain('codeCleanupItems.map');
expect(source).toContain('cleanupItem.type === "divider"');
expect(source).toContain('setDefaultCodeCleanupAction(cleanupItem.key)');
expect(source).toContain('runCodeCleanupAction(cleanupItem.key)');
```
```

Expected: 测试能锁定新菜单 wiring。

- [ ] **Step 2: 运行源码级测试与相关回归测试**

Run:
```bash
pnpm vitest run src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/toolbarState.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts
git commit -m "test: cover extended toolbar code cleanup menu"
```

### Task 5: 最终验证与手动验收清单

**Files:**
- Modify: 如有必要仅做收尾修正
- Test: 本次相关测试集合

- [ ] **Step 1: 运行本次相关测试全集**

Run:
```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/toolbarState.test.ts src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts
```

Expected: PASS

- [ ] **Step 2: 运行针对改动文件的最小 lint 检查**

Run:
```bash
pnpm exec eslint src/components/markdown-editor/code/codeBlockCleanup.ts src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/data.ts src/components/markdown-editor/Toolbar/DesktopToolbar.tsx src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts
```

Expected: 若出现失败，明确区分是本次新增问题还是既有 `DesktopToolbar.tsx` 历史问题，并只修复本次新增造成的问题。

- [ ] **Step 3: 检查 diff，确认没有无关改动**

Run:
```bash
git status --short
git diff -- src/components/markdown-editor/code/codeBlockCleanup.ts src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/data.ts src/components/markdown-editor/Toolbar/DesktopToolbar.tsx src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts
```

Expected: 只有本功能扩展相关修改。

- [ ] **Step 4: Commit**

```bash
git add src/components/markdown-editor/code/codeBlockCleanup.ts src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/data.ts src/components/markdown-editor/Toolbar/DesktopToolbar.tsx src/components/markdown-editor/Toolbar/DesktopToolbar.source.test.ts
git commit -m "chore: finalize code block display cleanup actions"
```

- [ ] **Step 5: 记录手动验收清单**

手动验收应覆盖：

1. 打开含多个代码块的文档。
2. 点击“代码清理”主按钮，确认默认仍执行“移除代码块末尾空行”。
3. 从下拉选择“全部折叠状态栏”，确认立即生效。
4. 再点主按钮，确认现在默认仍是“全部折叠状态栏”。
5. 从下拉选择“全部展开状态栏”，确认立即生效。
6. 从下拉选择“全部打开行号”“全部关闭行号”，确认它们只影响 `lineNumbers`。
7. 确认这些动作不会改变 `codeCollapsed`、标题、语言等其他 attrs。
8. 在已经处于目标状态时再次执行，确认提示为“所有…已…”而不是报错。

Expected: 行为与 spec 完全一致。

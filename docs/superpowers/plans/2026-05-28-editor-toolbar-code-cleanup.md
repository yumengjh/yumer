# Editor Toolbar Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在编辑器桌面工具栏新增“代码清理”分组，支持一键批量移除代码块末尾空行、删除空代码块，并在下拉选择后立即执行且切换当前默认动作。

**Architecture:** 保持工具栏 UI 逻辑在现有 `DesktopToolbar` 中，新增一个独立的 `codeBlockCleanup` 工具模块负责遍历 Tiptap/ProseMirror 文档、批量生成事务并返回统计结果。工具栏只负责调用动作、显示提示信息、维护当前默认动作状态，避免把文档批处理逻辑塞进组件里。

**Tech Stack:** React, TypeScript, Tiptap, ProseMirror, Ant Design, Vitest

---

## File Structure

### New files

- `src/components/markdown-editor/code/codeBlockCleanup.ts`  
  负责实现两个文档级代码块清理动作、内部文本规范化与结果统计。
- `src/components/markdown-editor/code/codeBlockCleanup.test.ts`  
  覆盖代码块清理规则、批量事务与边界情况。

### Modified files

- `src/components/markdown-editor/Toolbar/data.ts`  
  增加“代码清理”动作元数据。
- `src/components/markdown-editor/Toolbar/DesktopToolbar.tsx`  
  集成新的 split dropdown、维护默认动作状态、调用清理工具并反馈消息。
- `src/components/markdown-editor/Toolbar/toolbarState.test.ts` 或更合适的现有 toolbar 测试文件  
  若已有适合的工具栏行为测试入口，则补充默认动作与菜单行为测试；若不适合，则新建轻量 toolbar 测试文件。

### Existing references to inspect during implementation

- `src/components/markdown-editor/Toolbar/SplitDropdown.tsx`
- `src/components/markdown-editor/code/codeBlockOptions.ts`
- `src/components/markdown-editor/code/codeBlockSelection.test.ts`
- `src/components/markdown-editor/Toolbar/DesktopToolbar.tsx`

---

### Task 1: 盘点现有工具栏 split dropdown 接入点

**Files:**
- Modify: `src/components/markdown-editor/Toolbar/DesktopToolbar.tsx`
- Modify: `src/components/markdown-editor/Toolbar/data.ts`
- Reference: `src/components/markdown-editor/Toolbar/SplitDropdown.tsx`
- Test: 暂不新增

- [ ] **Step 1: 阅读工具栏数据与 split dropdown 接法，确认最小改动点**

Run:
```powershell
Get-Content src/components/markdown-editor/Toolbar/SplitDropdown.tsx
Get-Content src/components/markdown-editor/Toolbar/DesktopToolbar.tsx
Get-Content src/components/markdown-editor/Toolbar/data.ts
```

Expected: 能定位已有 split dropdown 的 props 结构、菜单项格式、主按钮点击与菜单选择的处理方式。

- [ ] **Step 2: 记录“代码清理”分组所需的最小状态与菜单数据**

在计划执行笔记中确认需要新增的最小状态：

```ts
const [defaultCodeCleanupAction, setDefaultCodeCleanupAction] = useState<CodeCleanupActionKey>(
  "removeTrailingBlankLines",
);
```

以及数据结构方向：

```ts
type CodeCleanupActionKey = "removeTrailingBlankLines" | "removeEmptyCodeBlocks";

type CodeCleanupActionOption = {
  key: CodeCleanupActionKey;
  label: string;
  successMessage: (count: number) => string;
  emptyMessage: string;
};
```

Expected: 明确 UI 层只需要“当前默认动作 key + 菜单配置 + 统一执行入口”。

- [ ] **Step 3: 提交前不要改代码，先确认不需要改 `SplitDropdown` API**

检查结论应类似：若 `SplitDropdown` 已支持“左侧 click / 右侧 menu”模式，则优先复用；只有在无法表达“菜单选择后立即执行并切默认动作”时才扩 API。

Expected: 尽量避免改动 `SplitDropdown.tsx`。

- [ ] **Step 4: Commit**

```bash
git status --short
```

Expected: 此任务仅调研，不应有代码变更；无需提交。

### Task 2: 先写失败测试，定义代码块清理规则

**Files:**
- Create: `src/components/markdown-editor/code/codeBlockCleanup.test.ts`
- Reference: `src/components/markdown-editor/code/codeBlockSelection.test.ts`
- Test: `src/components/markdown-editor/code/codeBlockCleanup.test.ts`

- [ ] **Step 1: 参考现有 code 测试风格，确定测试构造方式**

Run:
```powershell
Get-Content src/components/markdown-editor/code/codeBlockSelection.test.ts
Get-Content src/components/markdown-editor/code/codeBlockOptions.test.ts
```

Expected: 明确是否已有 helper 用于创建 Tiptap/ProseMirror 文档或直接测试纯函数。

- [ ] **Step 2: 写“移除代码块末尾空行”的失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  removeTrailingBlankLines,
  isCodeBlockEmpty,
} from "./codeBlockCleanup";

describe("removeTrailingBlankLines", () => {
  it("removes one trailing blank line", () => {
    expect(removeTrailingBlankLines("const a = 1;\n")).toBe("const a = 1;");
  });

  it("removes multiple trailing blank lines and trailing whitespace-only lines", () => {
    expect(removeTrailingBlankLines("line 1\nline 2\n   \n\t\n")).toBe("line 1\nline 2");
  });

  it("preserves internal blank lines", () => {
    expect(removeTrailingBlankLines("line 1\n\nline 3\n")).toBe("line 1\n\nline 3");
  });

  it("keeps content unchanged when no trailing blank line exists", () => {
    expect(removeTrailingBlankLines("line 1\n\nline 3")).toBe("line 1\n\nline 3");
  });
});

describe("isCodeBlockEmpty", () => {
  it("treats whitespace-only content as empty", () => {
    expect(isCodeBlockEmpty("   \n\t ")).toBe(true);
  });

  it("treats visible content as non-empty", () => {
    expect(isCodeBlockEmpty("const a = 1;\n")).toBe(false);
  });
});
```

Expected: 由于实现尚不存在，测试失败并提示缺少导出或实现。

- [ ] **Step 3: 写批量文档清理的失败测试**

```ts
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import CodeBlock from "@tiptap/extension-code-block";
import {
  cleanupCodeBlocks,
  type CodeCleanupActionKey,
} from "./codeBlockCleanup";

function createEditor(content: any) {
  return new Editor({
    extensions: [Document, Paragraph, Text, CodeBlock],
    content,
  });
}

describe("cleanupCodeBlocks", () => {
  it("removes trailing blank lines across all code blocks", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "codeBlock", content: [{ type: "text", text: "a\n" }] },
        { type: "paragraph", content: [{ type: "text", text: "x" }] },
        { type: "codeBlock", content: [{ type: "text", text: "b\n\n" }] },
      ],
    });

    const result = cleanupCodeBlocks(editor, "removeTrailingBlankLines");

    expect(result).toEqual({ changed: true, affectedCount: 2 });
    expect(editor.getJSON()).toMatchObject({
      content: [
        { type: "codeBlock", content: [{ type: "text", text: "a" }] },
        { type: "paragraph", content: [{ type: "text", text: "x" }] },
        { type: "codeBlock", content: [{ type: "text", text: "b" }] },
      ],
    });
  });

  it("deletes whitespace-only code blocks", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "codeBlock", content: [{ type: "text", text: "   \n" }] },
        { type: "codeBlock", content: [{ type: "text", text: "keep me" }] },
        { type: "codeBlock", content: [{ type: "text", text: "\n\t" }] },
      ],
    });

    const result = cleanupCodeBlocks(editor, "removeEmptyCodeBlocks");

    expect(result).toEqual({ changed: true, affectedCount: 2 });
    expect(editor.getJSON()).toMatchObject({
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "codeBlock", content: [{ type: "text", text: "keep me" }] },
      ],
    });
  });

  it("returns unchanged result when nothing matches", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "plain" }] },
        { type: "codeBlock", content: [{ type: "text", text: "const a = 1;" }] },
      ],
    });

    expect(cleanupCodeBlocks(editor, "removeEmptyCodeBlocks")).toEqual({
      changed: false,
      affectedCount: 0,
    });
  });
});
```

Expected: 失败，证明我们已锁定 API 和行为。

- [ ] **Step 4: 运行测试并确认正确失败**

Run:
```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockCleanup.test.ts
```

Expected: FAIL，原因是 `codeBlockCleanup.ts` 尚不存在或导出不匹配，而不是测试语法错误。

- [ ] **Step 5: Commit**

```bash
git add src/components/markdown-editor/code/codeBlockCleanup.test.ts
git commit -m "test: define code block cleanup behavior"
```

### Task 3: 实现代码块清理工具并跑绿测试

**Files:**
- Create: `src/components/markdown-editor/code/codeBlockCleanup.ts`
- Modify: `src/components/markdown-editor/code/codeBlockCleanup.test.ts`
- Test: `src/components/markdown-editor/code/codeBlockCleanup.test.ts`

- [ ] **Step 1: 写最小实现骨架与类型**

```ts
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "prosemirror-model";

export type CodeCleanupActionKey =
  | "removeTrailingBlankLines"
  | "removeEmptyCodeBlocks";

export type CodeCleanupResult = {
  changed: boolean;
  affectedCount: number;
};

export function removeTrailingBlankLines(value: string): string {
  return value.replace(/(?:\r?\n[\t ]*)+$/u, "");
}

export function isCodeBlockEmpty(value: string): boolean {
  return value.trim().length === 0;
}

type CodeBlockRecord = {
  pos: number;
  node: ProseMirrorNode;
  text: string;
};
```

Expected: 先把纯函数与类型固定下来。

- [ ] **Step 2: 实现文档遍历与目标收集**

```ts
function collectCodeBlocks(doc: ProseMirrorNode): CodeBlockRecord[] {
  const records: CodeBlockRecord[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") {
      return true;
    }

    records.push({
      pos,
      node,
      text: node.textContent ?? "",
    });

    return true;
  });

  return records;
}
```

Expected: 能拿到所有 codeBlock 的位置和文本。

- [ ] **Step 3: 实现统一批处理入口 `cleanupCodeBlocks`**

```ts
export function cleanupCodeBlocks(
  editor: Editor | null,
  action: CodeCleanupActionKey,
): CodeCleanupResult {
  if (!editor) {
    return { changed: false, affectedCount: 0 };
  }

  const { state, view } = editor;
  const records = collectCodeBlocks(state.doc);
  const tr = state.tr;
  let affectedCount = 0;

  const targets = records
    .map((record) => {
      if (action === "removeTrailingBlankLines") {
        const nextText = removeTrailingBlankLines(record.text);
        if (nextText === record.text) {
          return null;
        }
        return { type: "replace" as const, ...record, nextText };
      }

      if (!isCodeBlockEmpty(record.text)) {
        return null;
      }

      return { type: "delete" as const, ...record };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => b.pos - a.pos);

  for (const target of targets) {
    affectedCount += 1;

    if (target.type === "replace") {
      tr.insertText(target.nextText, target.pos + 1, target.pos + target.node.nodeSize - 1);
      continue;
    }

    tr.delete(target.pos, target.pos + target.node.nodeSize);
  }

  if (affectedCount === 0) {
    return { changed: false, affectedCount: 0 };
  }

  view.dispatch(tr);
  return { changed: true, affectedCount };
}
```

Expected: 先用最小实现让测试尽可能通过。

- [ ] **Step 4: 跑测试并根据实际节点行为修正实现**

Run:
```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockCleanup.test.ts
```

Expected: 初次可能因空 code block 文本节点/`insertText` 范围处理失败而报错；根据失败信息做最小修正，直到测试 PASS。

- [ ] **Step 5: 如果 `insertText` 对空内容场景不稳，改成 `tr.replaceWith(...)`**

必要时使用类似实现：

```ts
const nextNode = target.node.type.create(target.node.attrs, nextText ? state.schema.text(nextText) : undefined);
tr.replaceWith(target.pos, target.pos + target.node.nodeSize, nextNode);
```

Expected: 替换逻辑在 codeBlock 变空字符串时也稳定。

- [ ] **Step 6: 重新跑测试确认全绿**

Run:
```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockCleanup.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/markdown-editor/code/codeBlockCleanup.ts src/components/markdown-editor/code/codeBlockCleanup.test.ts
git commit -m "feat: add code block cleanup utilities"
```

### Task 4: 把“代码清理”接入桌面工具栏

**Files:**
- Modify: `src/components/markdown-editor/Toolbar/data.ts`
- Modify: `src/components/markdown-editor/Toolbar/DesktopToolbar.tsx`
- Reference: `src/components/markdown-editor/Toolbar/SplitDropdown.tsx`
- Test: 后续 toolbar 相关测试

- [ ] **Step 1: 在 `data.ts` 增加代码清理动作元数据**

```ts
export const codeCleanupItems = [
  {
    key: "removeTrailingBlankLines",
    label: "移除代码块末尾空行",
  },
  {
    key: "removeEmptyCodeBlocks",
    label: "删除空代码块",
  },
] as const;
```

Expected: 工具栏有统一可复用的数据源。

- [ ] **Step 2: 在 `DesktopToolbar.tsx` 引入清理工具与默认动作状态**

```ts
import { ClearOutlined } from "@ant-design/icons";
import {
  cleanupCodeBlocks,
  type CodeCleanupActionKey,
} from "../code/codeBlockCleanup";
import { codeCleanupItems } from "./data";

const [defaultCodeCleanupAction, setDefaultCodeCleanupAction] = useState<CodeCleanupActionKey>(
  "removeTrailingBlankLines",
);
```

Expected: 组件内具备最小状态与执行依赖。

- [ ] **Step 3: 增加统一执行函数与消息映射**

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
};

const runCodeCleanupAction = (action: CodeCleanupActionKey) => {
  const result = cleanupCodeBlocks(tiptap, action);
  const texts = codeCleanupMessages[action];

  if (result.changed) {
    message.success(texts.success(result.affectedCount));
    return;
  }

  message.info(texts.unchanged);
};
```

Expected: 所有动作通过同一入口处理，避免重复逻辑。

- [ ] **Step 4: 渲染新的 split dropdown，并让菜单选择后立即执行且切换默认动作**

目标逻辑示意：

```tsx
const currentCleanupItem = codeCleanupItems.find((item) => item.key === defaultCodeCleanupAction)!;

<SplitDropdown
  label={currentCleanupItem.label}
  icon={<ClearOutlined />}
  onClick={() => runCodeCleanupAction(defaultCodeCleanupAction)}
  menu={{
    items: codeCleanupItems.map((item) => ({
      key: item.key,
      label: item.label,
    })),
    onClick: ({ key }) => {
      const nextAction = key as CodeCleanupActionKey;
      setDefaultCodeCleanupAction(nextAction);
      runCodeCleanupAction(nextAction);
    },
  }}
/>
```

Expected: 满足“左边应用、右边选择、选择后自动触发一次”的需求。

- [ ] **Step 5: 如现有 `SplitDropdown` 不支持所需交互，再做最小 API 扩展**

若必须修改，改动应只限于补足 props 透传，不改变既有用法。

Expected: 保持兼容现有 toolbar 其他分组。

- [ ] **Step 6: 运行目标测试，确认未引入明显回归**

Run:
```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/toolbarState.test.ts
```

Expected: code cleanup 测试继续 PASS；现有 toolbarState 测试不受影响。

- [ ] **Step 7: Commit**

```bash
git add src/components/markdown-editor/Toolbar/data.ts src/components/markdown-editor/Toolbar/DesktopToolbar.tsx src/components/markdown-editor/Toolbar/SplitDropdown.tsx
git commit -m "feat: add toolbar code cleanup actions"
```

### Task 5: 补齐工具栏行为测试

**Files:**
- Modify or Create: `src/components/markdown-editor/Toolbar/*.test.tsx`
- Reference: `src/components/markdown-editor/Toolbar/toolbarState.test.ts`
- Test: 新增/修改的 toolbar 测试文件

- [ ] **Step 1: 先确认现有 toolbar 是否已有组件级测试入口**

Run:
```powershell
Get-ChildItem src/components/markdown-editor/Toolbar -Filter *.test.*
Get-Content src/components/markdown-editor/Toolbar/toolbarState.test.ts
```

Expected: 判断是扩充现有测试，还是新增 `DesktopToolbar.test.tsx` 更合适。

- [ ] **Step 2: 新增或补充工具栏行为测试，锁定默认动作与菜单切换行为**

建议测试内容：

```ts
it("uses removeTrailingBlankLines as initial default code cleanup action", () => {
  // render toolbar with mocked editor + mocked cleanupCodeBlocks
  // click primary button
  // expect cleanupCodeBlocks toHaveBeenCalledWith(editor, "removeTrailingBlankLines")
});

it("runs selected dropdown cleanup action immediately and updates default action", async () => {
  // open dropdown
  // click 删除空代码块
  // expect cleanupCodeBlocks toHaveBeenCalledWith(editor, "removeEmptyCodeBlocks")
  // click primary button again
  // expect cleanupCodeBlocks toHaveBeenLastCalledWith(editor, "removeEmptyCodeBlocks")
});
```

Expected: 明确 UI 行为符合需求。

- [ ] **Step 3: 运行 toolbar 测试并修正必要的可测试性问题**

Run:
```bash
pnpm vitest run src/components/markdown-editor/Toolbar/*.test.ts*
```

Expected: 初次可能因菜单 portal、Antd 渲染、context mock 不足失败；做最小测试辅助修正直到 PASS。

- [ ] **Step 4: 再跑聚合测试确保本次修改区域稳定**

Run:
```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/*.test.ts*
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/markdown-editor/Toolbar/*.test.ts*
git commit -m "test: cover toolbar code cleanup behavior"
```

### Task 6: 最终验证与收尾

**Files:**
- Modify: 仅在前述文件有必要的收尾修正
- Test: 相关测试集合

- [ ] **Step 1: 运行本次相关测试全集**

Run:
```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/*.test.ts*
```

Expected: PASS

- [ ] **Step 2: 运行 lint 或最小类型检查（若项目当前成本可接受）**

优先尝试：
```bash
pnpm eslint src/components/markdown-editor/code/codeBlockCleanup.ts src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/data.ts src/components/markdown-editor/Toolbar/DesktopToolbar.tsx
```

如项目脚本更适合，也可改为：
```bash
pnpm exec eslint src/components/markdown-editor/code/codeBlockCleanup.ts src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/data.ts src/components/markdown-editor/Toolbar/DesktopToolbar.tsx
```

Expected: 无 lint 错误；若有 warning，评估是否与本次改动相关并处理。

- [ ] **Step 3: 检查 diff，确认未引入无关改动**

Run:
```bash
git status --short
git diff -- src/components/markdown-editor/code/codeBlockCleanup.ts src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/data.ts src/components/markdown-editor/Toolbar/DesktopToolbar.tsx src/components/markdown-editor/Toolbar/SplitDropdown.tsx src/components/markdown-editor/Toolbar/*.test.ts*
```

Expected: 只有本功能相关变更。

- [ ] **Step 4: Commit**

```bash
git add src/components/markdown-editor/code/codeBlockCleanup.ts src/components/markdown-editor/code/codeBlockCleanup.test.ts src/components/markdown-editor/Toolbar/data.ts src/components/markdown-editor/Toolbar/DesktopToolbar.tsx src/components/markdown-editor/Toolbar/SplitDropdown.tsx src/components/markdown-editor/Toolbar/*.test.ts*
git commit -m "chore: finalize toolbar code cleanup feature"
```

- [ ] **Step 5: 记录手动验收清单**

手动验收应覆盖：

1. 打开含多个代码块的文档。
2. 点击“代码清理”主按钮，确认默认执行“移除代码块末尾空行”。
3. 确认中间空行保留，仅末尾空行被清除。
4. 从下拉中选择“删除空代码块”，确认立即删除空代码块并出现提示。
5. 再次点击主按钮，确认现在默认执行“删除空代码块”。
6. 在无匹配场景下执行两种动作，确认提示为“未发现…”而不是错误。

Expected: 行为与 spec 完全一致。

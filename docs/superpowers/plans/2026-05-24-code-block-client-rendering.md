# Code Block Client Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable custom code blocks and render public document code blocks in the browser from JSON placeholders.

**Architecture:** Shared code block option helpers normalize JSON attrs for both editor and public rendering. The editor keeps Tiptap's `codeBlock` node and upgrades the existing React NodeView. Public pages keep backend HTML for non-code blocks, emit code block placeholders on SSR, and hydrate those placeholders with a client renderer that uses Shiki.

**Tech Stack:** Next.js 16, React 19, Tiptap 3, Shiki 3, Vitest, TypeScript.

---

## File Structure

- Create `src/components/markdown-editor/code/codeBlockOptions.ts`: option constants, attr normalization, text extraction, and HTML escaping helpers.
- Modify `src/components/markdown-editor/code/codeHighlight.ts`: expose loaded theme names and allow explicit code block themes.
- Modify `src/components/markdown-editor/code/shikiCodeBlock.ts`: add custom code block attrs and use per-node theme attrs in the editor highlighter.
- Modify `src/components/markdown-editor/code/CodeBlockView.tsx`: render the editor status bar, settings controls, collapse states, and content classes.
- Modify `src/components/markdown-editor/styles/editor.css`: style the enhanced code block in editor and public display.
- Modify `src/services/generate-block-html.ts`: emit code block placeholders and keep non-code rendering fallback.
- Create `src/components/ClientCodeBlockRenderer.tsx`: scan placeholders on public pages and render highlighted code in the browser.
- Modify `app/doc/[slug]/page.tsx`: remove server-side code highlighting and mount the client renderer after the HTML container.
- Modify `src/services/__tests__/doc-page-ssr-rendering.test.ts`: update SSR contract tests.
- Create `src/components/markdown-editor/code/codeBlockOptions.test.ts`: cover normalization and escaping behavior.

---

### Task 1: Shared Code Block Options

**Files:**
- Create: `src/components/markdown-editor/code/codeBlockOptions.ts`
- Test: `src/components/markdown-editor/code/codeBlockOptions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/components/markdown-editor/code/codeBlockOptions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CODE_BLOCK_DEFAULTS,
  escapeCodeHtml,
  extractCodeText,
  normalizeCodeBlockAttrs,
} from "./codeBlockOptions";

describe("codeBlockOptions", () => {
  it("normalizes missing and invalid attrs to defaults", () => {
    expect(
      normalizeCodeBlockAttrs({
        language: "",
        codeTheme: "unknown",
        fontSize: "48px",
        indentMode: "weird",
        indentSize: 6,
        wordWrap: "yes",
        lineNumbers: "no",
        autoIndent: null,
        title: 42,
        statusBarCollapsed: "false",
        codeCollapsed: 1,
      }),
    ).toEqual(CODE_BLOCK_DEFAULTS);
  });

  it("keeps valid attrs and trims text attrs", () => {
    expect(
      normalizeCodeBlockAttrs({
        language: " TypeScript ",
        codeTheme: "github-dark",
        fontSize: "14px",
        indentMode: "tab",
        indentSize: 4,
        wordWrap: true,
        lineNumbers: false,
        autoIndent: false,
        title: "  Example  ",
        statusBarCollapsed: true,
        codeCollapsed: true,
      }),
    ).toEqual({
      language: "typescript",
      codeTheme: "github-dark",
      fontSize: "14px",
      indentMode: "tab",
      indentSize: 4,
      wordWrap: true,
      lineNumbers: false,
      autoIndent: false,
      title: "Example",
      statusBarCollapsed: true,
      codeCollapsed: true,
    });
  });

  it("extracts text from a Tiptap code block node", () => {
    expect(
      extractCodeText({
        type: "codeBlock",
        content: [
          { type: "text", text: "const a = 1;" },
          { type: "text", text: "\nconsole.log(a);" },
        ],
      }),
    ).toBe("const a = 1;\nconsole.log(a);");
  });

  it("escapes HTML-sensitive code text", () => {
    expect(escapeCodeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/markdown-editor/code/codeBlockOptions.test.ts`

Expected: FAIL because `codeBlockOptions.ts` does not exist.

- [ ] **Step 3: Add implementation**

Create `src/components/markdown-editor/code/codeBlockOptions.ts`:

```ts
import type { TiptapNode } from "@/services/tiptap-converter";
import { DEFAULT_CODE_LANGUAGE, normalizeCodeLanguage } from "./codeHighlight";

export type CodeBlockTheme = "auto" | "github-light" | "github-dark";
export type CodeBlockFontSize = "inherit" | "12px" | "13px" | "14px" | "16px";
export type CodeBlockIndentMode = "space" | "tab";
export type CodeBlockIndentSize = 2 | 4 | 8;

export interface CodeBlockAttrs {
  language: string;
  codeTheme: CodeBlockTheme;
  fontSize: CodeBlockFontSize;
  indentMode: CodeBlockIndentMode;
  indentSize: CodeBlockIndentSize;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoIndent: boolean;
  title: string;
  statusBarCollapsed: boolean;
  codeCollapsed: boolean;
}

export const CODE_BLOCK_DEFAULTS: CodeBlockAttrs = {
  language: DEFAULT_CODE_LANGUAGE,
  codeTheme: "auto",
  fontSize: "inherit",
  indentMode: "space",
  indentSize: 2,
  wordWrap: false,
  lineNumbers: true,
  autoIndent: true,
  title: "",
  statusBarCollapsed: false,
  codeCollapsed: false,
};

export const codeBlockThemeItems: Array<{ key: CodeBlockTheme; label: string }> = [
  { key: "auto", label: "跟随正文" },
  { key: "github-light", label: "浅色" },
  { key: "github-dark", label: "深色" },
];

export const codeBlockFontSizeItems: Array<{ key: CodeBlockFontSize; label: string }> = [
  { key: "inherit", label: "跟随正文" },
  { key: "12px", label: "12px" },
  { key: "13px", label: "13px" },
  { key: "14px", label: "14px" },
  { key: "16px", label: "16px" },
];

export const codeBlockIndentModeItems: Array<{ key: CodeBlockIndentMode; label: string }> = [
  { key: "space", label: "Space" },
  { key: "tab", label: "Tab" },
];

export const codeBlockIndentSizeItems: Array<{ key: CodeBlockIndentSize; label: string }> = [
  { key: 2, label: "2" },
  { key: 4, label: "4" },
  { key: 8, label: "8" },
];

const themes = new Set<CodeBlockTheme>(["auto", "github-light", "github-dark"]);
const fontSizes = new Set<CodeBlockFontSize>(["inherit", "12px", "13px", "14px", "16px"]);
const indentModes = new Set<CodeBlockIndentMode>(["space", "tab"]);
const indentSizes = new Set<CodeBlockIndentSize>([2, 4, 8]);

export function normalizeCodeBlockAttrs(attrs?: Record<string, unknown> | null): CodeBlockAttrs {
  const raw = attrs || {};
  const language =
    typeof raw.language === "string" && raw.language.trim()
      ? normalizeCodeLanguage(raw.language)
      : CODE_BLOCK_DEFAULTS.language;
  const codeTheme = themes.has(raw.codeTheme as CodeBlockTheme)
    ? (raw.codeTheme as CodeBlockTheme)
    : CODE_BLOCK_DEFAULTS.codeTheme;
  const fontSize = fontSizes.has(raw.fontSize as CodeBlockFontSize)
    ? (raw.fontSize as CodeBlockFontSize)
    : CODE_BLOCK_DEFAULTS.fontSize;
  const indentMode = indentModes.has(raw.indentMode as CodeBlockIndentMode)
    ? (raw.indentMode as CodeBlockIndentMode)
    : CODE_BLOCK_DEFAULTS.indentMode;
  const indentSize = indentSizes.has(raw.indentSize as CodeBlockIndentSize)
    ? (raw.indentSize as CodeBlockIndentSize)
    : CODE_BLOCK_DEFAULTS.indentSize;
  const title = typeof raw.title === "string" ? raw.title.trim() : CODE_BLOCK_DEFAULTS.title;

  return {
    language,
    codeTheme,
    fontSize,
    indentMode,
    indentSize,
    wordWrap: typeof raw.wordWrap === "boolean" ? raw.wordWrap : CODE_BLOCK_DEFAULTS.wordWrap,
    lineNumbers:
      typeof raw.lineNumbers === "boolean" ? raw.lineNumbers : CODE_BLOCK_DEFAULTS.lineNumbers,
    autoIndent:
      typeof raw.autoIndent === "boolean" ? raw.autoIndent : CODE_BLOCK_DEFAULTS.autoIndent,
    title,
    statusBarCollapsed:
      typeof raw.statusBarCollapsed === "boolean"
        ? raw.statusBarCollapsed
        : CODE_BLOCK_DEFAULTS.statusBarCollapsed,
    codeCollapsed:
      typeof raw.codeCollapsed === "boolean" ? raw.codeCollapsed : CODE_BLOCK_DEFAULTS.codeCollapsed,
  };
}

export function extractCodeText(node: Pick<TiptapNode, "content" | "text">): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map((child) => extractCodeText(child)).join("");
}

export function escapeCodeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/markdown-editor/code/codeBlockOptions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/markdown-editor/code/codeBlockOptions.ts src/components/markdown-editor/code/codeBlockOptions.test.ts
git commit -m "feat: add code block option helpers"
```

---

### Task 2: Editor Code Block Attrs and NodeView

**Files:**
- Modify: `src/components/markdown-editor/code/codeHighlight.ts`
- Modify: `src/components/markdown-editor/code/shikiCodeBlock.ts`
- Modify: `src/components/markdown-editor/code/CodeBlockView.tsx`
- Modify: `src/components/markdown-editor/styles/editor.css`

- [ ] **Step 1: Update theme helpers**

In `src/components/markdown-editor/code/codeHighlight.ts`, export a function that resolves explicit code block themes:

```ts
export const getCodeThemeByName = (theme: string): string | null => {
  if (theme === SHIKI_LIGHT_THEME || theme === SHIKI_DARK_THEME) return theme;
  return null;
};
```

- [ ] **Step 2: Add code block attrs and per-node theme highlighting**

In `src/components/markdown-editor/code/shikiCodeBlock.ts`, import `getCodeThemeByName` and `normalizeCodeBlockAttrs`. In `buildDecorations`, replace the theme calculation with:

```ts
const attrs = normalizeCodeBlockAttrs(node.attrs);
const explicitTheme = getCodeThemeByName(attrs.codeTheme);
const theme = explicitTheme || getCodeThemeByMode(getThemeMode());
const nodeLanguage = attrs.language || fallbackLanguage;
```

Extend the returned `CodeBlock` with `addAttributes()`:

```ts
addAttributes() {
  return {
    ...this.parent?.(),
    codeTheme: { default: "auto" },
    fontSize: { default: "inherit" },
    indentMode: { default: "space" },
    indentSize: { default: 2 },
    wordWrap: { default: false },
    lineNumbers: { default: true },
    autoIndent: { default: true },
    title: { default: "" },
    statusBarCollapsed: { default: false },
    codeCollapsed: { default: false },
  };
},
```

- [ ] **Step 3: Replace `CodeBlockView.tsx`**

Replace the file with a NodeView that uses `updateAttributes`:

```tsx
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  codeBlockFontSizeItems,
  codeBlockIndentModeItems,
  codeBlockIndentSizeItems,
  codeBlockThemeItems,
  normalizeCodeBlockAttrs,
  type CodeBlockAttrs,
} from "./codeBlockOptions";
import { codeLanguageItems } from "../Toolbar/data";

export default function CodeBlockView({ node, selected, updateAttributes }: NodeViewProps) {
  const attrs = normalizeCodeBlockAttrs(node.attrs);
  const lineCount = Math.max(1, (node.textContent || "").split("\n").length);

  const setAttr = <K extends keyof CodeBlockAttrs>(key: K, value: CodeBlockAttrs[K]) => {
    updateAttributes({ [key]: value });
  };

  return (
    <NodeViewWrapper
      className={[
        "code-block-view",
        selected ? "is-selected" : "",
        attrs.wordWrap ? "is-wrapped" : "",
        attrs.statusBarCollapsed ? "is-status-collapsed" : "",
        attrs.codeCollapsed ? "is-code-collapsed" : "",
      ].filter(Boolean).join(" ")}
      as="div"
      draggable={false}
      data-language={attrs.language}
      data-code-theme={attrs.codeTheme}
      style={{
        "--code-font-size": attrs.fontSize === "inherit" ? "inherit" : attrs.fontSize,
        "--code-tab-size": String(attrs.indentSize),
      } as React.CSSProperties}
    >
      {!attrs.statusBarCollapsed ? (
        <div className="code-block-status-bar" contentEditable={false}>
          <input
            className="code-block-title-input"
            value={attrs.title}
            onChange={(event) => setAttr("title", event.target.value)}
            placeholder="代码块标题"
            aria-label="代码块标题"
          />
          <select value={attrs.language} onChange={(event) => setAttr("language", event.target.value)}>
            {codeLanguageItems.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          <select value={attrs.codeTheme} onChange={(event) => setAttr("codeTheme", event.target.value as CodeBlockAttrs["codeTheme"])}>
            {codeBlockThemeItems.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          <select value={attrs.fontSize} onChange={(event) => setAttr("fontSize", event.target.value as CodeBlockAttrs["fontSize"])}>
            {codeBlockFontSizeItems.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          <select value={attrs.indentMode} onChange={(event) => setAttr("indentMode", event.target.value as CodeBlockAttrs["indentMode"])}>
            {codeBlockIndentModeItems.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          <select value={attrs.indentSize} onChange={(event) => setAttr("indentSize", Number(event.target.value) as CodeBlockAttrs["indentSize"])}>
            {codeBlockIndentSizeItems.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          <label><input type="checkbox" checked={attrs.wordWrap} onChange={(event) => setAttr("wordWrap", event.target.checked)} />自动换行</label>
          <label><input type="checkbox" checked={attrs.lineNumbers} onChange={(event) => setAttr("lineNumbers", event.target.checked)} />行号</label>
          <label><input type="checkbox" checked={attrs.autoIndent} onChange={(event) => setAttr("autoIndent", event.target.checked)} />自动缩进</label>
          <button type="button" onClick={() => setAttr("codeCollapsed", !attrs.codeCollapsed)}>
            {attrs.codeCollapsed ? "展开代码" : "折叠代码"}
          </button>
          <button type="button" onClick={() => setAttr("statusBarCollapsed", true)}>折叠状态栏</button>
        </div>
      ) : (
        <button
          type="button"
          className="code-block-status-restore"
          contentEditable={false}
          onClick={() => setAttr("statusBarCollapsed", false)}
        >
          {attrs.title || attrs.language}
        </button>
      )}
      {!attrs.codeCollapsed ? (
        <div className="code-block-body">
          {attrs.lineNumbers ? (
            <div className="code-block-line-numbers" aria-hidden="true">
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="code-block-line-number">{i + 1}</div>
              ))}
            </div>
          ) : null}
          <div className="code-block-content">
            <NodeViewContent as={"code" as "div"} spellCheck={false} />
          </div>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
```

- [ ] **Step 4: Add CSS for enhanced code blocks**

In `src/components/markdown-editor/styles/editor.css`, update the existing code block section so `.code-block-view` is a block shell and `.code-block-body` owns the flex layout. Include these rules:

```css
.tiptap-editor .code-block-view {
  margin: 16px 0;
  overflow: hidden;
  border-radius: 6px;
  border: 1px solid var(--app-border-lighter);
  background: #f6f8fa;
}

.code-block-status-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--app-border-lighter);
  background: rgba(255, 255, 255, 0.72);
}

.code-block-status-bar select,
.code-block-status-bar button,
.code-block-title-input {
  height: 28px;
  border: 1px solid var(--app-border-lighter);
  border-radius: 4px;
  background: #fff;
  color: inherit;
  font-size: 12px;
}

.code-block-title-input {
  min-width: 120px;
  max-width: 220px;
  padding: 0 8px;
}

.code-block-status-restore {
  margin: 8px;
  height: 28px;
  border: 1px solid var(--app-border-lighter);
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
}

.code-block-body {
  display: flex;
  padding: 12px 0;
}

.code-block-view.is-wrapped .code-block-content {
  overflow-x: hidden;
}

.code-block-view.is-wrapped .code-block-content > code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.code-block-content > code {
  tab-size: var(--code-tab-size, 2);
  font-size: var(--code-font-size, 13px);
}
```

- [ ] **Step 5: Type-check**

Run: `pnpm tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/markdown-editor/code/codeHighlight.ts src/components/markdown-editor/code/shikiCodeBlock.ts src/components/markdown-editor/code/CodeBlockView.tsx src/components/markdown-editor/styles/editor.css
git commit -m "feat: enhance editor code block controls"
```

---

### Task 3: SSR Code Block Placeholders

**Files:**
- Modify: `src/services/generate-block-html.ts`
- Modify: `src/services/__tests__/doc-page-ssr-rendering.test.ts`

- [ ] **Step 1: Update SSR contract tests**

In `src/services/__tests__/doc-page-ssr-rendering.test.ts`, update the code block expectation in `prefers backend block html...`:

```ts
expect(html).toContain('data-code-block-placeholder="true"');
expect(html).toContain('data-language="ts"');
expect(html).toContain("const answer = 42;");
```

Add a test that backend HTML is ignored for code blocks:

```ts
it("emits placeholders for code blocks even when backend html is present", () => {
  const tree = {
    blockId: "root_1",
    type: "root",
    payload: { type: "root", children: [] },
    children: [
      {
        blockId: "code1",
        type: "codeBlock",
        sortKey: "001000",
        html: "<pre><code>server highlighted</code></pre>",
        payload: {
          type: "codeBlock",
          attrs: { language: "javascript", title: "Demo" },
          content: [{ type: "text", text: "console.log(1);" }],
        },
        children: [],
      },
    ],
  };

  const html = renderBlockTreeToHtml(tree);

  expect(html).toContain('data-code-block-placeholder="true"');
  expect(html).toContain('data-title="Demo"');
  expect(html).toContain("console.log(1);");
  expect(html).not.toContain("server highlighted");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts`

Expected: FAIL because `renderBlockTreeToHtml` still renders code blocks as normal HTML.

- [ ] **Step 3: Implement placeholders**

In `src/services/generate-block-html.ts`, import shared helpers:

```ts
import {
  escapeCodeHtml,
  extractCodeText,
  normalizeCodeBlockAttrs,
} from "@/components/markdown-editor/code/codeBlockOptions";
```

Add:

```ts
function renderCodeBlockPlaceholder(block: Block): string {
  const node = block.payload as unknown as TiptapNode;
  const attrs = normalizeCodeBlockAttrs(node.attrs);
  const code = extractCodeText(node);
  const attrJson = escapeCodeHtml(JSON.stringify(attrs));
  return [
    `<div class="code-block-view code-block-placeholder"`,
    ` data-code-block-placeholder="true"`,
    ` data-block-id="${escapeCodeHtml(block.blockId)}"`,
    ` data-language="${escapeCodeHtml(attrs.language)}"`,
    ` data-title="${escapeCodeHtml(attrs.title)}"`,
    ` data-code-block-attrs="${attrJson}">`,
    `<pre><code>${escapeCodeHtml(code)}</code></pre>`,
    `</div>`,
  ].join("");
}
```

In the `.map((b) => { ... })` block, make the first condition:

```ts
if (b.type === "codeBlock") return renderCodeBlockPlaceholder(b);
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/generate-block-html.ts src/services/__tests__/doc-page-ssr-rendering.test.ts
git commit -m "feat: render code block placeholders on public pages"
```

---

### Task 4: Browser Code Block Renderer

**Files:**
- Create: `src/components/ClientCodeBlockRenderer.tsx`
- Modify: `app/doc/[slug]/page.tsx`
- Modify: `src/services/__tests__/doc-page-ssr-rendering.test.ts`
- Modify: `src/components/markdown-editor/styles/editor.css`

- [ ] **Step 1: Update public page tests**

In `src/services/__tests__/doc-page-ssr-rendering.test.ts`, add:

```ts
it("server page delegates code highlighting to the browser", () => {
  const pageSource = fs.readFileSync(
    path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
    "utf8",
  );

  expect(pageSource).not.toContain("highlightCodeBlocks");
  expect(pageSource).toContain("ClientCodeBlockRenderer");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts`

Expected: FAIL because the page imports `highlightCodeBlocks` and has no client renderer.

- [ ] **Step 3: Add client renderer**

Create `src/components/ClientCodeBlockRenderer.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import {
  escapeCodeHtml,
  normalizeCodeBlockAttrs,
  type CodeBlockAttrs,
} from "@/components/markdown-editor/code/codeBlockOptions";
import {
  getCodeThemeByMode,
  getCodeThemeByName,
  getShikiHighlighter,
  resolveCodeLanguageForShiki,
  type CodeThemeMode,
} from "@/components/markdown-editor/code/codeHighlight";

function readAttrs(element: HTMLElement): CodeBlockAttrs {
  const raw = element.getAttribute("data-code-block-attrs");
  if (!raw) return normalizeCodeBlockAttrs();
  try {
    return normalizeCodeBlockAttrs(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return normalizeCodeBlockAttrs();
  }
}

function readThemeMode(): CodeThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function renderFallback(code: string, attrs: CodeBlockAttrs): string {
  const lines = code.split("\n");
  const numbers = attrs.lineNumbers
    ? `<div class="code-block-line-numbers">${lines
        .map((_, index) => `<span class="code-block-line-number">${index + 1}</span>`)
        .join("")}</div>`
    : "";
  return `<div class="code-block-body">${numbers}<div class="code-block-content"><code>${escapeCodeHtml(code)}</code></div></div>`;
}

export default function ClientCodeBlockRenderer() {
  useEffect(() => {
    let cancelled = false;

    async function renderAll() {
      const placeholders = Array.from(
        document.querySelectorAll<HTMLElement>("[data-code-block-placeholder='true']"),
      );
      if (placeholders.length === 0) return;

      const highlighter = await getShikiHighlighter().catch(() => null);

      for (const element of placeholders) {
        if (cancelled || element.dataset.codeBlockRendered === "true") continue;

        const attrs = readAttrs(element);
        const code = element.querySelector("code")?.textContent || "";
        element.dataset.codeBlockRendered = "true";
        element.dataset.language = attrs.language;
        element.dataset.codeTheme = attrs.codeTheme;
        element.classList.toggle("is-wrapped", attrs.wordWrap);
        element.classList.toggle("is-status-collapsed", attrs.statusBarCollapsed);
        element.classList.toggle("is-code-collapsed", attrs.codeCollapsed);
        element.style.setProperty("--code-tab-size", String(attrs.indentSize));
        element.style.setProperty("--code-font-size", attrs.fontSize === "inherit" ? "inherit" : attrs.fontSize);

        const title = attrs.statusBarCollapsed
          ? `<button type="button" class="code-block-status-restore">${escapeCodeHtml(attrs.title || attrs.language)}</button>`
          : `<div class="code-block-status-bar"><span class="code-block-public-title">${escapeCodeHtml(attrs.title || attrs.language)}</span><span>${escapeCodeHtml(attrs.language)}</span></div>`;

        if (attrs.codeCollapsed) {
          element.innerHTML = title;
          continue;
        }

        if (!highlighter) {
          element.innerHTML = title + renderFallback(code, attrs);
          continue;
        }

        try {
          const explicitTheme = getCodeThemeByName(attrs.codeTheme);
          const theme = explicitTheme || getCodeThemeByMode(readThemeMode());
          const lang = resolveCodeLanguageForShiki(highlighter, attrs.language);
          const highlighted = highlighter.codeToHtml(code, {
            lang,
            theme,
            transformers: [
              {
                pre(node) {
                  node.properties.class = "code-block-shiki-pre";
                },
              },
            ],
          });
          const temp = document.createElement("div");
          temp.innerHTML = highlighted;
          const codeHtml = temp.querySelector("code")?.innerHTML || escapeCodeHtml(code);
          element.innerHTML = title + renderFallback(code, attrs).replace(escapeCodeHtml(code), codeHtml);
        } catch {
          element.innerHTML = title + renderFallback(code, attrs);
        }
      }
    }

    void renderAll();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
```

- [ ] **Step 4: Update public page SSR**

In `app/doc/[slug]/page.tsx`:

- Remove `import { highlightCodeBlocks } from "@/lib/highlight";`
- Add `import ClientCodeBlockRenderer from "@/components/ClientCodeBlockRenderer";`
- Replace:

```ts
const rawHtml = renderBlockTreeToHtml(data.tree);
const highlighted = await highlightCodeBlocks(rawHtml);
const html = sanitizeHtml(highlighted, {
```

with:

```ts
const rawHtml = renderBlockTreeToHtml(data.tree);
const html = sanitizeHtml(rawHtml, {
```

- Add allowed attributes:

```ts
div: ["class", "style", "data-*", "blockId", "clientId"],
button: ["type", "class", "data-*"],
```

- Render `<ClientCodeBlockRenderer />` immediately after the `dangerouslySetInnerHTML` content container.

- [ ] **Step 5: Add public CSS**

In `src/components/markdown-editor/styles/editor.css`, add:

```css
.code-block-placeholder .code-block-status-bar {
  justify-content: space-between;
  color: var(--app-text-secondary);
}

.code-block-public-title {
  font-weight: 600;
}

.code-block-view.is-code-collapsed .code-block-body {
  display: none;
}
```

- [ ] **Step 6: Run tests and type-check**

Run:

```bash
pnpm vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts
pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ClientCodeBlockRenderer.tsx app/doc/[slug]/page.tsx src/services/__tests__/doc-page-ssr-rendering.test.ts src/components/markdown-editor/styles/editor.css
git commit -m "feat: hydrate public code blocks in browser"
```

---

### Task 5: Final Verification

**Files:**
- No new files unless fixes are required.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
pnpm vitest run src/components/markdown-editor/code/codeBlockOptions.test.ts src/services/__tests__/doc-page-ssr-rendering.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full project checks**

Run:

```bash
pnpm test:unit
pnpm tsc --noEmit
pnpm lint
```

Expected: PASS, or document any unrelated pre-existing failures.

- [ ] **Step 3: Start dev server**

Run: `pnpm dev`

Expected: Next dev server starts on `http://localhost:3001`.

- [ ] **Step 4: Manual browser check**

Open an existing public document URL and inspect:

- Code block SSR output initially contains `data-code-block-placeholder="true"`.
- After hydration, placeholder has `data-code-block-rendered="true"`.
- Language, title, line numbers, wrapping, font size, theme, and collapse attrs affect rendering.
- Normal non-code blocks still render from backend HTML.

- [ ] **Step 5: Final commit for verification fixes if needed**

If fixes were required:

```bash
git add <changed-files>
git commit -m "fix: stabilize code block client rendering"
```

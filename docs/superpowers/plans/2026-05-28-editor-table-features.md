# Editor Table Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editor table interactions for hover resize affordance, cell context menu, table-region copy/paste, index-column insertion, destructive table actions, merge, and clear-content flows.

**Architecture:** Keep Tiptap table schema and built-in commands as the source of truth. Add a focused table interaction layer for cell right-click and clipboard handling, and a small table command utility module for non-built-in actions like inserting an index column and clearing selected cells.

**Tech Stack:** Next.js, React, Tiptap, ProseMirror tables, Ant Design, Vitest

---

### Task 1: Table Clipboard Utilities

**Files:**
- Create: `src/components/markdown-editor/table/tableClipboard.ts`
- Test: `src/components/markdown-editor/table/tableClipboard.test.ts`

- [ ] Add pure helpers for parsing tabular plain text, extracting table HTML, and building table HTML/text payloads.
- [ ] Add Vitest coverage for clipboard parsing and HTML generation.

### Task 2: Table Command Utilities

**Files:**
- Create: `src/components/markdown-editor/table/tableCommands.ts`

- [ ] Add helpers for selecting a target cell, clearing selected cell contents, copying selected cell ranges, inserting a leftmost index column, and table-aware paste behavior.
- [ ] Reuse ProseMirror table map APIs instead of DOM-derived row/column indexing.

### Task 3: Cell Context Menu UI

**Files:**
- Create: `src/components/markdown-editor/TableInteractions.tsx`
- Modify: `src/components/markdown-editor/MarkdownEditor.tsx`

- [ ] Add a wrapper-scoped `contextmenu` listener that opens only on `td/th`.
- [ ] Render a fixed-position Ant Design menu with the requested table actions.
- [ ] Wire copy/paste/insert/delete/merge/clear handlers to table command utilities.

### Task 4: Hover Resize Affordance

**Files:**
- Modify: `src/components/markdown-editor/styles/editor.css`

- [ ] Enhance the existing Tiptap column resize handle styles so resize lines appear on hover/focus and read clearly as interactive affordances.
- [ ] Add styles for the custom table context menu shell.

### Task 5: Verification

**Files:**
- Modify: `src/components/markdown-editor/extensions/pasteHandler.ts`

- [ ] Add tabular plain-text paste detection so pasted spreadsheet-like text becomes a table.
- [ ] Run targeted unit tests and lint the touched files if the repo configuration allows it.

# Local Snapshot Block Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace large full-JSON local snapshot diff with a block-level compare path that stays responsive on large documents.

**Architecture:** Add a focused `local-snapshot-compare` service that flattens top-level Tiptap blocks, compares by stable block identity, and reports added/deleted/modified/moved/metadata-only changes in O(n). Update the header modal to compute JSON lazily and render a summary/change list by default, retaining raw JSON views for debugging.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Ant Design.

---

### Task 1: Compare service

**Files:**
- Create: `src/services/local-snapshot-compare.test.ts`
- Create: `src/services/local-snapshot-compare.ts`

- [ ] Write tests for added/deleted/modified/moved/metadata-only block detection.
- [ ] Run `pnpm test:unit -- src/services/local-snapshot-compare.test.ts` and confirm RED.
- [ ] Implement the service minimally.
- [ ] Run the same test and confirm GREEN.

### Task 2: Header modal integration

**Files:**
- Modify: `src/components/EditorPage.tsx`
- Modify: `src/components/DocumentHeader.tsx`
- Modify: `src/components/DocumentHeader.css`
- Modify: `src/components/__tests__/document-header-local-snapshot.source.test.ts`

- [ ] Stop eager full-document JSON stringify during editing; pass current Tiptap content to the header.
- [ ] Use the compare service in the local snapshot modal.
- [ ] Render block summary and change list by default, and keep raw JSON/diff as debug modes.
- [ ] Add source-level regression assertions for block compare and lazy JSON.
- [ ] Run targeted tests and lint.

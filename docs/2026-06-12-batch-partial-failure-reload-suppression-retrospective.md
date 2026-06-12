# 2026-06-12 batch_partial_failure 客户端抑制 — 复盘（节选）

> **完整规格**：[全选删除 batch_partial_failure Agent 交接](./2026-06-12-select-all-delete-batch-partial-failure-agent-handoff.md)  
> **仓库**：`yuediter`（本提交）、`yumer-server`（draftRevision 部分失败时不 bump，见同批 server 提交）

---

## 1. 症状

全选立刻删除时，服务端 batch 部分 op 失败 → 广播 `document_reload_required`（`reason: batch_partial_failure`）→ 提交端也 `loadContent` → 半删服务端 vs 全删本地 → 内容错乱。

## 2. 客户端修复（本仓库）

`shouldSuppressBatchPartialFailureReload`：当本 tab 仍有 `dirtyOrder`、`error` 或 `inflightBatchId` 时，**不**对 `batch_partial_failure` 触发 reload。

- `src/services/sync/reducer.ts` — 判定函数
- `src/hooks/useDocumentSync.ts` — SSE `document_reload_required` 分支
- `src/services/sync/debug-log.ts` — trace 事件 `realtime:reload-suppressed`

## 3. 验证

```bash
pnpm exec vitest run src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/debug-log.test.ts
```

E2E 扩展见交接文档 §2.2。

---

*2026-06-13*

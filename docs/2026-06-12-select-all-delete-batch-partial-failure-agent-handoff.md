# 2026-06-12 全选删除触发 batch_partial_failure 导致内容错乱 — Agent 修复交接文档

> **类型**：P0 同步缺陷 / Agent 实施规格  
> **仓库**：`yuediter`（前端）、`yumer-server`（后端）  
> **用户报告日期**：2026-06-12  
> **关联设计**：[多设备实时增量同步设计 §10.4 / §24.3](./superpowers/specs/2026-06-10-multi-device-realtime-incremental-sync-design.md)  
> **关联审查**：[Delta Overlay 实现审查](./2026-06-12-delta-overlay-implementation-review.md)、[遗留项索引](./2026-06-12-delta-overlay-remaining-items.md)  
> **已有 E2E**：`e2e/sync/03-select-all-delete.spec.ts`（当前未覆盖 partial failure + reload 竞态）

---

## 1. 用户可见症状

| 症状 | 描述 |
|------|------|
| 提示/原因字符串 | 出现 `batch_partial_failure`（多为 SSE `document_reload_required` 的 `reason`，或 UI warning 原文） |
| 内容丢失 | 全选删除后，部分段落/块在编辑器或刷新后消失或复活 |
| 顺序错乱 | 块顺序与删除前不一致，`sortKey` 对齐后视觉顺序跳动 |
| 同步状态 | Header 同步指示进入 `error`，`lastError` 含 `operation: error message` 拼接 |
| 触发动作 | **Ctrl+A（全选）→ 立即 Backspace（删除）**，尤其在多块文档、autosync 尚未 idle 时更易复现 |

**用户原话摘要**：测试编辑时全选并马上删除，弹出 `batch_partial_failure`，内容乱了——有的丢了、有点乱序。

---

## 2. 复现步骤（建议 Agent 本地验证）

### 2.1 手动复现（高概率）

1. 启动 `yumer-server` + `yuediter`（确保 `diff-match-patch` 已安装）。
2. 打开文档，输入或粘贴 **≥5 个段落**（可参考用户测试时多段 `dwadadwdadddddd` 类内容）。
3. **不要等待**同步完全 idle，立即 `Ctrl+A` → `Backspace`。
4. 观察：
   - DevTools → Network：`POST .../blocks/batch` 响应 `results` 中是否存在 `success: false`；
   - SSE：是否收到 `document_reload_required`，`reason: "batch_partial_failure"`；
   - Sync Debug：导出 AI 诊断包（见 §5）。
5. 可选：删除后立即输入新文字，再刷新页面，对比服务端 `edit-content` 与编辑器。

### 2.2 自动化复现（已有套件，需扩展断言）

```bash
cd yuediter
pnpm exec playwright test e2e/sync/03-select-all-delete.spec.ts
```

当前用例覆盖「等待同步后全选删除」，**未覆盖**「同步进行中立即全选删除」与 **partial failure 不 reload**。Agent 应新增用例或单测。

### 2.3 与用户日志类似的负载特征

用户此前测试文档特征（来自 sync trace）：

- 多段落 `paragraph`，`topLevelCount: 5`
- 单次编辑 1 个 `update` 或大量 `delete` 派生
- `docId` 形如 `doc_1781270404257_7743cb67`
- autosync flush 间隔短，易出现「编辑派生未完成 + 大批量 delete 已入队」

---

## 3. 期望行为 vs 实际行为

| 维度 | 期望 | 实际（缺陷） |
|------|------|--------------|
| batch 部分失败 | 提交端保留本地编辑，重试失败 op；**不**用不完整服务端视图覆盖编辑器 | 提交端收到 `batch_partial_failure` reload，**loadContent 覆盖本地** |
| 服务端原子性 | 全失败或全成功，或至少 **draftRevision 不在 partial 时推进** | 循环内成功 op 已落库，`draftRevision` 仍 +1 |
| 其他标签页 | 可收到 reload 以拉齐状态 | 与提交端相同，无 origin 过滤 |
| 全选删除后 | 编辑器空（或单空段），服务端一致 | 服务端「删了一部分」，客户端「全删了」→ 错乱 |

---

## 4. 根因分析（代码级，含文件路径）

### 4.1 总览因果链

```text
[编辑器] Ctrl+A → Delete
    → advanceSyncSnapshot 派生大量 delete / 少量 update(create)
    → flush 选取 batch（delete 上限 500，total 500）
    → POST /blocks/batch

[服务端] for (operation of operations) { try { ... } catch { success: false } }
    → 成功 delete 已写入 block_versions / draft 指针
    → 某一 update/delete 抛错 → hasFailures = true
    → draftMutations 仍应用（未检查 hasFailures）→ draftRevision++
    → publishDocumentReloadRequired(reason: "batch_partial_failure")

[客户端 HTTP 响应] needsReload: false（HTTP 层不标 reload）
    → resolveBatchSuccess：成功 op 出队
    → applyServerDeleteAck：本地删掉「已成功」的块
    → summarizeSyncBatchFailures → syncState = "error"

[客户端 SSE] document_reload_required（无 origin 过滤）
    → handleRemoteConflict → onRemoteReloadRequired
    → loadContent() 覆盖 setContent

[结果] 本地 ACK 删一批 + 服务端 reload 拉回「半删」状态 → 丢块、乱序
```

### 4.2 服务端：batch 非原子 + partial 仍推进 draft

**文件**：`yumer-server/src/modules/blocks/blocks.service.ts`

操作循环（约 1670–1789 行）：每个 operation 独立 try/catch，**失败不 rollback 已成功 op**。

```typescript
// 约 1792–1824 行
const hasFailures = results.some((item) => !item.success);
if (shouldCreateVersion && successCount > 0 && !hasFailures) {
  await this.incrementDocumentHead(...);
} else if (!shouldCreateVersion && draftMutations.length > 0) {
  // ⚠️ 未判断 !hasFailures：部分成功也会写 draft + bump revision
  for (const mutation of draftMutations) { ... }
  docInTx.draftRevision = serverDraftRevision + 1;
  await manager.save(Document, docInTx);
  draftRevision = docInTx.draftRevision;
}
```

**reload 事件**（约 1860–1875 行）：

```typescript
const reloadEvent =
  hasFailures && draftRevision !== serverDraftRevision
    ? this.buildDocumentReloadRequiredEvent({
        docId: batchBlockDto.docId,
        serverHead: response.serverHead,
        draftRevision,
        reason: "batch_partial_failure",
      })
    : ...;
```

**HTTP 响应**（约 1838–1847 行）：`needsReload: false` —— 客户端 flush 循环**不会**走 `needsReload` 分支，但 SSE 仍会 reload。

**发布**（约 1910–1911 行）：`publishDocumentReloadRequired` 发给该 `docId` 下**所有** SSE 订阅者，**包括发起 batch 的同一标签页**。

### 4.3 客户端：partial failure 后仍 ACK + 再 reload

**文件**：`yuediter/src/hooks/useDocumentSync.ts`

**顺序问题**（约 1291–1479 行）：

1. 先 `resolveBatchSuccess(...)` —— 成功项出队；
2. 再 `applyServerDeleteAck` / `onContentPatched(ackBaseline)` —— 本地按**部分成功**改文档；
3. 最后 `if (batchFailure)` 才 `syncState = "error"` 并 `continue` 重试。

**SSE 无过滤**（约 599–601 行）：

```typescript
if (event.type === "document_reload_required") {
  handleRemoteConflict(event.reason);  // 不区分 reason / 不区分是否提交端
  return;
}
```

**Editor 覆盖**（`yuediter/src/components/EditorPage.tsx` 约 544–556 行）：

```typescript
onRemoteReloadRequired: async (reason) => {
  message.warning(reason || "...");
  const loaded = await loadContent(currentDoc.docId);
  setContent(loadedContent);  // 用服务端状态覆盖
  ...
}
```

### 4.4 与设计文档的冲突

`docs/superpowers/specs/2026-06-10-multi-device-realtime-incremental-sync-design.md`：

- **§10.4**：partial failure 不适合直接广播；应由**提交端**处理错误。
- **§24.3**：存在失败时不广播 remote ops；若状态已部分变化可 reload，但**更推荐由提交端处理失败，其他端不应用不完整变更**。

当前实现：对**提交端自己**广播 reload → 与 §24.3 意图相反。

### 4.5 全选删除为何易触发 partial failure

参考 `docs/2026-06-05-frontend-sync-stability-analysis.md` §2.1 时序：

- 大量 `delete` + 可能 `create`（空段落）+ `update`（幸存块清空）同批或连续多批；
- 若前序 create 仍在 inflight，可能派生 orphan delete / 重复 delete；
- 服务端可能错误：`update` 目标块已被同批 delete；`delete` 块已删；delta update 失败等。

**批次限制**（`yuediter/src/services/sync/batching.ts`）：

| 限制 | 值 |
|------|-----|
| total | 500 |
| delete | 500 |
| update | 100 |
| create | 100 |

超过 500 个派生 op 时会拆多批；第一批 partial fail 即可触发上述链路。

### 4.6 与历史修复的关系（避免回归）

| 文档 | 已修内容 | 与本 bug 关系 |
|------|----------|----------------|
| `docs/superpowers/reports/2026-06-05-sync-delete-tombstone-ack-retrospective.md` | delete ACK 误当 create ACK → orphan delete 循环 | 已修；本 bug 是 partial fail + reload |
| `docs/2026-06-12-sync-e2e-retrospective.md` | E2E 全选删除 | 未覆盖 partial failure |
| Delta overlay 实验 `DELTA_MIN_FULL_SIZE=0` | 小块也可能走 delta | 可能增加 update 失败面，非主因 |

---

## 5. 日志与诊断包（Agent 必读）

### 5.1 开启 Sync Debug

1. 编辑器页打开 **Sync Debug** 面板（Document Header 区域）。
2. 确认 trace 已启用（`sessionStorage` key：`sync-debug-log-enabled`）。
3. 复现问题后点击 **导出 AI 诊断包** 或 **导出完整包**。

**实现**：`yuediter/src/services/sync/debug-log.ts` — `SyncTraceLog.exportAiBundle()` / `exportBundle()`

### 5.2 完整包 JSON 顶层结构

```json
{
  "schemaVersion": 2,
  "exportedAt": 1781270498971,
  "page": "http://localhost:3001/dash/edit/...",
  "userAgent": "Mozilla/5.0 ...",
  "batchLog": [ /* 每次 POST /blocks/batch 一条 */ ],
  "traceLog": [ /* 同步状态机事件 */ ],
  "deletedIdentityWatch": [ /* 删除身份监控 */ ],
  "incidents": [ /* 如 identity:resurrected */ ]
}
```

### 5.3 batchLog 单条结构（关键字段）

```json
{
  "id": "batch_1781270490685_02ndw6",
  "timestamp": 1781270490685,
  "source": "autosync",
  "docId": "doc_1781270404257_7743cb67",
  "baseVersion": 1,
  "clientBatchId": "batch_1781270490685_02ndw6",
  "operationCount": 47,
  "requestBody": {
    "docId": "...",
    "baseVersion": 1,
    "draftRevision": 8,
    "clientBatchId": "...",
    "operations": [
      { "type": "delete", "blockId": "b_...", "data": {} },
      { "type": "update", "blockId": "b_...", "data": { "payload": { ... } } }
    ]
  },
  "responseBody": {
    "serverHead": 1,
    "draftRevision": 9,
    "needsReload": false,
    "results": [
      { "operation": "delete", "success": true, "blockId": "b_..." },
      { "operation": "update", "success": false, "blockId": "b_...", "error": "Block b_... not found" }
    ],
    "manifestDigest": "..."
  },
  "duration": 64,
  "success": true
}
```

**判定 partial failure**：

```javascript
const results = batch.responseBody.results;
const failures = results.filter(r => !r.success);
const hasPartialFailure = failures.length > 0 && failures.length < results.length;
```

注意：`batchLog[].success` 表示 **HTTP 请求成功**，不是 batch 内全部 op 成功。

### 5.4 traceLog 关键事件序（本 bug 典型）

按 `timestamp` 排序后查找：

| 事件 | 含义 | 本 bug 关注点 |
|------|------|----------------|
| `snapshot:advance` | 快照推进、派生 sync entries | `derivedEntryCount`、`dirtyOrderLength` 是否突增 |
| `queue:before-select` | flush 选批前 | `dirtyOrder` 含大量 clientId |
| `flush:dispatch` | 发出 batch | `operationCount`、`operations[].opType` |
| `flush:response` | 收到响应 | **`results[].success: false`**、`error` 文本 |
| `ack:patch` | 本地 ACK 改文档 | `beforeManifest` vs `afterManifest` 块数减少 |
| `realtime:event` | SSE | `type: "document_reload_required"` |
| `remote:conflict` | 冲突处理 | `reason: "batch_partial_failure"` |
| `editor:ack-merged` | 编辑器合并 ACK 后内容 | 与用户可见内容对比 |

**示例片段（合成，结构真实）**：

```json
{
  "event": "flush:response",
  "payload": {
    "clientBatchId": "batch_xxx",
    "draftRevision": 9,
    "resultCount": 12,
    "results": [
      { "operation": "delete", "success": true, "blockId": "b_1" },
      { "operation": "delete", "success": true, "blockId": "b_2" },
      { "operation": "update", "success": false, "blockId": "b_3", "error": "Block b_3 not found" }
    ]
  }
}
```

```json
{
  "event": "realtime:event",
  "payload": {
    "eventId": "reload_required:doc_xxx:uuid",
    "type": "document_reload_required"
  }
}
```

```json
{
  "event": "remote:conflict",
  "payload": {
    "reason": "batch_partial_failure",
    "localDraftRevision": 8,
    "remoteDraftRevision": 9
  }
}
```

### 5.5 服务端日志

**Nest logger**（`blocks.service.ts` 约 1914 行）：

```text
sync batch: docId=..., clientBatchId=..., source=autosync, operations=N, serverHead=...
```

Agent 应在服务端控制台搜索：

- `clientBatchId` 与前端 batchLog 对齐；
- 同一 batch 内异常栈（`handleBatchUpdate` / `handleBatchDelete` 抛出）。

**常见失败 error 字符串**（用于分类）：

| error / diagnosticCode | 可能原因 |
|------------------------|----------|
| `Block ... not found` | 同批先 delete 后 update |
| `DELTA_BASE_MISMATCH` | delta 基准不一致（见 delta 复盘） |
| `Base version N not found` | stale baseVer |
| `DELETE_TARGET_NOT_FOUND_BY_CLIENT_IDENTITY` | 通常 tombstone 成功，不应计 failure |

客户端 `summarizeSyncBatchFailures`（`batch-failure.ts`）**排除**：幂等 delete not-found、`DELTA_BASE_MISMATCH`。

### 5.6 Network 面板检查清单

1. `POST /api/.../blocks/batch` — 请求体 `operations` 类型分布（delete/update/create）。
2. 响应 `results` — 第一个 `success: false` 的 `operation` + `error`。
3. `GET .../edit-content` 或 reload 触发的文档加载 — 响应树块数 vs 编辑器块数。
4. EventSource / SSE — `document_reload_required` 是否在 failed batch **之后**抵达。

---

## 6. 推荐修复方案（Agent 实施规格）

### 6.1 P0 — 客户端：提交端忽略 batch_partial_failure reload

**目标**：本地仍有未同步内容或已处于 error 重试时，**不要** `loadContent` 覆盖编辑器。

**文件**：`yuediter/src/hooks/useDocumentSync.ts` — `handleRealtimeEvent`

**建议逻辑**：

```typescript
if (event.type === "document_reload_required") {
  const current = stateRef.current;
  const isSubmittingTabPartialFail =
    event.reason === "batch_partial_failure" &&
    current &&
    (current.dirtyOrder.length > 0 ||
      current.syncState === "error" ||
      current.inflightBatchId !== null);

  if (isSubmittingTabPartialFail) {
    addSyncTrace("realtime:reload-suppressed", ...);
    return;
  }
  handleRemoteConflict(event.reason);
  return;
}
```

**注意**：

- 其他标签页 / 干净只读态可能仍需要 reload；可用 `dirtyOrder === 0 && syncState === 'idle'` 允许 reload。
- 需在 `debug-log.ts` 的 `SyncTraceEvent` 增加 `realtime:reload-suppressed`（若加 trace）。

**可选加强**：`EditorPage.tsx` `onRemoteReloadRequired` 对 `reason === 'batch_partial_failure'` 二次守卫。

### 6.2 P0 — 服务端：partial failure 不推进 draftRevision

**目标**：有 `hasFailures` 时不写 `draftMutations`、不 `draftRevision++`，减少「半成功」服务端视图。

**文件**：`yumer-server/src/modules/blocks/blocks.service.ts` 约 1796 行

```typescript
} else if (!shouldCreateVersion && draftMutations.length > 0 && !hasFailures) {
```

**讨论**：循环内 block 级写入已发生，仅阻止 draft 指针推进**不能**完全回滚已删块；但可避免 reload 条件 `draftRevision !== serverDraftRevision` 误触发，并降低其他端读到不一致 draft。

**更彻底（P1，可选）**：整批包在 `hasFailures` 时 `throw` 触发事务回滚（需评估性能与 idempotency receipt）。

### 6.3 P1 — 服务端：partial failure 不向提交会话发 reload

**目标**：对齐设计 §24.3。

**选项 A**：`hasFailures` 时不 `publishDocumentReloadRequired`（仅 HTTP 返回 results 给提交端）。

**选项 B**：reload 事件增加 `originClientId` / `originTabId` / `clientBatchId`，客户端忽略自身 batch。

**相关**：`buildDocumentReloadRequiredEvent`（约 695 行）、`document-realtime.types.ts`。

### 6.4 P1 — 客户端：partial failure 时谨慎 ACK patch

**问题**：`resolveBatchSuccess` + `applyServerDeleteAck` 在 `batchFailure` 判定**之前**执行。

**选项**：

- 先 `summarizeSyncBatchFailures`，若 partial fail 则**跳过** `onContentPatched(ackBaseline)`，仅保留队列重试；或
- 仅 ACK 与失败 op 无冲突的 delete（需精细映射）。

**文件**：`useDocumentSync.ts` 1291–1479 行。

**风险**：完全不 ACK 成功 delete 会导致队列与编辑器不一致；需单测权衡。

### 6.5 P2 — 全选删除派生顺序优化

减少同批「先删后改」冲突：

- 审查 `engine.ts` / `snapshot.ts` 派生 delete vs update 顺序；
- batch 内是否应 delete 优先（服务端已按请求数组顺序执行）。

---

## 7. 测试计划（Agent 完成定义）

### 7.1 单元测试 — 客户端

| 用例 | 文件建议 |
|------|----------|
| `document_reload_required` + `batch_partial_failure` + `dirtyOrder.length > 0` → 不调用 `onRemoteReloadRequired` | `useDocumentSync` 测试或 source test |
| partial failure 时 `summarizeSyncBatchFailures` 非 null + `resolveBatchSuccess` 后 failed entry 仍在队列 | 已有 `reducer.test.ts` 可扩展 |

### 7.2 单元测试 — 服务端

| 用例 | 文件建议 |
|------|----------|
| batch 含 1 成功 delete + 1 失败 update → `draftRevision` **不变** | `blocks-sync-idempotency.spec.ts` 已有 partial 用例可扩展 |
| `hasFailures` 时不 `publishDocumentReloadRequired` | mock `documentRealtimeService` |

### 7.3 E2E

扩展 `e2e/sync/03-select-all-delete.spec.ts`：

```typescript
test("同步进行中立即全选删除，不应因 batch_partial_failure 丢失内容", async ({ page }) => {
  await createParagraphBlocks(page, 20, "mid-sync");
  // 不 waitForDraftSynced
  await selectAllAndDelete(page);
  await typeInEditor(page, "recovery-text");
  await waitForDraftSynced(page, { timeoutMs: 120_000 });
  // 断言无 batch_partial_failure reload 覆盖（可通过 trace / 文本）
});
```

### 7.4 手动验收

- [ ] 5 块文档：同步中全选删除 → 输入新字 → 刷新 → 仅新字
- [ ] Sync Debug 无 `remote:conflict` + `batch_partial_failure` 紧接 `flush:response` partial fail
- [ ] 双标签页：A 提交 partial fail，B 行为符合产品定义（reload 或保持）

---

## 8. 涉及文件速查

| 仓库 | 路径 | 作用 |
|------|------|------|
| yuediter | `src/hooks/useDocumentSync.ts` | flush、ACK、SSE reload |
| yuediter | `src/components/EditorPage.tsx` | `onRemoteReloadRequired` → loadContent |
| yuediter | `src/services/sync/batch-failure.ts` | `summarizeSyncBatchFailures` |
| yuediter | `src/services/sync/reducer.ts` | `resolveBatchSuccess` partial |
| yuediter | `src/services/sync/engine.ts` | `applyServerDeleteAck` |
| yuediter | `src/services/sync/batching.ts` | 批次上限 |
| yuediter | `src/services/sync/debug-log.ts` | 诊断包 |
| yuediter | `src/services/realtime/types.ts` | `batch_partial_failure` 类型 |
| yumer-server | `src/modules/blocks/blocks.service.ts` | batch 循环、draft、reload |
| yumer-server | `src/modules/realtime/document-realtime.service.ts` | SSE publish |
| yumer-server | `src/modules/realtime/document-realtime.types.ts` | reload 事件类型 |

---

## 9. Agent 任务清单（按顺序执行）

1. [ ] 按 §2 复现并导出一份 `exportAiBundle` 附在 PR 描述或 commit body。
2. [ ] 实现 §6.1 + §6.2（最低可交付）。
3. [ ] 补 §7.1–7.2 单测，跑通：
   - `yuediter`: `pnpm exec vitest run src/services/sync/__tests__/`
   - `yumer-server`: `npm test -- --testPathPatterns=blocks-sync-idempotency`
4. [ ] 评估 §6.4 是否在本 PR 必须做；若不做，在 PR 中说明残留风险。
5. [ ] 扩展 E2E 或注明 follow-up issue。
6. [ ] 更新本文档 §10 完成状态；可选更新 `2026-06-12-delta-overlay-remaining-items.md`。

---

## 10. 完成状态（Agent 填写）

| 项 | 状态 | PR / commit |
|----|------|-------------|
| §6.1 客户端抑制 reload | ⏳ | |
| §6.2 服务端不 bump draft on partial | ⏳ | |
| §6.3 服务端 reload 策略 | ⏳ | |
| §6.4 ACK patch 顺序 | ⏳ | |
| §7 测试 | ⏳ | |

---

## 11. 相关历史文档

- [2026-06-05 前端同步稳定性分析](./2026-06-05-frontend-sync-stability-analysis.md) — 全选删除时序
- [2026-06-05 sync-delete-tombstone-ack 复盘](./superpowers/reports/2026-06-05-sync-delete-tombstone-ack-retrospective.md)
- [2026-06-12 sync E2E 复盘](./2026-06-12-sync-e2e-retrospective.md)
- [2026-05-31 空文档同步复盘](./2026-05-31-empty-document-sync-retrospective.md)

---

*文档版本：2026-06-12 v1。供修复 Agent 直接实施；修复后请回填 §10 并附真实日志片段。*

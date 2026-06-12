# 2026-06-12 会话内新建块无法走 Delta — 复盘

> **类型**：P1 同步缺陷 / 已修复  
> **仓库**：`yuediter`（客户端）、`yumer-server`（服务端）  
> **关联**：[Delta Overlay 实现审查](./2026-06-12-delta-overlay-implementation-review.md)、[遗留项索引](./2026-06-12-delta-overlay-remaining-items.md)

---

## 1. 用户可见症状

| 现象 | 描述 |
|------|------|
| 已有块正常 | 页面加载时已存在的块，小改动可发 `data.delta` |
| 新建块异常 | 同页会话中 **新插入/新建的块**，后续编辑始终发全量 `data.payload` |
| 刷新后恢复 | 硬刷新后，这些块随 `edit-content` 重新加载，delta 又正常 |
| 体积无关 | 36KB 级 codeBlock 亦如此，排除「体积门槛 / patch 比例」误判 |

---

## 2. 根因

Delta 上行依赖客户端 `SyncBaseStore` 中 per-block 的同步基准 `{ ver, hash, canonical }`。基准只有两个来源：

```text
页面 load  → seedSyncBaseStoreFromBlocks(block.ver + payload)
batch ACK  → recordAck({ ver: result.version, payload })
```

| 块来源 | 基准写入路径 |
|--------|----------------|
| 加载时已有 | `loadDocumentContentV2` → seed（带 `ver`） |
| 会话内新建 | create/update **成功 ACK** 后 → `recordAck` |

`useDocumentSync` 中 `recordAck` 的门槛（节选）：

```typescript
if (
  result.success &&
  ackPayload &&
  result.blockId &&
  typeof result.version === "number" &&
  (result.operation === "update" || result.operation === "create")
) {
  baseStore.recordAck({ blockId, ver: result.version, payload: ackPayload });
}
```

**缺失 `result.version` → 新建块 ACK 后 baseStore 无条目 → 下一次 update 只能发全量。**

### 2.1 服务端：batch 响应误剥离 `version`

`buildSyncBatchResponse` 在精简响应时，曾将内部字段 `resolvedPayload` 与 **`version` 一并解构丢弃**。DTO 与 OpenAPI 均声明 `results[].version` 为 create/update/delete 的 ack 字段，客户端契约依赖该值。

### 2.2 测试反向误导

`blocks-sync-idempotency.spec.ts` 中 compact ack 用例曾断言 `not.toHaveProperty("version")`，与运行时契约及 DTO 文档不一致，掩盖了回归。

### 2.3 为何刷新后「好了」

刷新走 `GET .../edit-content`，树节点带 `ver` / `hash`，`seedSyncBaseStoreFromBlocks` 重新播种，新建块在语义上变成「加载时已存在的块」。

---

## 3. 修复

| 层级 | 变更 |
|------|------|
| **yumer-server** | `buildSyncBatchResponse` 仅剥离 `resolvedPayload`，**保留 `version`** 返回客户端 |
| **yumer-server 测试** | compact ack 用例改为期望 `version: 1`；delete ack 等用例同步带上 `version` |
| **yuediter 测试** | `base-store.test.ts`：`recordAck` 模拟 create ACK 后，同页 update 应走 delta |

客户端 `recordAck` / `buildSyncBatchOperations` **无需改逻辑**，修复服务端契约即可。

---

## 4. 验证

### 4.1 手动

1. 重启 `yumer-server`，打开文档（无需硬刷新前端若已热更）。
2. 新建 codeBlock，粘贴 ≥8KB 文本，等待 create batch 成功。
3. 再改一个字符 → Network 中 `/blocks/batch` 的 update 应为 `data.delta`，且 `baseVer` 为 create 返回的版本号。

### 4.2 自动化

```bash
# yuediter
pnpm exec vitest run src/services/sync/__tests__/base-store.test.ts

# yumer-server
npm test -- --testPathPatterns=blocks-sync-idempotency.spec
```

---

## 5. 经验与后续

1. **compact 响应不得删契约字段**：`version` 是 delta 链的客户端状态机输入，不是可随意省略的冗余。
2. **新建块与加载块应同等对待**：任何只 seed 加载路径、忽略 live create ACK 的设计都会在「同页编辑」场景暴露。
3. **遗留项**：Hook 级「create ACK → 下一笔 flush 走 delta」E2E 仍见 [遗留项 §2.3](./2026-06-12-delta-overlay-remaining-items.md)。

---

## 6. 相关文档

- [2026-06-12 Delta Overlay + Compaction 混合同步复盘](./2026-06-12-delta-overlay-sync-retrospective.md)
- [2026-06-12 Delta Overlay Review Fixes 复盘](./2026-06-12-delta-overlay-review-fixes-retrospective.md)
- [2026-06-12 全选删除 batch_partial_failure 交接](./2026-06-12-select-all-delete-batch-partial-failure-agent-handoff.md)（同期 partial failure 修复，独立缺陷）

---

*最后更新：2026-06-13。*

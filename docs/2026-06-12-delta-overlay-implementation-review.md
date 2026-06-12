# 2026-06-12 Delta Overlay 实现审查报告

> 对前后端 delta overlay 同步实现的代码审查、测试执行与隐患梳理  
> 涉及仓库：`yuediter`（客户端）、`yumer-server`（服务端）  
> 审查日期：2026-06-12

---

## 1. 审查范围

### 1.1 客户端（yuediter）

| 模块 | 路径 |
|------|------|
| 策略常量 | `src/services/sync/delta-policy.ts` |
| 核心算法 | `src/services/sync/delta.ts`、`delta-encoding.ts` |
| 基线存储 | `src/services/sync/base-store.ts` |
| 批次构建 | `src/services/sync/api.ts` |
| 失败处理 | `src/services/sync/batch-failure.ts` |
| ACK / rescan | `src/services/sync/snapshot.ts` |
| Hook 集成 | `src/hooks/useDocumentSync.ts`（delta 相关路径） |
| 测试 | `src/services/sync/__tests__/*delta*`、`base-store`、`api`、`batch-failure*`、`ack-rescan-filter`、`snapshot-ack-skip` |

### 1.2 服务端（yumer-server）

| 模块 | 路径 |
|------|------|
| 策略常量 | `src/modules/blocks/block-delta/delta-policy.ts` |
| 核心算法 | `src/modules/blocks/block-delta/block-delta.ts` |
| Payload 重建 | `src/modules/blocks/block-delta/block-payload-resolver.service.ts` |
| codeBlock 归一化 | `src/modules/blocks/block-delta/sync-code-block-attrs.ts` |
| 写入路径 | `src/modules/blocks/blocks.service.ts`（batch / 单块 update） |
| GC 保护 | `src/modules/gc/modules/block-version/gc-delta-chain.util.ts` |
| E2E | `test/document-sync.e2e-spec.ts`（`delta overlay sync` 段） |

### 1.3 当前策略配置（实验态）

两端 `delta-policy.ts` 当前值（须手动保持同步）：

| 常量 | 当前值 | 说明 |
|------|--------|------|
| `DELTA_FORMAT` | `"dmp-v1"` | diff-match-patch 补丁格式 |
| `DELTA_MIN_FULL_SIZE` | `0` | 实验：不按体积门槛拦截（生产默认 8KB） |
| `DELTA_MAX_RATIO` | `0.5` | patch 体积 ≤ 全量 50% 才走 delta |
| `COMPACTION_CHAIN_LIMIT` | `12` | 服务端 delta 链达此长度时落全量压实 |
| `DELTA_REFERENCE_LARGE_BLOCK_BYTES` | `8192` | 仅测试 fixture 用 |

---

## 2. 测试执行结果

### 2.1 客户端

```bash
cd yuediter
pnpm exec vitest run \
  src/services/sync/__tests__/delta.test.ts \
  src/services/sync/__tests__/base-store.test.ts \
  src/services/sync/__tests__/api.test.ts \
  src/services/sync/__tests__/batch-failure-delta.test.ts \
  src/services/sync/__tests__/batch-failure.test.ts \
  src/services/sync/__tests__/ack-rescan-filter.test.ts \
  src/services/sync/__tests__/snapshot-ack-skip.test.ts \
  src/services/sync/__tests__/engine-order.test.ts
```

| 指标 | 结果 |
|------|------|
| 测试文件 | 8 passed |
| 测试用例 | **51 passed** |
| 失败 | 0 |

### 2.2 服务端

```bash
cd yumer-server
npm test -- --testPathPatterns="block-delta|gc-delta-chain|batch-block.dto|block-payload-resolver"
```

| 套件 | 结果 |
|------|------|
| `block-delta.spec.ts` | ✅ 通过 |
| `gc-delta-chain.util.spec.ts` | ✅ 通过 |
| `batch-block.dto.spec.ts` | ✅ 通过 |
| `block-payload-resolver.service.spec.ts` | ❌ **1 项失败** |

| 指标 | 结果 |
|------|------|
| 测试文件 | 3 passed, **1 failed** |
| 测试用例 | 12 passed, **1 failed** |

**失败用例**：`BlockPayloadResolverService › reconstructs delta chains`

- **现象**：期望 `resolved.get("doc_1:b1:2")` 等于精简 attrs 的 `nextPayload`，实际返回含 11 个 codeBlock 默认 attrs 字段的归一化结果。
- **定性**：测试期望值过时；delta 重建路径会经 `applyDelta` → `parseCanonicalPayload` → `normalizeSyncCodeBlockAttrs` 展开 attrs。该失败同时暴露了下文 **§4.1** 的全量/delta 路径输出不一致问题。

### 2.3 运行期依赖注意

服务端运行需已安装 `diff-match-patch`（`package.json` 已声明）。若 `node_modules` 未安装，所有 update 会报 `Cannot find module 'diff-match-patch'`，客户端进入 error 态并按 2s 退避自动重试，表现为「一次编辑两次请求」。

---

## 3. 架构概览

### 3.1 数据流

```text
文档加载
  └─ seedSyncBaseStoreFromBlocks()     ← 播种 blockId → { ver, canonical }
       └─ SyncBaseStore（按 docId 隔离）

用户编辑
  └─ engine.deriveSyncEntriesWithMetrics()  ← fingerprint diff → SyncEntry[]
  └─ api.buildSyncBatchOperations()
       ├─ base 存在 && !forceFull && shouldSendDelta → buildBlockDelta → 发 delta
       └─ 否则 → 发全量 payload
  └─ postSyncBatchWithRetry() → POST /blocks/batch

服务端 batch 路径
  └─ handleBatchUpdate
       ├─ shouldAcceptClientDelta()     ← 校验 baseHash / resultHash
       ├─ resolveBlockPayload()           ← 从 DB 重建 base
       ├─ mergePayloadPreservingSyncAttrs()
       └─ shouldStoreDelta()              ← 决定落库形态
            ├─ true  → payloadKind=delta, storedPayload=null
            └─ false → payloadKind=full（含链长≥12 的 inline compaction）

ACK 回客户端
  ├─ DELTA_BASE_MISMATCH → forceFullResync(blockId) → 同轮 flush 立刻全量重发
  ├─ update/create 成功 → recordAck() 更新 baseStore
  └─ filterRedundantAckRescanEntries()  ← 去掉 ACK rescan 重复 update
```

### 3.2 设计原则（已落实）

| 原则 | 说明 |
|------|------|
| 传输与存储解耦 | 客户端决定发 delta 还是全量；服务端重建完整 payload 后再决定存 delta 还是全量 |
| Compaction 仅服务端 | `COMPACTION_CHAIN_LIMIT` 在 `shouldStoreDelta` 中生效；客户端只 re-export 常量作对齐 |
| MISMATCH 单块回退 | `DELTA_BASE_MISMATCH` 不算 batch 级失败，同轮 flush 内改发全量 |
| 失败自动重试 | sync error 态指数退避（2s 起，封顶 30s）排空脏队列 |
| GC delta 链保护 | `expandDeltaChainResourceKeys` 保护 `[baseVer..ver]` 整链不被误 GC |

### 3.3 模块依赖关系（客户端）

```text
delta-policy.ts          ← 策略常量（单点调参）
    ↓
delta.ts                 ← canonicalStringify / computeDelta / buildBlockDelta / shouldSendDelta
    ↓
delta-encoding.ts        ← re-export + stripPayloadForSync
    ↓
base-store.ts / api.ts / snapshot.ts / batch-failure.ts
    ↓
useDocumentSync.ts
```

---

## 4. 问题与隐患

严重度：**Critical** > **High** > **Medium** > **Low**

### 4.1 🔴 High — 全量路径与 delta 重建路径返回结构不一致

**位置**：`yumer-server` `block-payload-resolver.service.ts`

```typescript
// 全量版本：直接返回 DB 原始 payload
if (this.isFullVersion(version)) {
  const payload = version.payload as object;
  ...
}

// delta 版本：applyDelta 后经 canonical 归一化（含 codeBlock attrs 默认值展开）
const canonicalText = applyDelta(currentPayload, row.delta, ...);
currentPayload = parseCanonicalPayload(canonicalText);
```

**影响**：

- 同一 block 在「最近版本为全量」vs「最近版本为 delta」时，`resolveBlockPayload` 返回结构不同；
- 后续 `shouldStoreDelta` / `computeDelta` 的 base 不稳定；
- 可能加剧 `DELTA_BASE_MISMATCH` 或静默退化为全量传输；
- 与失败单测 `#2.2` 直接相关。

**建议**：全量路径同样走 `ensurePayloadType` + codeBlock `normalizeSyncCodeBlockAttrs`，与 delta 重建输出对齐。

---

### 4.2 🔴 High — 两套哈希空间，缺少显式约束

| 函数 | 位置 | 用途 | 算法 |
|------|------|------|------|
| `hashPayloadCanonical` | `block-delta.ts` / `delta.ts` | delta 的 `baseHash` / `resultHash` | canonical JSON（排序 key、剥 sync attrs、CRLF 归一） |
| `calculateHash` | `blocks.service.ts` | `BlockVersion.hash` 幂等判断 | 原始 `JSON.stringify` |

两者对同一 payload 产生不同哈希。目前靠约定分开使用，**无注释或类型约束**。若误用 `BlockVersion.hash` 做 delta 校验会导致隐蔽错误。

**建议**：为 `calculateHash` 改名或加注释（如 `calculateVersionHash`），文档化其与 delta hash 的分工。

---

### 4.3 🔴 High — 客户端-服务端 canonical 规则无跨端契约测试

`delta-policy.ts` 注释要求两端手动对齐，但：

- 无共享 fixture 在两端同时跑 hash 对比；
- `normalizeCodeBlockAttrs`（客户端）与 `normalizeSyncCodeBlockAttrs`（服务端）靠人工保持一致。

一旦漂移 → `DELTA_BASE_MISMATCH` → 同轮 flush 内全量重发（「双请求」症状之一）。

**已对齐项**（审查确认）：

| 项目 | 状态 |
|------|------|
| `SYNC_ATTR_KEYS`（11 个） | ✅ 一致 |
| `COMMON_LANG_ALIASES` | ✅ 一致 |
| codeBlock attrs 字段列表 | ✅ 一致 |
| `DELTA_FORMAT` / `DELTA_MAX_RATIO` / `COMPACTION_CHAIN_LIMIT` | ✅ 一致 |
| `canonicalPayloadSize`（TextEncoder vs Buffer） | ✅ 对合法 UTF-8 等价 |

**建议**：用 `delta-fixtures.json` 做双端 golden hash 测试，纳入 CI。

---

### 4.4 🟡 Medium — 客户端 `computeDelta` 重复计算

**位置**：`yuediter` `api.ts` `buildSyncBatchOperations`

对同一 block：

1. `shouldSendDelta()` 内部调用 `computeDelta`；
2. `buildBlockDelta()` 再次调用 `computeDelta`；
3. `JSON.parse(base.canonical)` 最多执行 3 次。

大 codeBlock（≥8KB）时 DMP patch 计算开销翻倍。

**建议**：合并为一次 patch 计算；循环顶部缓存 `baseObj = JSON.parse(base.canonical)`。

---

### 4.5 🟡 Medium — 实验配置 `DELTA_MIN_FULL_SIZE = 0` 效果有限

即使体积门槛为 0，小块编辑仍常被 `DELTA_MAX_RATIO = 0.5` 挡住：

| 场景 | patch 占比 | 走 delta？ |
|------|-----------|-----------|
| `"a"` → `"ab"` | ~85% | ❌ |
| 普通段落加一个字符 | ~55% | ❌ |
| 8KB codeBlock 改一字 | <50% | ✅ |

「所有块走 delta」实验目前主要对**大块、小改动**有效。若要让小块也走 delta，需同步调高 `DELTA_MAX_RATIO`（如 `1.0`）。

---

### 4.6 🟡 Medium — 多步 delta 链测试覆盖不足

| 场景 | 单元测试 | E2E |
|------|---------|-----|
| 单步 delta 重建 | 有（1 失败） | 有 |
| 多步链 A→B→C | ❌ 无 | 部分（compaction 循环 12 次） |
| `DELTA_RESULT_MISMATCH` | ❌ 无 | ❌ 无 |
| compaction 后全量内容正确性 | ❌ 无 | 有 |
| `DELTA_BASE_MISMATCH` → forceFull → 全量 → recordAck 完整链路 | ❌ 无 | 有 MISMATCH 场景 |

---

### 4.7 🟡 Medium — `BatchBlockDto` 装饰器与 TypeScript 类型矛盾

`baseVersion?: number` / `clientBatchId?: string` 在 TypeScript 中为可选，但 `@IsDefined()` 要求运行时必填。静态类型无法发现构造错误。

---

### 4.8 🟢 Low — 单块 PUT 与 batch 存储行为不对称

- `POST /blocks/batch`：接受 delta，且 `shouldStoreDelta` 决定存 delta 行；
- `PUT /blocks/:id`：接受 delta 上行，但写入时**始终存全量**。

autosync 走 batch 路径，当前无实际影响；单块 API 调用方需注意。

---

### 4.9 🟢 Low — 其他

| 项 | 说明 |
|----|------|
| `forceFullResync` 持久化 | 全量发送若持续失败，`forceFullBlockIds` 不清除，每次 flush 都发全量（保守安全，缺调试可见性） |
| `delta-encoding.ts` 职责 | 纯 re-export + `stripPayloadForSync`，与 `delta.ts` 导入路径不统一 |
| Resolver LRU 缓存 | `remember` 命中时不刷新 `cacheOrder`，正常流程影响极低 |
| GC 链扩展复杂度 | `expandDeltaChainResourceKeys` 不动点算法，正常 chain≤12 无压力 |

---

## 5. 客户端-服务端契约字段

| 字段 | 客户端发出 | 服务端验证 | 风险 |
|------|-----------|-----------|------|
| `format` | `"dmp-v1"` | 解析前检查 | 低 |
| `baseVer` | `base.ver`（来自 seed / recordAck） | 按版本号取 DB 记录 | 中（ACK 丢失可 stale） |
| `baseHash` | `hashPayloadCanonical(canonicalize(base))` | 必须与 DB 该版本 canonical 匹配 | **高** |
| `resultHash` | `hashPayloadCanonical(canonicalize(next))` | 验证 patch 应用结果 | **高** |
| `patch` | DMP `patch_toText` | 同版本 `diff-match-patch` 库 | 中 |

最大合约风险：**codeBlock attrs 归一化漂移** → 每次 delta 都 MISMATCH → 静默退化为全量。

---

## 6. 已验证的健壮行为

以下设计经代码审查与测试确认工作正常：

1. **`DELTA_BASE_MISMATCH` 不算 batch 失败**（`batch-failure.ts`），允许同轮 flush 内单块回退全量。
2. **ACK rescan 去重**（`filterRedundantAckRescanEntries` / `snapshot-ack-skip.test.ts`）。
3. **error 态自动重试**（`useDocumentSync.ts` 2s 指数退避），服务端模块错误时表现为「双请求」实为失败重试，非 phantom rescan。
4. **GC delta 链保护**（`gc-delta-chain.util.spec.ts`）正确扩展 `[baseVer..ver]` 保留区间。
5. **Compaction 内联压实**（E2E：12 次更新后 `payloadKind=full`）。

---

## 7. 缺失测试覆盖清单

| 优先级 | 场景 | 状态（2026-06-12 follow-up） |
|--------|------|------|
| 🔴 High | 修复 `block-payload-resolver.service.spec.ts` 期望值；统一全量/delta resolve 路径后补回归 | ✅ 已完成：`block-payload-resolver.service.spec.ts` 覆盖 full codeBlock canonical 输出与 delta reconstruction |
| 🔴 High | 双端 `delta-fixtures.json` golden hash 契约测试 | ✅ 已完成：前端 `delta.test.ts`、后端 `block-delta.spec.ts` 校验 fixture `baseHash` / `nextHash` |
| 🔴 High | `DELTA_BASE_MISMATCH` → `forceFullResync` → 全量成功 → `recordAck` 清除 forceFull 集成测试 | ✅ 已完成：前端 `base-store.test.ts` 覆盖 forceFull 后全量发送、ACK 后清除并恢复 delta |
| 🟡 Medium | 多步 delta 链（≥3 步）单元测试 | ✅ 已完成：后端 resolver 三步 delta 链重建测试 |
| 🟡 Medium | `DELTA_RESULT_MISMATCH` 分支 | ✅ 已完成：后端 `shouldAcceptClientDelta` resultHash mismatch 分支测试 |
| 🟡 Medium | `BatchBlockDto` 必填运行时校验与 TypeScript 类型一致 | ✅ 已完成：`baseVersion` / `clientBatchId` 改为必填类型，保留 `@IsDefined()` |
| 🟡 Medium | `seedSyncBaseStoreFromBlocks` 按 docId 隔离 | ✅ 已完成：前端 `base-store.test.ts` 覆盖同 blockId 跨 doc 隔离 |
| 🟡 Medium | `postSyncBatchWithRetry` 幂等重试 | ✅ 已完成：前端 `api.test.ts` 覆盖 retryable error 后同 `clientBatchId` 重发 |
| 🟢 Low | 单块 PUT + delta 上行 E2E | ⏳ 未处理：低优先级，仍需后续 E2E |
| 🟢 Low | `sha256Hex` 在 `crypto.subtle` 不可用时的行为 | ⏳ 未处理：低优先级，仍需后续兼容性测试 |

---

## 8. 建议修复顺序

| 阶段 | 动作 | 状态（2026-06-12 follow-up） |
|------|------|------|
| **立即** | 修复 `block-payload-resolver.service.spec.ts`；统一 `resolveBlockPayload` 全量/delta 两条路径输出格式 | ✅ 已完成并单独提交：`fix(blocks): normalize resolved full payloads` |
| **短期** | 客户端消除重复 `computeDelta`；补充多步 delta 链单元测试 | ✅ 已完成：`buildBlockDeltaIfUseful` + 后端三步链测试 |
| **短期** | 确保部署环境 `pnpm install` 含 `diff-match-patch` | ✅ 已确认：前后端 `package.json` 均声明 `diff-match-patch`；安装状态由部署流程保证 |
| **中期** | 建立跨端 canonical golden 测试；明确两套 hash 用途文档 | ✅ 已完成：双端 golden hash 单测；后端 `calculateVersionHash` 注释区分 version hash 与 `hashPayloadCanonical` |
| **按需** | 实验「全块 delta」时同步调整 `DELTA_MAX_RATIO`；生产恢复 `DELTA_MIN_FULL_SIZE = 8 * 1024` | ⏳ 未处理：策略调参不在本轮测试补齐范围 |

---

## 9. 相关文档

- [2026-06-12 会话内新建块 Delta 复盘](./2026-06-12-delta-live-create-ack-retrospective.md) — batch ACK 保留 `version` 以播种 live-create 的 delta base
- [2026-06-12 全选删除 batch_partial_failure Agent 交接](./2026-06-12-select-all-delete-batch-partial-failure-agent-handoff.md) — P0 同步缺陷修复规格（含日志与测试计划）
- [2026-06-12 Delta Overlay 遗留项与已知限制](./2026-06-12-delta-overlay-remaining-items.md) — Low 优先级项、实验策略、caveat 与建议处理顺序
- [2026-06-12 Delta Overlay Review Fixes 复盘](./2026-06-12-delta-overlay-review-fixes-retrospective.md) — follow-up 修复记录
- [2026-06-12 Delta Overlay + Compaction 混合同步复盘](./2026-06-12-delta-overlay-sync-retrospective.md) — 初版实现、MISMATCH 排查、双请求根因
- [2026-06-11 同步稳定性加固复盘](./2026-06-11-sync-stability-hardening-retrospective.md) — 更早的 sync 稳定性工作

---

## 10. 严重度汇总

| 严重度 | 条目 | 状态（2026-06-12 follow-up） |
|--------|------|------|
| **Critical** | —（无阻塞性逻辑错误；1 个单测失败为期望值问题） | ✅ 仍无 Critical |
| **High** | 全量/delta resolve 路径不一致；两套 hash 空间；跨端 canonical 无契约测试 | ✅ 已降级/完成：resolve 输出统一；version hash 已注释区分；双端 golden hash 测试已补 |
| **Medium** | 重复 `computeDelta`；实验配置效果有限；多步链测试缺口；DTO 类型矛盾 | ✅ 部分完成：重复计算、多步链、DTO、result mismatch、docId 隔离、retry 覆盖已完成；实验策略调参未处理 |
| **Low** | PUT/batch 不对称；forceFull 无超时；导入路径不统一；缓存 LRU | ⏳ 未处理：保留为后续低优先级清理 |

---

*本报告基于 2026-06-12 代码快照与测试执行结果；2026-06-12 follow-up 已更新第 7/8/10 节状态。策略常量以各仓库 `delta-policy.ts` 为准。*

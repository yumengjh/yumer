# 2026-06-12 Delta Overlay 遗留项与已知限制

> 高/中优先级审查项已于 2026-06-12 follow-up 完成；本文档汇总**仍开放**的低优先级项、测试缺口、设计取舍与运维注意点。  
> 涉及仓库：`yuediter`、`yumer-server`  
> 前置阅读：[Delta Overlay 实现审查报告](./2026-06-12-delta-overlay-implementation-review.md)、[Review Fixes 复盘](./2026-06-12-delta-overlay-review-fixes-retrospective.md)

---

## 1. 状态总览

| 类别 | 数量 | 是否阻塞上线 |
|------|------|--------------|
| Low 测试/代码清理 | 6 | 否 |
| 设计取舍（文档化即可） | 3 | 否 |
| 实验策略（按需处理） | 2 | 视环境而定 |
| 审查覆盖 caveat | 3 | 否 |

**结论**：当前 autosync + batch 主路径已具备生产可用性；下列项可在后续迭代中按需消化，不构成已知 Critical/High 缺陷。

---

## 2. Low 优先级 — 测试与 E2E

### 2.1 单块 PUT + delta 上行 E2E

| 项 | 说明 |
|----|------|
| **现象** | `POST /blocks/batch` 支持 delta 上行且 `shouldStoreDelta` 决定落库形态；`PUT /blocks/:id` 接受 delta 但**始终存全量** |
| **影响** | autosync 仅走 batch，**无实际影响**；若未来有单块 PUT 调用方，存储体积与 batch 不一致 |
| **建议** | 在 `test/document-sync.e2e-spec.ts` 增加 PUT + delta 场景，或明确废弃单块 delta 上行并在 API 文档标注 |
| **相关代码** | `yumer-server` `blocks.service.ts` `updateContent` vs `handleBatchUpdate` |

### 2.2 `sha256Hex` 在 `crypto.subtle` 不可用时的行为

| 项 | 说明 |
|----|------|
| **现象** | 客户端 `delta.ts` 的 `hashPayloadCanonical` 依赖 `globalThis.crypto.subtle`；不可用时直接 `throw` |
| **影响** | 现代浏览器与 Node 18+ 正常；极老环境或特殊 SSR 沙箱可能失败 |
| **建议** | 补单元测试记录预期抛错；若需支持旧环境，可加 Node `createHash` 回退（仅服务端已有同步实现） |
| **相关代码** | `yuediter` `src/services/sync/delta.ts` `sha256Hex()` |

### 2.3 `useDocumentSync` 级 forceFull 集成测试

| 项 | 说明 |
|----|------|
| **已完成** | `base-store.test.ts` 覆盖 `forceFullResync` → 全量 `buildSyncBatchOperations` → `recordAck` 清除 → 恢复 delta |
| **缺口** | 未覆盖完整 Hook flush 循环（`flush:dispatch` → MISMATCH response → 同轮全量重发） |
| **影响** | 核心状态机逻辑在 store + api 层已测；Hook 层回归依赖 E2E 或 Playwright sync 套件 |
| **建议** | 在 `e2e/sync/` 增加「故意 stale baseHash → MISMATCH → 单次编辑最终成功」场景 |

---

## 3. Low 优先级 — 代码与可维护性

### 3.1 PUT / batch 存储路径不对称

见 §2.1。属于**有意的设计分层**（batch 为编辑主路径），建议在 OpenAPI / 内部文档写清，避免新功能误用 PUT 做高频同步。

### 3.2 `forceFullResync` 无超时与可观测性

| 项 | 说明 |
|----|------|
| **现象** | `SyncBaseStore.forceFullBlockIds` 在 `recordAck` 成功前一直保持；若全量发送持续失败，每次 flush 都发全量 |
| **影响** | 行为保守、安全（不会误发 delta），但 Sync Debug 中不易区分「正常 forceFull」与「卡住的重试」 |
| **建议** | trace 事件增加 `forceFullReason` / `forceFullSince`；或连续 N 次失败后 surfacing 给用户 |
| **相关代码** | `base-store.ts`、`useDocumentSync.ts`（`isDeltaBaseMismatchResult` 分支） |

### 3.3 客户端导入路径不统一

| 项 | 说明 |
|----|------|
| **现象** | `engine.ts` 直接从 `delta.ts` 导入 `canonicalStringify`；`base-store.ts` / `api.ts` 从 `delta-encoding.ts` 导入 |
| **影响** | 纯可维护性问题，无运行时差异 |
| **建议** | 统一从 `delta-encoding.ts` 或 `delta-policy.ts` 公开 API 导入，减少新人困惑 |

### 3.4 服务端 Resolver LRU 缓存

| 项 | 说明 |
|----|------|
| **现象** | `BlockPayloadResolverService.remember()` 在 key 已存在时更新 value 但不刷新 `cacheOrder`，该 key 仍靠近淘汰端 |
| **影响** | `docId:blockId:ver` 为不可变 key，正常流程几乎不会重复 `remember` 同一 key，**实际影响极低** |
| **建议** | 若未来做可变 key 缓存，改为 move-to-end LRU |

### 3.5 GC `expandDeltaChainResourceKeys` 复杂度

| 项 | 说明 |
|----|------|
| **现象** | 不动点迭代，最坏 O(iterations × \|keys\| × \|versions\|) |
| **影响** | 正常 delta 链 ≤12，无压力；极端大批量 GC 扫描时需关注 |
| **建议** | 保持现状；若 GC 变慢再按 blockId 索引优化 |

---

## 4. 实验策略与生产切换（按需）

当前两端 `delta-policy.ts` 为**实验配置**：

```ts
DELTA_MIN_FULL_SIZE = 0   // 生产默认建议 8 * 1024
DELTA_MAX_RATIO = 0.5     // 小块常因 JSON 开销无法过线
```

| 项 | 说明 |
|----|------|
| **体积门槛为 0** | 不按大小拦截，但仍受 patch 比例限制；「全块走 delta」实验效果有限 |
| **生产上线前** | 建议恢复 `DELTA_MIN_FULL_SIZE = 8 * 1024`（两端 `delta-policy.ts` 同步修改） |
| **若坚持全块 delta** | 需同步调高 `DELTA_MAX_RATIO`（如 `1.0`），并评估 patch 大于全量的极端情况 |
| **相关文档** | [Delta Overlay 实现审查 §4.5](./2026-06-12-delta-overlay-implementation-review.md) |

---

## 5. 已知限制与审查 Caveat

### 5.1 Golden fixture 双份维护

| 项 | 说明 |
|----|------|
| **现状** | `delta-fixtures.json` 在 `yuediter` 与 `yumer-server` 各有一份，内含预计算 `baseHash` / `nextHash` |
| **保障** | 两端单测分别断言本地 `hashPayloadCanonical` 与 fixture 一致；2026-06-12 审查确认三组哈希值相同 |
| **风险** | 日后只改一端 fixture 会导致契约静默漂移 |
| **建议** | 改 fixture 时双端同步提交；长期可抽共享 npm 包或 CI 脚本 diff 两份 JSON |

**路径**：

- `yuediter/src/services/sync/__fixtures__/delta-fixtures.json`
- `yumer-server/src/modules/blocks/block-delta/__fixtures__/delta-fixtures.json`

### 5.2 forceFull 测试层级

| 层级 | 覆盖 |
|------|------|
| 单元 | ✅ `base-store` + `buildSyncBatchOperations` |
| Hook | ⏳ 未专门覆盖 |
| E2E | 部分（服务端 MISMATCH E2E；客户端 Playwright 可补） |

### 5.3 部署依赖 `diff-match-patch`

| 项 | 说明 |
|----|------|
| **现象** | 未安装时服务端所有 update 失败，客户端 2s 退避重试，表现为「双请求」 |
| **保障** | `package.json` 已声明；需确保 `pnpm install` 后重启服务 |
| **建议** | 部署检查清单增加 `require('diff-match-patch')` 或健康检查探针 |

---

## 6. 建议处理顺序（非紧急）

| 顺序 | 动作 | 预估工作量 |
|------|------|------------|
| 1 | 生产前恢复 `DELTA_MIN_FULL_SIZE = 8KB`（若结束实验） | 极小 |
| 2 | fixture 变更流程写入 CONTRIBUTING 或 sync 开发指南 | 小 |
| 3 | Playwright：`DELTA_BASE_MISMATCH` → 同轮全量成功 | 中 |
| 4 | PUT delta E2E 或 API 文档明确「batch only」 | 小 |
| 5 | `forceFull` trace 字段增强 | 小 |
| 6 | 统一客户端 delta 模块导入路径 | 小 |
| 7 | `sha256Hex` 降级策略（仅当有明确兼容需求） | 中 |

---

## 7. 相关文档

- [2026-06-12 Delta Overlay 实现审查报告](./2026-06-12-delta-overlay-implementation-review.md) — 完整审查与 §7/8/10 完成状态
- [2026-06-12 Delta Overlay Review Fixes 复盘](./2026-06-12-delta-overlay-review-fixes-retrospective.md) — 第一轮修复记录
- [2026-06-12 Delta Overlay + Compaction 混合同步复盘](./2026-06-12-delta-overlay-sync-retrospective.md) — 初版实现与双请求根因

---

*最后更新：2026-06-12。高/中优先级项完成后，本文档作为 delta overlay 的「已知债务」索引维护。*

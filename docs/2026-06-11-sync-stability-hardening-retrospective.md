# 2026-06-11 内容同步稳定性加固复盘

> 覆盖三阶段工作：基础设施加固（Phase 1）、digest / 恢复链路补强（Phase 2）、视觉序强一致（Phase 3）  
> 涉及仓库：`yuediter`（前端）、`yumer-server`（后端，Phase 1～2）

---

## 1. 背景

在高频编辑场景（连续换行、删除、改写、拖拽排序）下，用户报告刷新后**块顺序或正文与编辑结束前不一致**。日志中的典型文档为 `doc_1781186605449_fedfca56`：多个 batch 全部 ACK 成功，但下一批仍对同一 `clientId` 发送 `blockId: null` 的 CREATE，随后出现 `identity:resurrected` 与 sortKey 漂移。

工作分三个阶段推进，均属于**同步基础设施加固**——用户界面无可见变化，但刷新后**内容与顺序**的稳定性显著提升。

| 阶段 | 主题 | 核心交付 |
|------|------|----------|
| Phase 1 | ACK 基线 + fractional sortKey + 首批容错 | `applyBatchAckToDoc`、fractional indexing、manifest digest 捎带、flush 退避 |
| Phase 2 | digest 精度 + draftRevision 自愈 + idle 前修复 | `blockId:sortKey` digest、`adoptServerDraftRevision`、idle reconcile 前 sortKey repair |
| Phase 3 | 视觉序强一致 + move 优先 flush | 换位检测、`planRepositionSortKeyRepairs`、`prioritizeMoveDirtyOrder` |

---

## 2. 影响范围

### 用户可见影响（修复前）

- 高频编辑后刷新，段落顺序与编辑结束前不同（Phase 3 前仍常见）；
- 多次拖拽排序后刷新，块顺序回退到服务端旧 sortKey 序；
- 已删除块在刷新后重新出现（resurrected）；
- 同一批 CREATE 被重复发送，服务端块数膨胀、sortKey 震荡；
- 偶发「保存成功」但本地快照与服务端 manifest 不一致；
- 网络抖动或响应丢失后，`draftRevision` 不匹配导致同步卡死，只能手动刷新。

### 数据层影响

- 客户端 `snapshotRef` 在 batch ACK 后仍保留无 `blockId` 的块 → diff 误判为新建；
- DELETE ACK 未从快照移除块 → 后续 diff 认为块仍存在；
- 整数 sortKey 在密集插入/移动时易冲突（Phase 1 已换 fractional）；
- Phase 1 的 digest 仅哈希 blockId 列表 → sortKey 值漂移时仍可能跳过 reconcile（Phase 2 已修）；
- `DRAFT_REVISION_MISMATCH` 直接进入 conflicted，队列无法自动排空（Phase 2 已修）。

---

## 3. 根因分析

### 3.1 ACK 后 rescan 竞态（主因，Phase 1 修复）

`useDocumentSync` 在 `resolveBatchSuccess` 之后立即对**未补丁**的编辑器内容执行 `batch-ack-rescan`。`deriveSyncEntries` 将已 ACK 的块再次识别为 CREATE：

```text
batch_1781186668976  ACK 9 个 create
batch_1781186669330  对相同 clientId 再发 CREATE（blockId: null）
```

### 3.2 DELETE ACK 未更新快照（次因，Phase 1 修复）

删除 ACK 成功后快照仍保留已删块 → `identity:resurrected` 或错误 update/move。

### 3.3 Digest 假一致（Phase 2 修复）

Phase 1 digest 算法：`sha256(blockId₁|blockId₂|…)`，blockId 按 `(sortKey, blockId)` 排序后取 ID。

当块集合与排序不变、但 **sortKey 数值已与服务端不一致** 时，digest 仍相同，idle reconcile 被跳过，客户端带着过期 sortKey 继续编辑。

```text
客户端  A:1500  B:2000  → digest 基于 "A|B"
服务端  A:1000  B:2000  → digest 仍基于 "A|B"  （错误地匹配）
```

### 3.4 draftRevision 卡死（Phase 2 修复）

典型场景：batch 已成功、响应丢失，客户端用旧 `draftRevision` 重试 → `DRAFT_REVISION_MISMATCH` + `needsReload`。旧逻辑进入 `conflicted`，`error` 态自动重试不覆盖 conflicted，用户只能刷新。

### 3.5 结构性弱点（Phase 1 大部分已处理）

| 弱点 | 后果 | 状态 |
|------|------|------|
| 整数步进 sortKey | 密集操作易冲突 | ✅ fractional |
| digest 不含 sortKey 值 | 假一致跳过 reconcile | ✅ Phase 2 |
| flush 单批失败即中断 | 队列积压 | ✅ 部分失败继续 + 退避 |
| draftRevision 不匹配卡死 | 需手动刷新 | ✅ 自动 resync |
| 多标签页并发 | 旧 tab 覆盖新草稿 | ⚠️ 依赖 draftRevision + session |
| 换位后 sortKey 随节点携带 | LIS 误判无需 move，刷新按服务端重排 | ✅ Phase 3 |
| move 被 update 批次挤占 | 顺序校正延迟多轮 flush | ✅ Phase 3 |

---

## 4. 修复与加固措施

### 4.1 ACK 处理顺序（Phase 1，关键）

`src/hooks/useDocumentSync.ts`：

1. 构建 `createMappings` / `serverAckMappings` / `deleteAckMappings`；
2. `applyBatchAckToDoc` = `applyServerAck` + `applyServerDeleteAck`；
3. **先**补丁 `snapshotRef`，**再** `batch-ack-rescan`；
4. trace 段幂等二次补丁。

`engine.ts` 新增 `applyServerDeleteAck`。

### 4.2 Fractional indexing（Phase 1，前后端）

- 前端：`fractional-key.ts`、`order.ts`
- 后端：`fractional-key.ts`、`sort-key.util.ts`、`blocks.service`
- 迁移：`pnpm sortkeys:migrate`（幂等）

### 4.3 Manifest digest 捎带对账

**Phase 1**：batch 响应捎带 digest，匹配则跳过全量 `sync-reconcile`。

**Phase 2**：算法升级为 order-aware：

```text
payload = blockId₁:sortKey₁|blockId₂:sortKey₂|…   （按 sortKey, blockId 字节序）
digest  = sha256(payload)
```

- 前端：`src/services/sync/manifest-digest.ts`
- 后端：`blocks.service.ts` → `computeRootManifestDigest`

**部署约束**：digest 算法变更需前后端同步发布；滚动升级期间可能多触发几次 reconcile（安全，仅多一次 HTTP）。

### 4.4 draftRevision 自动 resync（Phase 2）

新增 `adoptServerDraftRevision`（`reducer.ts`）。flush 收到 `needsReload` 且冲突**仅**为 `DRAFT_REVISION_MISMATCH` 时：

1. 采纳 `response.draftRevision`；
2. 清除 inflight；
3. `continue` 重试 flush（trace：`flush:draft-revision-resync`）。

会话类冲突（`SYNC_SESSION_*`）仍进入 `lease-lost`，其他冲突仍进入 `conflicted`。

### 4.5 Idle reconcile 前 sortKey 修复（Phase 2）

`reconcileIdleManifest` 在 `computeRootManifestDigest` 之前调用 `repairSnapshotSortKeyOrder`，避免本地乱序 key 造成 digest 假一致（trace：`idle:sort-key-repair`）。

### 4.6 视觉序强一致（Phase 3，顺序专项）

**根因**：编辑器 `content[]` 为视觉序，后端以 `sortKey` 为规范序。ProseMirror 换位时 sortKey 常随节点携带；`planDesiredSortKeys` 的 LIS 优化在「key 未变」时跳过 move，导致服务端仍保留旧顺序。刷新时 `blocksToTiptapJson` 按 sortKey 重排 → 用户看到乱序。

**修复**：

1. **`deriveSyncEntries`**：块 index 变化且 attrs sortKey 仍等于上一快照、并在新位置对已持久化邻居非单调时，按视觉位置重算 sortKey 并入队 move。
2. **`planRepositionSortKeyRepairs`**：`advanceSyncSnapshotIndexed` 对比 `previousSnapshot` 二次兜底（忽略无 blockId 的 pending 插入，避免误判）。
3. **`prioritizeMoveDirtyOrder`**：batch 选择时 move 优先于 update/create，避免顺序校正被内容批次推迟。
4. **idle reconcile**：队列中仍有 pending move 时不因 digest 匹配而跳过对账。

关键文件：`engine.ts`、`snapshot.ts`、`batching.ts`、`useDocumentSync.ts`。

### 4.7 其他 Phase 1 加固

- corruption 主动修复、`repairSnapshotSortKeyOrder`（ACK 后）；
- flush 指数退避重试、部分失败不阻断；
- update 瘦身、create 与关联 move 同批；
- 后端 activity 异步采样。

---

## 5. 验证

| 范围 | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| 前端 `src/services/sync` 单测 | 99/99 | 101/101 | 114/114 |
| 前端 source guards | — | 11/11 | 11/11 |
| 后端 `blocks-sync-idempotency` | 19/19 | 19/19 | 19/19 |
| 用户复测（高频编辑 + 刷新） | 正常 | 正常 | 正常 |
| 用户复测（多次拖拽 + 刷新） | 不稳定 | 部分改善 | **正常** |

新增用例（Phase 3）：换位且 sortKey 随节点携带、move 批次优先级、全序旋转多块 move、非单调换位检测忽略 pending 插入。

**用户验收（2026-06-11）**：内容同步与顺序同步均符合预期；一轮测试中多次移动后刷新，顺序仍与编辑结束前一致。

---

## 6. 部署说明

1. **先后端、后前端**（fractional sortKey + digest v2 协议需对齐）。
2. 后端首次部署 Phase 1 后执行：`pnpm sortkeys:migrate`。
3. Phase 2 仅需发版，无新迁移；digest 算法与 Phase 1 不兼容，避免长时间前后端版本混搭。
4. 观察指标：
   - 重复 CREATE 同一 `clientId`；
   - `identity:resurrected`；
   - `flush:draft-revision-resync` trace 频率；
   - reconcile 触发率（Phase 2 上线初期可能略升，属预期）；
   - `DRAFT_REVISION_MISMATCH` 后是否仍大量进入 conflicted。

---

## 7. 下一步方向（详细路线图）

以下按**优先级**与**依赖关系**排列，供后续迭代参考。

### 7.1 P0 — 生产可观测性与回归防线（1～2 周）

**目标**：线上能快速判断「是客户端漏发、旧请求写入，还是新问题」。

| 项 | 状态 | 说明 |
|----|------|------|
| 视觉序强一致（单 tab） | ✅ Phase 3 已完成 | 换位检测 + move 优先 + 用户多轮拖拽刷新验收通过 |
| 同步健康仪表盘 | 待做 | `DRAFT_REVISION_MISMATCH` 率、`digestMatch` 跳过率、`orphaned-create`、`identity:resurrected` |
| 端到端场景自动化 | 待做 | Playwright：大批量粘贴/删除/拖拽 → idle → 刷新断言 |
| digest 跨端契约测试 | 待做 | 共享 fixture JSON，FE/BE 各跑单测 |

**完成标准**：任一典型文档 ID 可在 5 分钟内从日志还原 block 生命周期；CI 覆盖「大批量 + 快速交替编辑 + 多次拖拽」至少 3 条路径。

### 7.2 P1 — 多标签页与冲突体验（2～4 周）

**目标**：减少「必须整页刷新」的次数，但不牺牲数据安全。

| 项 | 现状 | 建议方向 |
|----|------|----------|
| 多 tab 同文档编辑 | `draftRevision` + sync session 互斥；脏队列时拒绝远端增量 | 脏队列时：**暂停 autosync + 拉取服务端 manifest 摘要**，提示「其他标签页已修改」并提供「加载服务端草稿 / 保留本地继续」 |
| `conflicted` 态 | 无自动恢复（仅 `error` 态退避重试） | 对非 session 的 `needsReload`：尝试一次 `sync-reconcile` + 采纳 `draftRevision` 后再 flush；失败再提示刷新 |
| Session 过期 | `lease-lost`，队列保留 | 续约失败时：**立即** `acquireSyncSession` 一次；成功则续 flush，失败再 lost |
| 自动刷新 | 无 | **不做**静默全量覆盖；仅 conflict 时提供明确 CTA，避免重复 2026-06-04「完整加载被当成 ACK patch」类事故 |

**完成标准**：双 tab 交替编辑同一文档，后开 tab 在 10s 内得到可理解的冲突提示，且不会静默复活已删块。

### 7.3 P2 — 同步协议精度（1～2 月）

**目标**：从「块级幂等 + 摘要核对」演进到「可验证的每次写入」。

| 项 | 说明 |
|----|------|
| `expectedBlockVersion` | update/delete/move 携带期望版本，服务端乐观锁拒绝陈旧写入 |
| 操作依赖图 batching | create 与其后的 move/update 强制同批（Phase 3 已 move 优先，可进一步绑定因果） |
| Reconcile 增量化 | 当前 `sync-reconcile` 偏全量；可返回「仅 sortKey / 仅缺失块」差异，降低大文档成本 |

**完成标准**：单文档 500 块、连续拖拽排序 50 次，刷新后顺序与编辑器一致；陈旧 update 被服务端拒绝且客户端自动 merge 或提示。

### 7.4 P3 — 长期架构（2～3 月，可选）

| 项 | 说明 |
|----|------|
| Relative position / CRDT 序 | 从根上避免 sortKey 与视觉序两套模型 |
| 服务端 draft 事实摘要 API | 除 digest 外提供 `liveBlockIds`、`tombstoneCount`、`draftRevision` 一条请求返回 |
| 自动冲突合并 | 仅针对纯文本 update 冲突；结构变更仍拒绝 |
| 历史 draft 异常清理 | 运维脚本：孤儿块、无 tombstone 的 live 块、revision 空洞 |

**原则**：P3 不阻塞 P0～P2；任何自动合并必须默认保守（宁可刷新不可静默丢删除）。

### 7.5 明确不做（本轮共识）

1. 冲突时静默用服务端内容覆盖本地编辑器（易复现块复活）；
2. 为省 reconcile 而削弱 `DRAFT_REVISION_MISMATCH` 校验；
3. digest 回退为仅 blockId 集合（已证明会假一致）；
4. 在未隔离环境对生产执行 sortKey 迁移。

---

## 8. 经验总结

### 8.1 快照基线必须在 rescan 前反映已确认事实

ACK 映射必须先写入 `snapshotRef`，再 `captureContentSnapshot`。

### 8.2 CREATE 与 DELETE 的 ACK 语义应对称

DELETE ACK 必须从快照**移除**块。

### 8.3 Digest 必须编码「服务端关心的字段」

只哈希 blockId 会在 sortKey 漂移时假一致；`blockId:sortKey` 是低成本且足够的 order-aware 方案。更细粒度（正文 hash）成本高，留给 P2 `expectedBlockVersion`。

### 8.4 版本令牌不匹配应区分「可自愈」与「硬冲突」

`DRAFT_REVISION_MISMATCH` 在单 tab + 响应丢失场景下可安全采纳 revision 并重试；session 冲突与多写入者冲突仍需硬停止。

### 8.5 基础设施改动可以零 UX 差异

fractional key、digest v2、退避、自愈对用户透明，但决定大规模编辑后的数据一致性。

### 8.6 日志按 block 生命周期读比按 batch 读更有效

`CREATE 成功 → 下一批又对同一 clientId CREATE` 一眼可见 ACK 竞态，而非 sortKey 或网络问题。

### 8.7 视觉序与规范序是两条链路

正文同步解决「块在不在、字对不对」；顺序同步要求 **视觉 `content[]` 的单调 sortKey 序列与服务端一致**。不能假设 ProseMirror 换位会更新 sortKey，也不能用 LIS「少发 move」替代服务端事实写入。

### 8.8 move 与 update 争抢批次会表现为「内容已同步、顺序仍错」

用户感知 autosync 完成往往来自 update ACK；若 move 被推迟，刷新仍按服务端旧序重排。move 必须优先 flush，且 idle 前不能有未排空的 move 队列。

---

## 9. 相关文档

- 前端链路分析：`docs/2026-06-05-frontend-sync-stability-analysis.md`
- 后端优化分析：`yumer-server/docs/session/sync-stability-analysis-and-optimization.md`
- 块复活专项（2026-06-04）：`docs/2026-06-04-sync-block-resurrection-fix-retrospective.md`

---

## 10. 最终结论

三阶段工作确立了同步链路的核心 invariant：

> **batch ACK 成功后，客户端同步基线（snapshot）必须与服务端已确认的身份与删除事实一致，然后才能对编辑器内容做下一次 diff。**

> **idle 对账时，digest 必须能检测 sortKey 漂移；draftRevision 落后时应自动追上而非卡死。**

> **换位或视觉非单调时，必须 enqueue move 且优先 flush，直至服务端 sortKey 序与编辑器一致。**

在此 invariant 下，**单 tab** 高频编辑、多次拖拽排序后刷新，内容与顺序均已通过用户验收。剩余主要风险在**多标签页并发**与**冲突态用户体验**；下一步按 §7 推进可观测性仪表盘与 E2E 自动化，再做多 tab 与 `expectedBlockVersion` 协议精度。

# 2026-06-12 单用户块顺序单序源修复 — Agent 交接 Prompt

> 用途：将本文整篇作为新 Agent 的系统/首条 Prompt，从当前代码状态继续收尾，**不要重复已做工作**。  
> 涉及仓库：`editor-demo/app`（前端 yuediter）、`yumer-server`（后端，E2E 依赖真实 API）  
> 关联复盘：`docs/2026-06-12-sync-order-single-source-retrospective.md`

---

## 角色与目标

你是 **editor-demo/app（前端 yuediter）** 的同步引擎工程师。当前最高优先级：**修复单用户场景下的块顺序（乱序）问题**。

### 优先级（必须遵守）

| 级别 | 要求 |
|------|------|
| **P0** | 单用户块顺序一致 — 编辑视觉序 = sortKey 持久序 = 刷新后加载序 |
| **P1** | 单用户内容一致（随 order 修复顺带验证） |
| **不做/低优** | 多客户端、多标签页、realtime 双写者竞态。除非修单序源不得不碰，否则不要展开 |

### 核心不变量

> idle 时顶层 `doc.content` 视觉序 = 严格递增 sortKey 序 = 服务端 draft 加载序  
> ACK 采纳 canonical sortKey 后，若与 DOM 不一致则 **reorder**，不只 patch attrs

---

## 背景与根因

**双序源导致单用户刷新后乱序：**

| 链路 | 顺序依据 |
|------|----------|
| 视觉序 | ProseMirror `doc.content` 数组下标 |
| 持久化/加载序 | `attrs.sortKey`（`blocksToTiptapJson` / `flattenBlockTreeInDocumentOrder` 按 sortKey 排序） |

diff 按数组序索引，持久化按 sortKey → 视觉序 ≠ sortKey 时刷新后乱序。

**必读文档：**

- `docs/2026-06-11-sync-stability-hardening-retrospective.md`
- `docs/2026-06-12-sync-e2e-retrospective.md`
- `docs/2026-06-12-sync-order-single-source-retrospective.md`

**关键源码：**

- 前端：`src/services/sync/engine.ts`、`snapshot.ts`、`src/hooks/useDocumentSync.ts`、`src/services/tiptap-converter.ts`、`src/modules/editor-kit/editorIdentity.ts`
- 后端（配合）：`E:\workspace\yumer-server` — `blocks.service.ts` `reserveUniqueSortKey` / move ACK canonical
- 测试：`src/services/sync/__tests__/engine-order.test.ts`、`e2e/sync/05-block-reorder.spec.ts`

---

## 推荐单序源方案（已实现）

**方案 A（sortKey 为权威）+ derive 前视觉对齐：**

1. **derive 前**：`advanceSyncSnapshot` 对非单调 sortKey 执行 `alignSortKeysToVisualOrder`
2. **derive 中**：`content-hint` 在 `hasVisualOrderDrift` 时强制升级为 `structure-hint`；corrupted 快照用 `planSortKeyRepairs` 替代 LIS 抑制 move
3. **ACK 后**：`applyBatchAckToDoc` / `reconcileEditorWithAckBaseline` 调用 `alignDocToSortKeyOrder`；编辑器通过 `reorderEditorTopLevelToMatchDoc` 重排 PM 节点

---

## 已完成的实现（勿重复造轮子）

### 产品修复

| 文件 | 变更要点 |
|------|----------|
| `src/services/sync/engine.ts` | `reorderTopLevelNodesBySortKey`、`alignDocToSortKeyOrder`、`alignSortKeysToVisualOrder`、`isTopLevelOrderAlignedWithSortKey`；`chooseDiffMode` 非单调升级；corrupted 用 `planSortKeyRepairs` |
| `src/services/sync/snapshot.ts` | capture 前 `alignSortKeysToVisualOrder` |
| `src/hooks/useDocumentSync.ts` | ACK 路径 `applyBatchAckToDoc` 末尾 `alignDocToSortKeyOrder` |
| `src/components/EditorPage.tsx` | `reconcileEditorWithAckBaseline` 末尾 `alignDocToSortKeyOrder` |
| `src/modules/editor-kit/editorIdentity.ts` | `reorderEditorTopLevelToMatchDoc`（ACK 后 DOM 重排） |

### 测试与 E2E

| 文件 | 说明 |
|------|------|
| `src/services/sync/__tests__/engine-order.test.ts` | 单序源不变量、`alignDocToSortKeyOrder` 用例 |
| `src/services/sync/__tests__/snapshot.test.ts` | `enqueues move operations when rotated blocks keep their original sortKeys` |
| `e2e/sync/05-block-reorder.spec.ts` | **新增** move E2E（6 次末块→首块拖拽） |
| `e2e/helpers/editor.ts` | `dragBlockToGap`、`waitForEditorText` |
| `e2e/helpers/api.ts` | `flattenTopLevelBlockTexts`（从节点顶层 `sortKey` 读） |
| `e2e/sync/02-bulk-paragraphs.spec.ts` | reload 后 `waitForEditorText` 加固 |

### 文档

- `docs/2026-06-12-sync-order-single-source-retrospective.md` — 本轮复盘（可与最终实现对齐后微调）

---

## 当前验证状态（交接时点）

| 范围 | 结果 |
|------|------|
| 单测 `src/services/sync` | **108/108 通过** |
| E2E **逐条**运行 | **7/7 通过**（含 `05-block-reorder`） |
| E2E **全套串行** `pnpm test:e2e:sync` | **7/7 连跑 2 次稳定**（01 reload 加固 + global-setup 预热容错 + timeout 300s） |

**未 commit**（用户未要求提交）。

---

## 你的任务（按顺序执行）

### 1. 环境就绪

```powershell
# 终端 1 — 后端
cd E:\workspace\yumer-server
pnpm dev   # :5200

# 终端 2 — 前端（若 3001 被占用先结束旧进程）
cd E:\workspace\editor-demo\app
pnpm run dev:webpack   # :3001

# 终端 3 — 验证
cd E:\workspace\editor-demo\app
pnpm exec vitest run src/services/sync

$env:PLAYWRIGHT_SKIP_WEBSERVER = "1"
$env:PLAYWRIGHT_CHANNEL = "chrome"
pnpm test:e2e:sync
```

环境变量：

- `PLAYWRIGHT_API_BASE` — 覆盖后端地址
- `PLAYWRIGHT_BASE_URL` — 覆盖前端地址
- `PLAYWRIGHT_SKIP_WEBSERVER=1` — 手动起前端时使用

### 2. 稳定性收尾（若全套 E2E 仍偶发失败）

优先 **最小 diff** 加固，**不要改产品逻辑除非确认有 bug**：

- `playwright.config.ts`：`timeout` 可考虑 300_000；reorder 用例已有 `test.setTimeout(300_000)`
- `01-basic-persistence.spec.ts` / `02-bulk-paragraphs.spec.ts`：reload 后用 `waitForEditorText` + `waitForSyncIdle`（02 已部分加固）
- 全套跑前确认 `:3001` 已 Ready，避免 global-setup 报「前端不可用」导致 7 skip
- 全套 **连跑 2 次** 确认稳定

### 3. DoD 检查清单

- [ ] 单用户连续拖拽后 reload，编辑器序与服务端 draft 一致
- [ ] idle 时顶层 sortKey 严格递增且与 `doc.content` 一致
- [ ] ≥1 条 move E2E + 单测不变量；不回归现有 6 条 sync E2E
- [ ] 单测 108/108；E2E 7/7 全套串行稳定（至少连跑 2 次）
- [ ] 复盘文档与最终实现一致
- [ ] 不引入多客户端功能；最小 diff
- [ ] **用户明确要求才 commit**；回复用简体中文

---

## 已知 E2E 陷阱（避免踩坑）

1. **拖拽前必须先 `waitForDraftSynced`**，等 create ACK 拿到 `blockId`，否则 move 无法入队
2. **block-handle** 依赖 `.tiptap-editor-wrapper` 的 `mousemove`；Playwright 需 synthetic mousemove + 重试（见 `e2e/helpers/editor.ts`）
3. **服务端 sortKey 在 API 树节点顶层**（`node.sortKey`），不是 `payload.attrs.sortKey` — `flattenTopLevelBlockTexts` 已修复
4. **不要**在 reorder 用例里调用 `waitForManifestReconcile(180_000)`（会吃满 180s test timeout）
5. **等待策略**：`waitForEditorMatchesServerDraft`（编辑器顺序 === 服务端顺序）比固定 expected 更稳；move 队列排空需要时间
6. 拖拽用「当前末块 → 首位 + 实时 `countTopLevelBlocks`」，**不要用固定索引**

---

## 若 E2E 仍报「编辑器与服务端未对齐」

1. 读 `sessionStorage` sync debug：`flush:dispatch` 是否含 `move`、`flush:response` 是否 success
2. 对比 `flattenTopLevelBlockTexts` 与编辑器 `getTopLevelBlockTexts`
3. 单测 `snapshot.test.ts` 旋转场景是否仍绿 — 若单测绿、E2E 红，优先查 E2E 时序/环境
4. 曾观察到：fix sortKey 读取后服务端从「完全原始序」变为「差一次旋转」→ move 在刷但队列未排空，加长 `waitForEditorMatchesServerDraft` 轮询

---

## 调试「move 已 dispatch 但服务端序未变」

```
编辑器: order-2 | order-3 | ... | order-1
服务端: order-3 | order-4 | ... | order-2   ← 差一次旋转，多为队列未排空
```

→ 加长 `waitForEditorMatchesServerDraft`；每 2 轮拖拽中间 `waitForDraftSynced`；不要过早断言固定 expected。

---

## 明确不做

- 多标签页 / 多写入者竞态功能
- 冲突时静默用服务端覆盖本地
- 无用户要求时的 git commit
- 扩大 scope 的 refactor

---

## 关键文件索引

```text
src/services/sync/engine.ts
src/services/sync/snapshot.ts
src/hooks/useDocumentSync.ts
src/components/EditorPage.tsx
src/modules/editor-kit/editorIdentity.ts
src/modules/editor-kit/BlockToolbar/index.tsx    # 拖拽 moveBlock + planExplicitMoveSortKey
e2e/sync/05-block-reorder.spec.ts
e2e/helpers/api.ts                               # flattenTopLevelBlockTexts
e2e/helpers/editor.ts                            # dragBlockToGap
docs/2026-06-12-sync-order-single-source-retrospective.md
docs/2026-06-12-sync-order-single-source-agent-handoff.md   # 本文
```

---

## 启动指令（复制给新 Agent）

```text
你是 editor-demo/app 同步引擎工程师。请阅读 docs/2026-06-12-sync-order-single-source-agent-handoff.md，
从「你的任务」一节开始执行：确认 :5200/:3001 → 单测 108/108 → E2E 7/7 全套连跑 2 次 →
若有 flaky 做最小测试加固 → 更新复盘文档 → 汇报 DoD。不要重复已实现的产品逻辑；用户明确要求才 commit；简体中文回复。
```

# Agent Prompt：单用户块顺序一致性修复

> **复制下方「Agent 任务正文」整段给下一个 Agent。**  
> 本文件同时作为背景资料保留在仓库中。

---

## Agent 任务正文（复制起点）

```
你是 editor-demo/app（前端 yuediter）的同步引擎工程师。当前最高优先级任务：**修复单用户场景下的块顺序（乱序）问题**。

## 背景

用户报告：前端保存后，服务端 draft 存下来的块顺序，与编辑时屏幕上看到的顺序不一致；刷新后顺序会「跳变」。近期已引入 fractional orderKey（替代整数 sortKey），并完成 Phase 1～4 同步加固 + 6 条 Playwright E2E（持久化/批量粘贴/全选删除/弱网），但 **move/拖拽排序无 E2E**，乱序仍是 P0 敏感问题。

## 优先级（必须遵守）

1. **P0 — 单用户块顺序一致**：编辑态视觉序 = 持久化 sortKey 序 = 刷新后加载序。必须在本任务周期内取得可验证进展。
2. **P1 — 单用户内容一致**：空 UPDATE、正文丢失等（Phase 4 已修大部分，随 order 修复顺带验证）。
3. **明确不做 / 低优先级**：多客户端/多标签页同时编辑、realtime 双写者竞态、session lease 互斥优化。除非修复单序源时不得不碰，否则不要展开多客户端同步功能。

## 根因（已分析，请从此出发，不要重新猜测）

系统存在 **双序源**：

- **视觉序**：ProseMirror `doc.content` 数组顺序（用户编辑时看到的顺序）
- **事实序**：节点 attrs 上的 `sortKey`（fractional key，服务端持久化与加载时的排序依据）

加载路径按 sortKey 重排后渲染：
- `src/services/tiptap-converter.ts` → `blocksToTiptapJson()` 对 blocks `.sort(compareSortKeys)`
- `src/services/document.ts` → `flattenBlockTreeInDocumentOrder()` 子块按 sortKey 排序

同步 diff 却按 ProseMirror 数组顺序索引（`src/services/sync/engine.ts` → `indexTopLevel` / `orderedNextNodes`），再推导 move/create 的 sortKey。

**当视觉序 ≠ sortKey 序时**：UI 可能显示「已同步」，刷新后顺序按 sortKey 重排，与用户所见不符。

其他加剧因素：
- FAST/content-hint 路径在 identity orderKey 不变时可能跳过 sortKey 重算
- move batch 异步 inflight，视觉已变但 sortKey 未 ACK
- 后端 `reserveUniqueSortKey` 可能改写客户端请求的 sortKey，ACK canonical 与请求不一致
- 多层 repair（derive / planReposition / repairSnapshot / idle reconcile）与用户输入竞态

## 关键文件

### 前端（主战场）
- `src/services/sync/engine.ts` — derive、sortKey 分配、move 检测、content-hint vs structure
- `src/services/sync/snapshot.ts` — `repairSnapshotSortKeyOrder`
- `src/services/sync/fractional-key.ts` — fractional 算法（与后端必须一致）
- `src/services/sync/manifest-digest.ts` — digest 含 blockId:sortKey
- `src/services/sync/reducer.ts` — ACK 后 entry/sortKey 写回
- `src/hooks/useDocumentSync.ts` — flush、idle reconcile、batch-ack-rescan
- `src/modules/editor-kit/editorIdentity.ts` — ACK 后 patch attrs
- `src/services/tiptap-converter.ts` — 加载时按 sortKey 排序（理解「事实序」）
- `src/modules/editor-kit/BlockToolbar/` — 拖拽 reorder 相关

### 后端（配合，仓库路径 `E:\workspace\yumer-server`）
- `src/modules/blocks/blocks.service.ts` — `reserveUniqueSortKey`、move/create ACK canonical sortKey
- `src/common/utils/fractional-key.ts` — 必须与前端 `fractional-key.ts` 行为一致
- `src/modules/documents/documents.service.ts` — draft 读取排序（仍有 `"500000"` legacy 默认值）

### 测试
- `src/services/sync/__tests__/engine-order.test.ts`
- `src/services/sync/__tests__/snapshot.test.ts`
- `e2e/sync/` — 现有 6 条；**必须新增 move/顺序专项 E2E**
- `playwright.config.ts`、`e2e/fixtures/sync-fixture.ts`

### 文档（先读）
- `docs/2026-06-11-sync-stability-hardening-retrospective.md`
- `docs/2026-06-12-sync-e2e-retrospective.md`
- `docs/superpowers/specs/2026-06-07-block-level-diff-engine-design.md`（orderKey 语义）

## 目标架构方向（P0，二选一或提出更优方案）

**原则：不允许「ProseMirror 数组序 ≠ sortKey 序」的状态进入 idle / persist。**

### 方案 A（推荐）：sortKey 为唯一权威，DOM 跟随 sortKey
- 每次 transaction 结束 / diff 前：若顶层 sortKey 相对数组序非严格递增，按视觉序重算 sortKey 并 **重排 ProseMirror 节点** 使 DOM 与 sortKey 一致
- 或：拖拽后立即写 sortKey + reorder，不等到 batch flush

### 方案 B：视觉序为权威，flush 前强制对齐
- 每次 derive 前：`planSortKeyRepairs(enqueueMoves=false)` 按数组序重写全部 sortKey，再 diff
- idle 前 invariant 检查：`visualOrder(blockIds) === sortKeyOrder(blockIds)`

无论哪种，ACK 处理必须：
1. 采纳服务端 canonical sortKey 写 attrs
2. 若 canonical 序与 DOM 序不一致，reorder DOM（不能只 patch attrs）

## 具体任务清单

### 1. 调查与复现（先做）
- [ ] 写最小复现：单标签连续拖拽 5～10 次 → waitForDraftSynced → reload → 对比视觉序 vs 服务端 `edit-content` tree 序
- [ ] 新增 E2E：`e2e/sync/05-block-reorder.spec.ts`（或类似命名）
- [ ] 在 sync debug trace 中记录：每次 move 的 requestedSortKey vs ACK sortKey vs 视觉 index

### 2. 修复（核心）
- [ ] 实现并落地「单序源」方案（A 或 B），改动尽量集中在 sync engine + ACK 路径
- [ ] 收窄 content-hint：sortKey 非单调时强制 structure/fallback，禁止跳过 sort 计划
- [ ] batch-ack-rescan / idle reconcile 前增加 order invariant 检查与 repair
- [ ] 若后端 ACK 改写 sortKey：前端必须 reorder；必要时在后端响应中明确 canonicalSortKey

### 3. 测试（必须全绿才算完成）
- [ ] 单元测试：`visualOrder === sortKeyOrder` 不变量（derive 前后、ACK 后、repair 后）
- [ ] 现有 `engine-order.test.ts` / `snapshot.test.ts` 不回归
- [ ] 新增 move E2E 通过
- [ ] 现有 6 条 sync E2E 仍 6/6 通过

### 4. 文档
- [ ] 新增简短设计/复盘：`docs/2026-06-XX-sync-order-single-source-retrospective.md`
- [ ] 说明选了哪种单序源方案、为何、还有哪些已知边界

## 运行环境

```powershell
# 后端
cd E:\workspace\yumer-server; pnpm dev   # :5200

# 前端
cd E:\workspace\editor-demo\app; pnpm run dev:webpack   # :3001

# E2E
cd E:\workspace\editor-demo\app
$env:PLAYWRIGHT_SKIP_WEBSERVER="1"
$env:PLAYWRIGHT_CHANNEL="chrome"
pnpm test:e2e:sync
```

## 成功标准（Definition of Done）

1. **单用户拖拽排序**：连续 reorder 后 idle → reload，编辑器块序与服务端 draft 块序一致（按 blockId 序列或 plainText 序列比对）。
2. **不变量**：任意 idle 时刻，顶层块满足 `compareSortKeys(sortKey[i], sortKey[i+1]) < 0` 且与 `doc.content` 顺序一致。
3. **自动化**：至少 1 条 move/reorder E2E + 相关单测；全套 sync E2E 不回归。
4. **范围控制**：未引入多客户端/sync session 新功能；diff 以 order 修复为主，不做无关重构。

## 约束

- 遵循现有代码风格；最小 diff；不要 over-engineer。
- 不要提交除非用户明确要求。
- 前后端 `fractional-key.ts` 行为必须保持一致（有共享 fixture 测试）。
- 遇到命令长时间阻塞：拆成单 spec 跑、后台跑，不要卡死会话。
- 用户要求用简体中文沟通。

## 禁止事项

- ❌ 优先做多标签页 / 多设备 realtime 同步
- ❌ 大改 sync 协议或数据库 schema（除非 order 修复必需且用户同意）
- ❌ 仅加日志不修根因
- ❌ 只 patch attrs 不处理 DOM 序（若方案要求 DOM 与 sortKey 一致）

开始工作前：先读上述关键文件与复盘文档，跑通现有 E2E 基线，再写 failing reorder E2E，最后实现修复直至全绿。
```

---

## 附：给用户的简短说明

把上面代码块中 **「Agent 任务正文」** 整段复制到新 Agent 会话即可。该 Prompt 已锁定：

- **必须做**：单用户块顺序（单序源 + move E2E + 测试）
- **暂不做**：多客户端同步

若希望 Agent 同时改后端，在 Prompt 末尾加一句：

> 后端仓库 `E:\workspace\yumer-server` 可在 ACK canonical sortKey 与 legacy `500000` 清理范围内配合修改，但不要展开多客户端功能。

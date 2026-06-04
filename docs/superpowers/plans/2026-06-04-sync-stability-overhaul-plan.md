# 同步链路稳定性重整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前编辑器同步链路重整为单活跃会话、会话内强一致、可刷新恢复的稳定协议，并移除 legacy 主写入路径。

**Architecture:** 先收紧最危险的前端语义漏洞，再引入会话租约与操作账本，最后把 commit/discard/reload 全部统一到同一套会话协议。前后端都采用 TDD，小步验证，不一次性推倒所有文件结构。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest、NestJS、TypeORM、Jest

---

## 文件边界

### 前端主改动
- Modify: `src/services/sync/types.ts`
- Modify: `src/services/sync/reducer.ts`
- Modify: `src/services/sync/engine.ts`
- Modify: `src/services/sync/snapshot.ts`
- Modify: `src/services/sync/api.ts`
- Modify: `src/hooks/useDocumentSync.ts`
- Modify: `src/components/EditorPage.tsx`
- Modify: `src/services/document.ts`

### 前端新增测试（优先就地补，不额外拆太多新文件）
- Modify/Create: `src/services/sync/*.test.ts`
- Modify/Create: `src/hooks/useDocumentSync*.test.ts`

### 后端主改动
- Modify: `src/modules/blocks/dto/batch-block.dto.ts`
- Modify: `src/modules/blocks/blocks.service.ts`
- Modify: `src/modules/documents/services/document-draft.service.ts`
- Modify: `src/modules/documents/documents.service.ts`
- Modify/Create: `src/entities/*sync-session*.entity.ts`
- Modify/Create: `src/database/migrations/*`
- Modify/Create: `src/modules/blocks/*.spec.ts`
- Modify/Create: `src/modules/documents/services/*.spec.ts`

---

### Task 1: 修掉前端已知高风险漏洞，建立回归护栏

**Files:**
- Modify/Test: `src/services/sync/reducer.ts`
- Modify/Test: `src/services/sync/engine.ts`
- Modify/Test: `src/services/sync/snapshot.ts`

- [ ] 写 `delete + update`、`delete + move` 不覆盖 delete 的失败测试
- [ ] 跑对应测试，确认按当前实现失败
- [ ] 最小修改 `reducer.ts`，把 delete 终态收紧为不可被后续 update/move 覆盖
- [ ] 写“非空请求收到空 results 不视为成功”的失败测试
- [ ] 最小修改 `resolveBatchSuccess()`，把这类响应改为协议错误
- [ ] 写“多节点初始离线内容会生成 create 条目”的失败测试
- [ ] 最小修改 `snapshot.ts`，移除 `nodes.length === 1` 特判，统一走内容存在即建账本逻辑
- [ ] 写“嵌套节点 ack 也能回填 blockId/sortKey”的失败测试
- [ ] 最小修改 `engine.ts`，把 `applyServerAck()` 改成递归遍历
- [ ] 跑前端同步核心测试，确认这一批全部通过

### Task 2: 清理 legacy 主写入路径，确保编辑主链路唯一

**Files:**
- Modify: `src/services/document.ts`
- Modify: `src/components/EditorPage.tsx`
- Modify/Test: 相关测试文件

- [ ] 写“同步引擎开启时不会回退 legacy 保存”的失败测试
- [ ] 审视 `saveDocumentContentV2()`、`batchOperations()`、`saveJsonContent()` 的实际调用点
- [ ] 将 `EditorPage.tsx` 中同步引擎开启时的手动保存与自动保存统一到新同步主链路
- [ ] 明确把 legacy 路径降级为只读 fallback 或显式报错，不再作为编辑主写入入口
- [ ] 跑相关前端测试，确认没有误伤普通加载逻辑

### Task 3: 引入前端会话状态骨架

**Files:**
- Modify: `src/services/sync/types.ts`
- Modify: `src/services/sync/reducer.ts`
- Modify/Test: 相关测试文件

- [ ] 先写 state 结构升级的测试：包含 `sessionId/sessionEpoch/leaseExpiresAt/nextClientOpSeq/lastAckedOpSeq/inflightRange`
- [ ] 让测试先失败，确认当前 state 不具备这些字段
- [ ] 最小修改 `types.ts` 与 `createInitialSyncState()`，引入会话字段与账本字段
- [ ] 修改 `enqueueChange()`，让每条本地变更拥有单调递增 `clientOpSeq`
- [ ] 修改 reducer 以维护 `ledger` / `pendingOpSeqs` / `inflightRange`
- [ ] 跑 reducer 测试，确认状态转移稳定

### Task 4: 改造前端 flush 为账本 + ack cursor 模型

**Files:**
- Modify: `src/services/sync/api.ts`
- Modify: `src/hooks/useDocumentSync.ts`
- Modify: `src/services/sync/reducer.ts`
- Modify/Test: 相关测试文件

- [ ] 写“flush 只发送连续 opSeq 范围”的失败测试
- [ ] 写“ack 通过 `ackedThroughOpSeq` 裁剪账本”的失败测试
- [ ] 修改 `api.ts` 请求体与响应体类型，为 session/opSeq/ack cursor 预留字段
- [ ] 修改 `useDocumentSync.ts`：从 `dirtyOrder` 选批次改为从 `pendingOpSeqs` 选连续范围
- [ ] 修改 `resolveBatchSuccess()`：以 `ackedThroughOpSeq` 为准回收已确认操作
- [ ] 修改失败处理：细分 conflict、lease lost、protocol error
- [ ] 跑前端同步测试，确认不会再凭空把空响应当成功

### Task 5: 把手动保存改造成真正的提交屏障

**Files:**
- Modify: `src/hooks/useDocumentSync.ts`
- Modify: `src/components/EditorPage.tsx`
- Modify: `src/services/document.ts`
- Modify/Test: 相关测试文件

- [ ] 写“manual save 期间 autosync 不再并发派发”的失败测试
- [ ] 写“commit 之前必须 flush 到最新本地 opSeq”的失败测试
- [ ] 修改 `flushAndCommitBarrier()` 为会话屏障：冻结派发、等待 ack cursor 到达目标 seq、再 commit
- [ ] 修改 `EditorPage.tsx` 保存流程，统一依赖新屏障
- [ ] 跑对应测试，确认 manual save 不再与 autosync 交错

### Task 6: 后端引入会话租约与批次光标

**Files:**
- Modify/Create: `F:\yumer-server\src\entities\*`
- Modify/Create: `F:\yumer-server\src\database\migrations\*`
- Modify: `F:\yumer-server\src\modules\blocks\dto\batch-block.dto.ts`
- Modify: `F:\yumer-server\src\modules\blocks\blocks.service.ts`
- Modify: `F:\yumer-server\src\modules\documents\documents.service.ts`
- Modify/Test: 后端相关 spec

- [ ] 写后端会话获取/续租/失效/接管的失败测试
- [ ] 写“非当前 session 的 batch 被拒绝”的失败测试
- [ ] 写“旧 epoch 的 batch 被拒绝”的失败测试
- [ ] 写“batch 返回 `ackedThroughOpSeq`”的失败测试
- [ ] 新增会话租约存储与迁移
- [ ] 修改 blocks batch DTO 与 service，引入 session/opSeq 校验
- [ ] 修改 documents 相关 service，支持 acquire/renew/commit/discard 的会话校验
- [ ] 跑后端定向测试，确认协议边界成立

### Task 7: 打通前后端会话协议

**Files:**
- Modify: 前端 `src/services/sync/api.ts`, `src/hooks/useDocumentSync.ts`, `src/services/document.ts`
- Modify: 后端 `documents/blocks` 相关控制器与 service
- Modify/Test: 前后端各自测试

- [ ] 先写前端“打开文档后获取 session 元信息”的失败测试
- [ ] 修改加载编辑内容接口消费方式，让前端拿到会话字段
- [ ] 实现前端续租逻辑与 lease 失效状态
- [ ] 将 commit/discard 也切换为必须带 session 信息
- [ ] 跑前后端定向测试，确认一个文档只允许当前会话写入

### Task 8: 刷新恢复与高频结构变更回归

**Files:**
- Modify/Test: `src/hooks/useDocumentSync.ts` 及相关测试
- Modify/Test: 后端 batch/receipt/session 测试

- [ ] 写“create -> delete -> recreate -> refresh”回归测试
- [ ] 写“同 session 未确认账本可在 reload 后继续恢复”的测试
- [ ] 写“旧 session 的本地未确认账本不会污染新 session”的测试
- [ ] 最小实现本地快照 + 账本恢复规则
- [ ] 跑前端与后端回归测试，验证用户报告的场景

### Task 9: 整体验证与文档收尾

**Files:**
- Modify: 本计划与设计文档（若实现中有偏差则回写）
- Verify: 前端/后端测试命令

- [ ] 跑前端同步相关测试集合
- [ ] 跑后端 blocks/documents 相关测试集合
- [ ] 如需，补一条人工复现脚本或测试说明，覆盖“大量插入→未完删除→重新插入→刷新”场景
- [ ] 对照设计文档做覆盖检查，确认没有遗漏的协议边界

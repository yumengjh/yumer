# TODO: 修复弱网大文档快速替换后旧块残留

日期：2026-06-05

执行 Agent：Claude Code + mimo2.5pro

前端仓库：`E:\workspace\editor-demo\app`

后端仓库：`E:\workspace\yumer-server`

背景文档：

- `docs/superpowers/reports/2026-06-05-weak-network-large-doc-sync-unresolved-retrospective.md`
- `docs/superpowers/reports/2026-06-05-weak-network-large-doc-sync-root-cause-analysis.md`

## 总目标

修复 Slow 3G + 大文档 + 大量粘贴后立即全删并输入新内容时，刷新后仍出现旧粘贴块残留的问题。

不要继续只猜 reducer 分支。先补可导出诊断，再写真实弱网 E2E，再做最终态收敛/墓碑兜底。

## 工作边界

必须同时看前端和后端：

- 前端同步核心：`src/hooks/useDocumentSync.ts`
- 前端 sync state：`src/services/sync/*.ts`
- 前端编辑器 ACK patch：`src/components/EditorPage.tsx`、`src/modules/editor-kit/MarkdownEditor.tsx`
- 后端 batch：`E:\workspace\yumer-server\src\modules\blocks\blocks.service.ts`
- 后端 batch DTO：`E:\workspace\yumer-server\src\modules\blocks\dto\batch-block.dto.ts`
- 后端文档草稿：`E:\workspace\yumer-server\src\modules\documents\services\document-draft.service.ts`
- 后端内容重建：`E:\workspace\yumer-server\src\modules\documents\documents.service.ts`

不要做这些事：

- 不要回滚最近的 sync session / ACK / tombstone delete 提交。
- 不要删除已有 sync debug modal。
- 不要大改编辑器架构或引入 CRDT/OT。
- 不要把 UI saved 文案当成数据一致性证明。
- 不要让生产默认输出大体积日志。

## P0：补前端黑匣子 trace

目标：复现一次后能从浏览器导出完整同步事件链。

步骤：

1. 新增或扩展 `src/services/sync/debug-log.ts`。
   - 保留现有 batch request/response 记录。
   - 增加 bounded trace records，建议最多 500-1000 条。
   - 仍使用 localStorage 开关和 sessionStorage 存储。
   - 每条记录包含 `traceId/docId/sessionId/sessionEpoch/timestamp/event/payload`。

2. 增加 manifest helper。
   - 输入 TiptapDoc。
   - 输出 top-level 节点列表：`index/type/clientId/blockId/syncCreateId/sortKey/textPreview/contentHash`。
   - textPreview 限制长度，避免日志爆炸。
   - contentHash 可复用 `src/services/sync/hash.ts` 或稳定 JSON hash。

3. 在 `src/hooks/useDocumentSync.ts` 打点。
   - `captureContentSnapshot` 前后记录 `snapshot:advance`。
   - 记录 `derived entries` 摘要：`clientId/blockId/syncCreateId/opType/revision/sortKey`。
   - flush 选批前记录 `queue:before-select`。
   - dispatch 前记录 `flush:dispatch`，必须包含 selected operations。
   - response 后记录 `flush:response`。
   - `collectOrphanedCreateDeletes` 后记录 `orphaned-create:delete-enqueued`。
   - `applyServerAck` 前后记录 `ack:patch`。
   - reducer 进入 idle 时记录 `idle:manifest` 和 `dirtyOrder/entries` 空状态。

4. 在 `src/components/EditorPage.tsx` 的 `onContentPatched` 记录 ACK merge 后 editor manifest。
   - 注意不要把用户正在输入的完整文本无限量写入日志。
   - 只记录 top-level 摘要和 hash。

5. 扩展 `src/components/SyncDebugModal.tsx` 或 DocumentHeader 的导出按钮。
   - 一键复制当前文档 trace + batch log。
   - 导出 JSON 要包含 schema version。
   - UI 文案保持现有风格即可，不要做大 UI 改造。

验收：

- 开启同步调试后，手动编辑一次能看到 `editor/update -> snapshot -> flush -> response -> ack -> idle` 事件。
- 大粘贴时日志不会无限增长。
- 关闭调试时不写 sessionStorage。

## P0：补后端 batch 诊断

目标：后端能说明每个 create/delete 的命中方式。

步骤：

1. 修改 `blocks.service.ts` 的 batch operation 处理。
   - create result 增加诊断字段，至少包括 `clientId/syncCreateId/blockId/sortKey`。
   - delete result 增加 `matchBy`：`blockId | syncCreateId | clientId | not_found`。
   - delete 未命中 client identity 时，不要返回普通成功形状；返回明确诊断码，例如 `DELETE_TARGET_NOT_FOUND_BY_CLIENT_IDENTITY`。

2. 若不想立即改 API response 类型，可先在服务端 logger 输出结构化 JSON。
   - 但最终 E2E 失败时必须能把诊断取出来。
   - 推荐同步扩展 `sync-batch-response.dto.ts`，字段设为 optional，保持兼容。

3. 添加后端单测。
   - identity delete 命中 syncCreateId。
   - identity delete 命中 clientId。
   - identity delete 未命中时返回诊断码。
   - 未命中 delete 不应推进 draft mutation。

验收：

- `pnpm test -- blocks-sync-idempotency.spec.ts` 通过。
- trace 中能看出每个 delete 是否真正命中旧块。

## P1：增加弱网大文档 E2E

目标：把用户复现路径自动化。

步骤：

1. 确认现有前后端 E2E 启动方式。
   - 前端：`pnpm dev` 默认端口 3001。
   - 后端：`pnpm dev` 或测试环境配置。
   - 不确定时先读现有 `test/*.e2e-spec.ts` 和 README，不要重写测试框架。

2. 编写 Playwright 或等价浏览器自动化测试。
   - 打开编辑器。
   - 开启 sync debug log。
   - 设置弱网：优先使用 Playwright context route delay；如项目已有 CDP throttle，可沿用。
   - 粘贴 300+ 段唯一 marker，例如 `PASTE_WAVE_20260605_001_${i}`。
   - 不等待同步完成，立即 Ctrl+A / Delete。
   - 输入唯一 final marker，例如 `FINAL_ONLY_20260605_SYNC_FIX`。
   - 等待 UI idle/saved。
   - 刷新页面。
   - 断言 final marker 存在，所有 paste marker 不存在。

3. 失败时自动收集：
   - 前端 sync trace JSON。
   - 当前编辑器 JSON。
   - 当前服务端 draft/content API 响应。
   - 后端 batch response 日志。

验收：

- 修复前该测试应能稳定或半稳定复现失败。
- 修复后连续运行 10 次通过。

## P2：实现最终态 manifest 收敛兜底

目标：即使 op-log 漏掉某些 delete，服务端也能按前端最终态清理当前 session 创建的 orphan block。

建议接口：

`POST /documents/:docId/sync-manifest/reconcile` 或 `POST /blocks/sync-manifest/reconcile`

请求：

```json
{
  "docId": "doc_x",
  "baseVersion": 1,
  "draftRevision": 12,
  "sessionId": "sync_x",
  "sessionEpoch": 1,
  "clientManifest": [
    {
      "index": 0,
      "clientId": "cid_final",
      "blockId": "b_final",
      "syncCreateId": "sync-create:cid_final",
      "sortKey": "001000"
    }
  ]
}
```

后端行为：

1. 校验 session、baseVersion、draftRevision。
2. 读取当前 draft 的 top-level block manifest。
3. 找出服务端存在但客户端 manifest 不存在的块。
4. 只允许自动清理满足以下条件的块：
   - 块 payload attrs 带 `clientId` 或 `syncCreateId`。
   - 属于当前 session 或当前短时间同步窗口。
   - 非 root block。
5. 对这些 orphan block 创建 deleted draft version。
6. 推进 draftRevision。
7. 返回 reconciled block 列表和新 draftRevision。

前端行为：

1. autosync flush 循环结束、dirtyOrder 为空后触发 reconcile。
2. reconcile 成功后更新 `draftRevision`。
3. 记录 `manifest:reconcile` trace。
4. 如果 reconcile 返回冲突或 session 失效，UI 进入 error/lease-lost，不显示 saved。

验收：

- 用户复现场景刷新后无旧 marker。
- trace 能看到 orphan block 被 reconcile 删除。
- 普通小编辑不会频繁发送大 manifest；可加阈值，例如大批量 create/delete 后或 debug 开启时强制。

## P3：实现持久化 create tombstone

目标：防止 late create 在 delete 后落库。

后端建议：

1. 新增实体和 migration，例如 `sync_create_tombstones`。
   - `docId`
   - `sessionId`
   - `sessionEpoch`
   - `clientId`
   - `syncCreateId`
   - `deleteClientBatchId`
   - `deletedAt`
   - `expiresAt`

2. identity delete 未命中 active block 时：
   - 如果带 `clientId/syncCreateId`，写 tombstone。
   - result 标记 `matchBy: "not_found"` 和 `diagnosticCode`。

3. create 前检查 tombstone。
   - 命中未过期 tombstone 时，不创建可见 block。
   - 返回成功 ACK 或明确 `tombstoned` result，前端据此清理 entry。

4. 增加清理策略。
   - tombstone TTL 可先用 10-30 分钟。
   - 不引入 Redis，不引入队列。

验收：

- late create after tombstone 单测通过。
- 重复 create with same syncCreateId 不会复活已删除块。

## 测试命令

前端：

```powershell
pnpm test:unit
pnpm lint
```

后端：

```powershell
pnpm test -- blocks-sync-idempotency.spec.ts
pnpm test -- blocks.service.draft.spec.ts
pnpm test -- documents.service.spec.ts
pnpm test:e2e
```

如果某个命令因环境缺失失败，记录失败原因和已执行的更小范围测试，不要跳过说明。

## 最终验收清单

- [ ] 弱网大文档 E2E 覆盖用户路径。
- [ ] 连续 10 次刷新后无旧 paste marker。
- [ ] 前端 trace 可导出且 bounded。
- [ ] 后端 delete result 能显示命中方式。
- [ ] identity delete 未命中不再被当成无诊断普通成功。
- [ ] 最终态 reconcile 或 durable tombstone 至少落地一个；推荐两者都做，先 reconcile，后 tombstone。
- [ ] 前端 `pnpm test:unit` 通过。
- [ ] 后端目标测试通过。
- [ ] 没有回滚最近 sync session、ACK、tombstone delete 改动。


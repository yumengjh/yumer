# 2026-06-05 内容同步最终态 manifest 收敛复盘

## 背景

全选删除场景中，前端曾出现空闲后继续重复发送同一组删除请求的问题。前一轮修复已经解决了 delete ack 被当作 create ack、导致 orphan create delete 循环的问题，但链路仍缺少“队列清空后，前后端按最终可见内容再对齐一次”的兜底。

本次按 2026-06-04 内容同步稳定性设计继续推进最终态收敛：前端在 autosync 队列为空时上报当前编辑器可见块身份 manifest；后端在同一 sync session 和 draftRevision 下检查 draft 中带同步身份、但已经不在前端最终 manifest 里的块，并追加 deleted 版本。

## 变更

- 新增 `postSyncManifestReconcile`，调用 `POST /documents/:docId/sync-reconcile`。
- `useDocumentSync` 在 idle 分支执行 manifest reconcile，并用 `lastReconciledManifestKeyRef` + `reconcileRunningRef` 防止空闲请求风暴。
- 前端只发送 `blockId/clientId/syncCreateId` 三个身份字段，避免 debug trace 字段触发后端白名单校验失败。
- reconcile 响应中的 `draftRevision` 会写回 reducer state；如果后端返回 `needsReload`，前端进入 conflicted 或 session lost 状态。

## 稳定性边界

- 该兜底只在 `dirtyOrder.length === 0` 且无 inflight batch 时运行，不参与正常批量写入竞争。
- 同一个 `docId/baseVersion/draftRevision/session/manifest` 只上报一次；失败也不会在同一空闲状态反复打接口。
- 后端只自动 tombstone 带 `clientId` 或 `syncCreateId` 的 draft 块，避免分页或局部加载时误删没有同步身份的历史块。

## 验证

- `pnpm vitest run src/hooks/useDocumentSync.source.test.ts src/services/sync/__tests__/api.test.ts src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/snapshot.test.ts src/services/sync/__tests__/engine-order.test.ts`
- `pnpm build`

## 后续

- 继续推进服务端 manifest 对比的可观测性，记录 tombstone count、manifest node count、draftRevision。
- 若未来确认编辑器始终全量加载，可评估把没有同步身份但已不在 manifest 的 draft 块纳入更严格的最终态校验，但必须先补“全量加载证明”或 manifest coverage 标记。

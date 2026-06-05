# 弱网大文档同步残留问题修复复盘（已解决）

日期：2026-06-05

状态：用户弱网回归测试确认已修复。

## 问题现象

在弱网和大文档场景下，用户删除大段或全部内容后继续输入新内容，页面短时间内显示已保存；但刷新后，旧的大文档内容可能重新出现。后续还暴露出一个相关问题：用户正常删除一段内容并刷新后，前端弹出“已恢复本地未同步快照，正在重新同步”，导致已删除内容被本地快照恢复。

这两个现象都不是单一保存接口失败，而是“编辑器最终状态、前端队列、后端乱序补偿、本地恢复策略”四段链路在弱网下没有形成严格闭环。

## 根因

1. 后端只按当前活动块处理删除。若弱网下客户端先发出 delete，后发的 create 因重试或乱序到达，服务端缺少持久化删除意图，可能再次创建已被用户最终删除的块。
2. 前端队列主要依赖增量 diff。在大文档快速清空、重建、刷新窗口内，dirty 队列中可能残留已经不在编辑器最终 manifest 里的 create/update。
3. 大量 delete 被拆成较小批次，弱网下扩大了“部分删除已发出、部分 create 仍可落库”的窗口。
4. 本地快照恢复策略最初过宽，只要发现本地快照比服务端内容新或不同就可能恢复；这会把正常删除后的本地缓存误判为未同步灾备快照。

## 修复内容

### 后端

1. 新增 `sync_create_tombstones` 持久化表和 `SyncCreateTombstone` 实体，用于记录按客户端身份删除但服务端暂未找到活动块的删除意图。
2. batch delete 支持按 `blockId`、`syncCreateId`、`clientId` 匹配，并在目标不存在但客户端身份明确时写入 tombstone。
3. create 入口检查 tombstone。若 late create 命中 tombstone，服务端返回成功形态的抑制结果，不再创建草稿块。
4. batch 响应增加 `matchBy`、`diagnosticCode`、`tombstoned` 字段，方便前端和调试面板识别补偿路径。
5. 补充幂等测试，覆盖“先删后到的 create 被抑制”和“按客户端身份删除未找到目标时写 tombstone”。

### 前端

1. 在同步快照生成阶段增加最终状态守卫：用当前编辑器 top-level manifest 反查 dirty 队列，发现已经不存在的非 delete 项时取消 create 或补发 delete。
2. 提高大文档 delete 默认批量上限，减少弱网下清空大文档时的批次数和乱序窗口。
3. 扩展 sync trace 日志，记录 snapshot、队列选择、flush 请求、flush 响应、ACK 合并、孤儿 create 补偿等关键事件，便于复现时导出完整链路。
4. 本地快照恢复改为显式 recovery marker 驱动。只有上一轮页面离开时处于 `dirty`、`flushing` 或 `error`，且 marker 与快照文档、hash、时间匹配，才允许自动恢复。
5. 成功手动保存、放弃草稿、回滚刷新以及稳定保存态会清理恢复 marker，避免正常删除被误恢复。
6. 页面卸载时不再取消待写本地快照，而是先 flush，确保真正未同步灾备数据能落盘。

## 边界规范

1. 服务端 tombstone 是删除意图的权威补偿，不依赖前端是否还保留旧队列。
2. 前端最终 manifest 守卫只处理“当前编辑器已经不存在”的 top-level block；它不替代服务端幂等和 tombstone。
3. 本地快照不是普通版本回滚机制，只能作为未同步离页灾备。没有显式 recovery marker 时不得自动覆盖服务端内容。
4. 调试导出必须保留 batch log 和 trace log，后续排查以“客户端最终 manifest、flush payload、服务端 result、ACK 后队列”四类信息为准。

## 验证结果

用户在弱网大文档场景复测确认：删除和重写后刷新不再恢复旧大文档内容；正常删除段落后刷新不再误弹本地未同步快照恢复。

本地验证命令：

```bash
pnpm test:unit -- src/services/local-snapshot.test.ts src/hooks/useLocalDocumentSnapshot.test.ts src/services/sync/__tests__/batching.test.ts src/services/sync/__tests__/snapshot.test.ts src/services/sync/__tests__/reducer.test.ts
pnpm exec eslint src/services/local-snapshot.ts src/services/local-snapshot.test.ts src/hooks/useLocalDocumentSnapshot.ts src/hooks/useLocalDocumentSnapshot.test.ts src/components/EditorPage.tsx src/contexts/DocumentContext.tsx src/services/sync/batching.ts src/services/sync/__tests__/batching.test.ts
pnpm build
```

```bash
pnpm test -- blocks-sync-idempotency.spec.ts
pnpm test -- blocks.service.draft.spec.ts documents.service.spec.ts
pnpm build
```

前端目标测试、目标 lint 和 build 通过；后端目标测试和 build 通过。前端全量测试/全量 lint 中仍有既有的 source-contract 类问题，不属于本次同步链路修复范围。

## 经验

1. “页面显示已保存”不能作为弱网大文档同步正确性的唯一判据，必须同时观察最终 manifest 和服务端 ACK。
2. op-log 在弱网下必须有服务端侧删除意图记忆，否则 delete-before-create 会被 late create 破坏。
3. 本地自动恢复必须是 opt-in 灾备路径，而不是内容差异驱动路径。
4. 大文档同步要优先降低批次数和刷新窗口，同时保留可导出的链路证据。

## 后续建议

1. 增加浏览器级弱网 E2E：大文档清空、快速输入、刷新、重开后校验服务端最终内容。
2. 如果后续仍出现同类问题，可追加服务端最终 manifest reconcile 接口，由客户端提交最终块集合，服务端删除不在集合内的草稿块。
3. 将 sync trace 导出纳入问题反馈模板，避免后续只能依赖肉眼复现。

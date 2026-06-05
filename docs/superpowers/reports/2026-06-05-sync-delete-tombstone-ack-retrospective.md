# delete tombstone ACK 队列残留修复复盘

## 背景

在 `dd3395f0a369c6d193f4427ba7e96908c9b22db9` 之后，内容同步链路已经引入了 session、opSeq、batch receipt、create/delete tombstone 等机制。后续弱网与大文档修复让“先删后到的 create”能够被后端 tombstone 抑制，但仍有一个前端队列收敛问题没有覆盖。

这次问题发生在以下路径：

1. 用户创建了一个本地块；
2. create 请求已经进入网络或服务端，但前端还没有收到 server `blockId`；
3. 用户快速删除该块；
4. 前端发送没有 `blockId`、但带 `clientId/syncCreateId` 的 delete tombstone；
5. 后端成功记录 tombstone，返回 `operation=delete`、`matchBy=not_found`、`tombstoned=true`。

## 问题

前端 reducer 原来的 ACK 关联逻辑主要按以下信息匹配：

- `result.clientId`
- `result.blockId`
- 批次结果下标且 `blockId` 为空或相等

但 delete tombstone 的后端响应可能没有 `clientId`，并且返回的 `blockId` 是诊断型占位值，而不是前端 entry 里的 `blockId`。因此前端无法把该 delete entry 从 dirty queue 中清掉。

结果是：

- 服务端已经接受删除意图；
- 前端仍认为 delete 未同步；
- 后续 autosync 会重复发送同一 tombstone delete；
- UI 容易长时间停留在 dirty/error 之间，弱网恢复后也不稳定。

## 根因

这不是 tombstone 机制本身失败，而是 ACK 合约和前端状态机之间存在语义缺口：

- 后端用 `matchBy=not_found` 和 `tombstoned=true` 表达“删除意图已持久化”；
- 前端 reducer 没把这类 delete 诊断响应视为可清队列的成功 ACK；
- 回归测试覆盖了 create 被 tombstone 抑制，但没有覆盖 delete tombstone ACK 本身的队列清理。

## 修复

前端做了兼容性修复：

- 当 inflight entry 是 `delete`；
- 服务端结果也是 `delete`；
- 并且结果包含 `tombstoned=true` 或 `matchBy=not_found`；
- 即使返回的 `blockId` 和本地 entry 不一致，也按批次位置关联原始 entry，清除 dirty queue。

后端同时做了合约增强：

- delete 成功 ACK 回显原始 `clientId`；
- delete 失败 ACK 也尽量回显原始 `clientId`；
- DTO 描述从 “create 回填” 改为 “create/delete ack 回填”。

这样新后端响应可以被前端直接按 `clientId` 命中；前端兼容逻辑则保证旧响应或诊断型响应不会再次卡队列。

## 测试

前端新增 reducer 回归测试：

- `clears a client-identity delete when the server stores a tombstone ack`

覆盖没有 server `blockId` 的 delete tombstone 成功后，entry 被清除、dirtyOrder 归零、syncState 回到 idle。

后端增强现有 idempotency 测试：

- “按客户端身份删除未找到活动块时记录 tombstone” 现在断言 delete ACK 回显 `clientId`。

已执行：

```bash
pnpm vitest run src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/api.test.ts src/services/sync/__tests__/snapshot.test.ts src/services/sync/__tests__/engine-order.test.ts
```

## 后续

同步批次响应应继续坚持一个原则：每个结果必须能稳定映射回客户端 entry。

推荐后续检查：

1. update/move 失败路径是否都能回显足够身份信息；
2. batch operation 是否需要显式 `clientOpId`，减少依赖结果下标；
3. 调试面板把 `clientId/syncCreateId/matchBy/diagnosticCode/tombstoned` 放在同一行展示，方便定位类似队列残留问题。

## 补充：全选删除后的重复请求

后续前端实测发现，全选删除多个已有块后，控制台会持续发送同一组 delete 请求。

这次不是后端 tombstone 未生效，而是前端 reducer 的 revision 保护过于保守：

1. 一组 delete entry 被标记为 inflight；
2. 编辑器空文档状态或快照推进又派生了一次相同 delete；
3. entry revision 被刷新；
4. 第一次 delete ACK 回来时，reducer 看到当前 revision 不等于 inflight revision，于是保留 entry；
5. autosync 继续发送同一组 delete。

原本 revision 检查是为了保护“flush 中用户又编辑了同一块”的情况，这对 update/create 是必要的；但 delete 是终态操作，如果当前 entry 仍然是同一个 delete，成功 ACK 应该清掉，而不是当作新变更保留。

修复策略：

- 当当前 entry 仍为 `delete`，服务端 ACK 也是成功或幂等成功的 `delete` 时，即使 revision 已变化，也清除该 entry。
- 新增 reducer 回归测试覆盖 “same delete re-enqueued while inflight”。

这补上了全选删除、批量删除、大文档弱网删除场景中最容易触发的重复请求入口。

# 2026-06-03 同步元信息分层收敛复盘

## 1. 背景

本轮工作的起点，不是新的可见功能，而是编辑器内容同步链路里一个长期存在的结构性问题：

- 同步逻辑依赖的字段过多
- 多类字段混在同一个节点 `attrs` 里
- 刷新后、本地快照对比后、ACK 回写后，这些字段频繁出现“新增 / 删除 / 改值”
- 即使视觉内容没有问题，diff 和调试面板里也会持续出现大量噪音

用户在排查时观察到的典型字段包括：

- `clientBatchId`
- `data-block-id`
- `data-sync-create-id`
- `syncCreateId`
- `clientId`
- `data-sort-key`

这些字段在刷新后经常变化，例如：

- 某个块刷新后新增 `attrs.clientBatchId = batch_xxx`
- 某个块刷新后删除 `attrs.data-block-id = b_xxx`
- 某个块刷新后新增 `attrs.syncCreateId = sync-create:cid_xxx`
- 某个块刷新后新增 `attrs.data-sync-create-id = sync-create:cid_xxx`

这类变化不一定意味着同步错误，但它说明当前同步系统存在一个更根本的问题：

**稳定内容事实、前端本地身份、同步事务元信息、DOM 别名字段，没有被明确分层。**

## 2. 本轮目标

本轮不是重做同步架构，而是做一轮“分层收敛”，目标分为三层：

1. 先减少前端内容层和本地快照层的噪音。
2. 再把明显不该长期驻留的事务字段从前端内容 attrs 中移出去。
3. 在不破坏现有后端幂等能力的前提下，压缩 `clientBatchId` 和 `syncCreateId` 的污染面。

本轮刻意不做的事情：

- 不重写前后端同步协议
- 不引入新的浏览器本地存储依赖
- 不直接改成“跨浏览器恢复 pending create”
- 不在本轮内完成服务端事务元数据表设计和迁移

## 3. 问题拆解

### 3.1 这些字段其实属于不同层

#### 内容事实层

真正属于“文档内容事实”的字段只有少数：

- `blockId`
- `sortKey`
- `parentId`
- 正文内容和业务属性

#### 前端本地身份层

- `clientId`

它的职责是：

- 作为前端 diff、dirty queue、ACK patch 的本地主键

它不是服务端事实，不应该被理解为跨浏览器持久事实。

#### 同步事务层

- `syncCreateId`
- `clientBatchId`

它们的职责分别是：

- `syncCreateId`：create 幂等键
- `clientBatchId`：batch 请求跟踪键

它们不是文档内容本身。

#### DOM / 编辑器别名层

- `data-block-id`
- `data-client-id`
- `data-sort-key`
- `data-sync-create-id`

它们只是编辑器 parse/render 和 DOM 侧透传字段。

### 3.2 当前系统为什么会“总在变”

原因并不是某一个字段写错了，而是：

1. 有些字段天生就是短生命周期的。
   例如 `clientBatchId` 每个 batch 都不同，本来就会变。

2. 有些字段只对 pending create 有意义。
   例如 `syncCreateId` 在 create ACK 之后本来就应该退出内容层。

3. 有些字段只是别名。
   例如 `data-block-id` 和 `data-sort-key` 是 canonical 字段在 DOM 层的镜像。

4. 当前系统把这些字段同时放进了：
   - 节点 attrs
   - 加载结果
   - ACK patch 结果
   - 本地快照 compare
   - diff explorer

结果就是：

- 刷新前后这些字段频繁抖动
- 本地快照 compare 经常出现“看起来不对，但其实只是元信息变化”

## 4. 本轮前的系统状态

在本轮开始前，大致存在以下情况。

### 4.1 前端内容层

- `clientId`、`syncCreateId`、`clientBatchId`、`data-*` 可能同时存在于节点 attrs
- create payload attrs 中会带 `syncCreateId`
- 某些 ACK 回写之后，这些临时字段依然留在内容层

### 4.2 服务端内容层

- create 时会把 `clientBatchId`、`clientId`、`syncCreateId` 写入块 payload attrs
- update 时会从历史 payload 里继续保留这些字段
- 因此 draft / head 再读取时，这些字段会重新回到前端

### 4.3 调试和快照层

- 本地快照 compare 对这些字段的过滤不统一
- 一些 transient 字段会被当成真实差异
- `syncCreateId` 甚至一度被 compare 身份规则使用

## 5. 本轮具体改动

本轮改动分成三组。

### 5.1 本地快照与 compare 降噪

目标是：

- 不让 transient 字段主导 compare/hash 结果
- 不让 `data-*` 和事务字段制造伪差异

调整内容：

- 默认过滤更多瞬时同步字段
- hash 计算前先做过滤
- compare 的 identity 收紧，不再使用 `syncCreateId`
- diff explorer 将更多 `data-*` 和同步元信息归类为 `auto-meta`

这部分改动主要在：

- [local-snapshot-filter.ts](</E:/workspace/editor-demo/app/src/services/local-snapshot-filter.ts:1>)
- [local-snapshot.ts](</E:/workspace/editor-demo/app/src/services/local-snapshot.ts:1>)
- [local-snapshot-compare.ts](</E:/workspace/editor-demo/app/src/services/local-snapshot-compare.ts:1>)
- [local-snapshot-diff-explorer.ts](</E:/workspace/editor-demo/app/src/services/local-snapshot-diff-explorer.ts:1>)

这一层的效果是：

- 即使刷新后某些同步元信息抖动，快照 compare 不会再被轻易打成 mismatch

### 5.2 `clientBatchId` 从长期内容层退出

目标是：

- `clientBatchId` 保留在请求层、日志层
- 不再作为当前主路径的长期内容字段

调整内容：

- 后端 create 路径里，如果当前请求已经带稳定 `syncCreateId`，则不再把 `clientBatchId` 写入 payload attrs
- 后续 update 合并 payload 时，也不再优先保留这种新路径下的 `clientBatchId`
- 旧兼容路径仍保留兜底逻辑，避免一次性切断历史行为

核心文件：

- [blocks.service.ts](</E:/workspace/yumer-server/src/modules/blocks/blocks.service.ts:452>)

这一步的意义是：

- 后端 draft / head 不再持续制造新的 `clientBatchId` 内容污染

### 5.3 `syncCreateId` 从前端内容层退出

这是本轮最重要的一步。

目标是：

- 前端仍然保留 create 幂等能力
- 但 `syncCreateId` 不再驻留在前端节点 attrs 中

调整后的规则：

1. `syncCreateId` 只保留在 `SyncEntry.syncCreateId`
2. 发 `POST /blocks/batch` 时，`create` operation 仍然单独带 `syncCreateId`
3. create payload attrs 不再带 `syncCreateId`
4. 编辑器节点 attrs 不再长期保留 `syncCreateId`
5. ACK 后会主动清理 `syncCreateId / clientBatchId / data-sync-create-id`
6. 从服务端加载内容时，也会剥离历史残留的 `syncCreateId / clientBatchId / data-sync-create-id`

相关文件：

- [sync/api.ts](</E:/workspace/editor-demo/app/src/services/sync/api.ts:1>)
- [sync/engine.ts](</E:/workspace/editor-demo/app/src/services/sync/engine.ts:1>)
- [sync/reducer.ts](</E:/workspace/editor-demo/app/src/services/sync/reducer.ts:1>)
- [tiptap-converter.ts](</E:/workspace/editor-demo/app/src/services/tiptap-converter.ts:1>)
- [editorIdentity.ts](</E:/workspace/editor-demo/app/src/components/markdown-editor/editorIdentity.ts:1>)

这一步的本质是：

**把 `syncCreateId` 的职责限定回“前端同步状态机字段 + 请求协议字段”，不再把它视作编辑器内容字段。**

## 6. 当前收敛后的状态

本轮结束后，系统处于如下状态。

### 6.1 前端内容层

当前前端节点 attrs 中，长期应保留的主要是：

- `blockId`
- `clientId`
- `sortKey`

而以下字段已经被显著压缩：

- `clientBatchId`
- `syncCreateId`
- `data-sync-create-id`

其中：

- 加载服务端内容时会剥离历史残留
- create ACK 后会清理这些 transient 字段

### 6.2 前端同步层

当前仍然保留以下能力：

- `clientId` 作为本地稳定身份
- `SyncEntry.syncCreateId` 作为 create 幂等键
- `POST /blocks/batch` 的 create operation 继续单独发送 `syncCreateId`

也就是说：

- 同步正确性没有因为“删字段”而丢失
- 只是字段不再长期寄生在内容层

### 6.3 服务端持久层

服务端当前状态是：

- `clientBatchId` 在新主路径下不再继续长期持久化
- `syncCreateId` 仍然保留在服务端块 payload attrs 中

注意这里是一个有意保留的边界：

- 本轮没有继续动服务端 create 幂等建模
- 所以 `syncCreateId` 还没有完全从服务端内容层拆出去

### 6.4 快照与调试层

本地快照 compare 已经对这批 transient 字段更宽容：

- 不再轻易把这些字段变化视作内容真实变化
- 更接近“逻辑内容 compare”

## 7. 为什么本轮停在这里

本轮没有继续把 `syncCreateId` 从服务端持久层彻底移除，原因是这是另外一个级别的问题。

### 7.1 再往下走就不是“字段清理”了

如果继续推进，下一步不应该是继续在 attrs 里打补丁，而应该是：

- 在服务端建立独立的 create 幂等元数据模型

例如需要单独维护：

- `docId`
- `syncCreateId`
- `blockId`
- `clientId`
- `createdAt`

这本质上已经是：

**把同步事务层从内容层正式拆出。**

### 7.2 这个改动影响面更大

继续推进会涉及：

- 服务端幂等匹配逻辑
- 数据迁移或兼容逻辑
- 删除时的补偿链路
- 老数据回读
- 事务回收策略

这已经超出本轮“先收敛噪音和内容污染”的范围。

### 7.3 当前版本已经达到一个合理停点

当前已经做到：

1. 用户最直观感受到的“刷新后字段老在变”问题被明显压缩
2. 前端内容层已经比之前干净很多
3. 同步正确性没有被牺牲
4. create 幂等能力仍然保留

因此这是一轮适合停住、观察和总结的节点。

## 8. 本轮验证情况

### 8.1 前端测试

已通过的核心测试包括：

- `tiptap-converter-sync-metadata.test.ts`
- `sync/api.test.ts`
- `sync/engine-order.test.ts`
- `sync/reducer.test.ts`
- `markdown-editor/identity-selection.test.ts`

本轮相关前端回归共 `36` 个测试通过。

### 8.2 后端测试

已通过：

- `blocks-sync-idempotency.spec.ts`

这组测试重点覆盖：

- 同 batch 重放不重复创建
- 跨 batch 用相同 `syncCreateId` 重试不重复创建
- create/update 后字段保留行为

### 8.3 Lint

- 前端本轮相关文件 `eslint` 通过
- 后端当前 workspace 缺少可直接使用的 `eslint.config.*`，因此未完成后端同口径 lint 校验

## 9. 仍然存在的已知边界

### 9.1 服务端 payload attrs 里仍有 `syncCreateId`

当前这不是 bug，而是本轮有意保留的兼容状态。

含义是：

- 前端已经不再依赖它
- 但服务端幂等逻辑还依赖它

### 9.2 `clientId` 仍然是前端同步关键字段

这是当前设计下合理且必要的依赖，但必须持续明确边界：

- `clientId` 是前端运行期身份
- 不是服务端事实
- 不是跨浏览器恢复承诺

### 9.3 历史数据不会立即全量“洗干净”

虽然前端加载会剥离历史 transient 字段，但历史块版本本身仍可能包含旧字段。

这意味着：

- 展示面和同步面已经大幅收敛
- 持久层历史数据仍然有遗留

## 10. 下一步建议

下一步不建议继续在前端 attrs 上做更多细碎收缩，而是建议进入“服务端同步事务元数据拆层”设计阶段。

### 10.1 目标

把 `syncCreateId` 从“内容 payload attrs”迁移为“服务端独立同步元数据”。

### 10.2 设计方向

建议至少单独建模 create 幂等映射：

- `docId`
- `syncCreateId`
- `blockId`
- `clientId`
- `createdAt`
- 可选状态字段

### 10.3 迁移原则

建议遵循：

1. 新逻辑先双写或兼容读
2. 旧 payload attrs 里的 `syncCreateId` 保持一段兼容期
3. 确认服务端幂等完全平移后，再考虑停止从 payload 读它

### 10.4 不建议的方向

不建议把更多同步正确性依赖压回浏览器本地存储，原因包括：

- 老浏览器能力不稳定
- WebView/嵌入环境行为不一致
- 浏览器应是缓存层，不应是同步真相源

## 11. 当前结论

本轮工作已经把问题从“字段混在一起、到处抖动、调试很吵”推进到了一个更可控的状态：

- 前端内容层基本只保留真正需要长期存在的身份和顺序字段
- `clientBatchId` 基本退出长期内容层
- `syncCreateId` 退出前端内容层，收敛为同步状态机字段和协议字段
- 本地快照 compare 不再被 transient 字段轻易污染

但这还不是终点。

真正的终局不是“继续删 attrs 里的字段”，而是：

**把同步事务层从内容层彻底拆出去。**

在那之前，本轮可以作为一个明确的阶段性收口点。

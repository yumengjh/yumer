# 2026-06-03 前后端内容同步设计文档

## 1. 文档目的

本文档描述当前编辑器内容同步链路的完整设计，覆盖：

- 前端内容加载、编辑、diff、批量同步、ACK 回写
- 后端 draft 写入、批处理协议、幂等规则、正式提交版本
- 同步相关元信息字段的职责、边界和当前问题
- 失败恢复、冲突处理、本地快照与调试方式

本文档同时区分两类内容：

- `现状实现`：当前代码已经生效的逻辑
- `设计约束 / 演进方向`：后续需要持续收敛的规则

## 2. 核心结论

当前同步系统的核心原则如下：

1. 自动同步只写 `draft`，不直接推进文档正式 `head`。
2. 前端同步 diff 的本地主键是 `clientId`，不是 `blockId`。
3. 服务端事实主键是 `blockId`，顺序事实是 `sortKey`。
4. `POST /blocks/batch` 是内容同步主通道，支持 `create / update / delete / move` 四类操作。
5. 手动保存不是“重新上传整篇文档”，而是先确保 dirty 队列清空，再调用 `POST /documents/:docId/commit` 将 draft 提交为新版本。
6. 浏览器本地存储只能作为缓存与调试辅助，不应成为同步正确性的前提。

## 3. 术语和数据对象

### 3.1 文档相关

- `Document`
  文档主记录，包含 `docId`、`rootBlockId`、`head`、`publishedHead` 等。
- `DocDraft`
  草稿状态，不是一份完整内容副本，而是一张 `blockVersionMap`。
- `DocRevision`
  正式版本记录。
- `DocSnapshot`
  某个版本的块版本映射快照。

### 3.2 块相关

- `Block`
  块主记录，稳定主键是 `blockId`。
- `BlockVersion`
  块的某个版本，记录 `payload`、`parentId`、`sortKey` 等。
- `blockVersionMap`
  `blockId -> version` 的映射。文档渲染、draft、diff 都围绕这张表工作。

### 3.3 前端同步相关

- `TiptapDoc`
  编辑器当前文档 JSON。
- `SyncEntry`
  前端一次 diff 后得到的标准同步操作，可能是 `create / update / delete / move`。
- `SyncReducerState`
  前端同步状态机，维护 dirty 队列、inflight batch、baseVersion、错误状态等。
- `snapshot`
  前端用于 diff 的上一份编辑器快照，不是服务端 snapshot。

## 4. 字段分层

这是当前同步系统最关键的理解前提。

### 4.1 内容事实层

这些字段属于“服务端最终事实”：

- `blockId`
- `sortKey`
- `parentId`
- 节点正文和业务属性

要求：

- `blockId` 一旦建立，应稳定表示同一个服务端块
- `sortKey` 表示同一父块下的顺序事实

### 4.2 前端本地身份层

- `clientId`

职责：

- 前端编辑器节点的稳定本地身份
- 前端 diff、ACK patch、dirty 队列索引的基础键

约束：

- 只保证当前文档会话内稳定
- 不应承担服务端持久事实的职责

### 4.3 同步事务层

- `syncCreateId`
- `clientBatchId`

职责：

- `syncCreateId`：create 操作的幂等键
- `clientBatchId`：一次 batch 请求的跟踪键

约束：

- 这两类字段不属于文档内容本身
- 它们是协议和同步事务字段，不应被当成正文语义

### 4.4 DOM / 编辑器别名层

- `data-block-id`
- `data-client-id`
- `data-sort-key`
- `data-sync-create-id`

职责：

- 仅用于编辑器 parse/render 往返和 DOM 层透传

约束：

- 不应参与逻辑 compare
- 不应作为服务端事实来源

## 5. 总体架构

```text
前端编辑器内容
  -> ensure identity
  -> snapshot diff
  -> SyncEntry 队列
  -> POST /blocks/batch
  -> 服务端逐操作处理
  -> 返回逐操作 ACK
  -> 前端 patch blockId/sortKey
  -> 下一轮 diff

自动同步:
  只写 draft blockVersionMap

手动保存:
  先 flush dirty 队列
  再 POST /documents/:docId/commit
  将 draft 提交为新 head
```

## 6. 前端完整流程

### 6.1 加载编辑内容

前端通过：

- `GET /documents/:docId/edit-content`

获取编辑用内容。

后端返回两种来源：

- `source: "head"`：当前没有 draft，直接读取正式 head
- `source: "draft"`：当前存在 draft，按 draft 的 `blockVersionMap` 重建内容树

前端将返回的块树转成 TipTap JSON，并在进入编辑器前做一次身份归一化：

- 为缺少 `clientId` 的节点补齐 `clientId`
- 保留已有 `blockId`
- 对重复 `clientId` / 重复 `blockId` 做去重保护

这样做的目的，是确保后续所有本地 diff 都基于稳定本地身份。

### 6.2 编辑器内容变更

用户编辑后，前端不会整篇重传，而是：

1. 捕获当前编辑器 JSON
2. 与上一份 `snapshot` 做对比
3. 生成 `SyncEntry[]`

`SyncEntry` 的核心结构：

```ts
type SyncEntry = {
  clientId: string
  blockId: string | null
  opType: "create" | "update" | "delete" | "move"
  syncCreateId?: string
  blockType?: string
  payload?: Record<string, unknown>
  plainText?: string
  parentId?: string
  sortKey?: string
}
```

### 6.3 diff 规则

前端 diff 采用以下规则：

1. 先对文档做 identity normalization。
2. 顶层块索引优先使用：
   - 匹配键：`blockId ?? clientId`
   - 本地主键：`clientId`
3. 新块产生 `create`
4. 已有块正文变化产生 `update`
5. 已有块顺序变化产生 `move`
6. 旧块消失产生 `delete`

其中有两个关键点：

- `blockId` 只用于判断“这是不是一个已有服务端块”
- `clientId` 才是前端 reducer / snapshot / dirty queue 的稳定主键

### 6.4 sortKey 分配

前端会在生成 create/move 时先尝试预分配 `sortKey`。

原则：

- 已有稳定块之间插入新块时，生成中间 sortKey
- 一段连续新块会批量分配连续可排序的 sortKey
- 如果前一份 snapshot 的 sortKey 已损坏，前端会压制一部分 move，优先避免把异常进一步放大

注意：

- 前端申请的 sortKey 只是“期望值”
- 服务端仍可能因为同批冲突或唯一化需要返回不同的最终 sortKey

### 6.5 批处理发送

前端通过：

- `POST /blocks/batch`

发送同步请求。

当前请求的固定约束：

- 自动同步：`source = "autosync"`
- 手动保存前 flush：`source = "manual-save"`
- 编辑器同步默认 `createVersion = false`

示例请求：

```json
{
  "docId": "doc_123",
  "baseVersion": 12,
  "clientBatchId": "batch_1780473043966_ipkq0o",
  "source": "autosync",
  "createVersion": false,
  "operations": [
    {
      "type": "create",
      "clientId": "cid_161af2c7-b468-4330-86f6-5946e3fe58b5",
      "syncCreateId": "sync-create:cid_161af2c7-b468-4330-86f6-5946e3fe58b5",
      "data": {
        "docId": "doc_123",
        "type": "paragraph",
        "parentId": "root_1",
        "sortKey": "001500",
        "payload": {
          "type": "paragraph",
          "attrs": {
            "blockId": null,
            "clientId": "cid_161af2c7-b468-4330-86f6-5946e3fe58b5",
            "syncCreateId": "sync-create:cid_161af2c7-b468-4330-86f6-5946e3fe58b5",
            "sortKey": "001500"
          }
        }
      }
    }
  ]
}
```

### 6.6 ACK 回写

服务端返回 batch 结果后，前端分三步处理：

1. reducer 标记当前 batch 成功或失败
2. 从结果中提取 `clientId -> blockId / sortKey` 映射
3. 将 ACK patch 回当前 snapshot 和编辑器内容

ACK patch 的目标是：

- 让本地新建块及时获得正式 `blockId`
- 让服务端最终采用的 `sortKey` 回灌到本地

这一步必须尽量“只修补身份字段”，不能粗暴整篇回灌，否则容易打断用户正在输入的内容。

### 6.7 orphaned create delete 补偿

存在一种时序：

1. 前端发出 create
2. 用户又立即删除该块
3. 服务端稍后才返回 create 成功 ACK

如果前端此时不补偿，会造成“服务端已有块，本地已无块”的孤儿块。

当前前端在 ACK 返回后会检查：

- 某个 create 是否已经成功
- 但当前 snapshot 里是否已经找不到这个 `clientId`

如果满足，就自动补发对应的 delete。

## 7. 后端完整流程

### 7.1 内容读取

后端编辑内容读取入口：

- `GET /documents/:docId/edit-content`

读取规则：

1. 如果存在 draft：
   - 使用 draft 的 `blockVersionMap` 构建块树
   - 返回 `source: "draft"`
2. 如果没有 draft：
   - 使用 `document.head` 对应内容
   - 返回 `source: "head"`

这意味着刷新编辑器时，用户看到的并不是“最近一次正式发布版本”，而是“当前 draft 视图”。

### 7.2 batch 主事务

后端同步主入口：

- `POST /blocks/batch`

事务内流程：

1. 校验文档权限
2. 加锁读取 `Document`
3. 校验 `baseVersion`
4. 逐个执行操作：
   - `create`
   - `update`
   - `delete`
   - `move`
5. 根据 `createVersion` 决定：
   - 直接推进 `head`
   - 或只更新 `DocDraft.blockVersionMap`
6. 返回逐操作结果

### 7.3 baseVersion 冲突

如果请求带了 `baseVersion`，且它不等于当前服务端 `head`：

- 本批次不会继续执行
- 返回 `needsReload = true`
- `conflicts` 中包含 `BASE_VERSION_MISMATCH`

这是一条硬冲突规则，客户端应该重新加载内容后再继续。

### 7.4 createVersion 语义

这是当前协议最重要的一条语义。

#### `createVersion = false`

用于编辑器自动同步。

行为：

- 不推进 `Document.head`
- 不创建新的正式 revision
- 只把变更后的块版本写入 `DocDraft.blockVersionMap`

#### `createVersion = true` 或省略

用于旧路径或显式版本化场景。

行为：

- 成功操作后推进 `Document.head`

当前编辑器自动同步路径固定使用 `false`。

### 7.5 create 幂等

后端支持两层 create 幂等匹配：

1. `clientBatchId + clientId`
2. `syncCreateId`

意义：

- 同一个 batch 重放时不会创建第二个块
- 丢响应后换一个新 batch 重试，只要 `syncCreateId` 不变，也不会重复创建

这是 create 正确性的关键协议保证。

### 7.6 delete 处理

delete 的目标不是物理删除块主记录，而是：

- 生成新的删除版本
- 将对应块在 draft 或 head 映射中指向该版本

因此刷新后是否还能看到某个块，不取决于“数据库里还有没有 block”，而取决于：

- 当前 draft/head 指向的版本是否仍把该块视为可见块

### 7.7 move 和 update

- `update` 负责正文和 payload 变化
- `move` 负责 `parentId` / `sortKey` 变化

当前前端为了表达“同一块内容和顺序都变了”，可能在同一批次里对同一块同时发：

- 一个 `update`
- 一个 `move`

这是允许的。

## 8. 手动保存与正式版本提交

当前“手动保存”分成两段：

1. 前端先执行一次 `flushAndCommitBarrier()`
   - 强制把当前 dirty 操作走完
   - source 标记为 `manual-save`
   - 但仍然是 `createVersion = false`
2. dirty 队列清空后，再调用：
   - `POST /documents/:docId/commit`

`POST /documents/:docId/commit` 的效果：

- 将当前 `DocDraft` 提交为新的正式版本
- `Document.head + 1`
- 创建 `DocRevision`
- 创建 `DocSnapshot`
- 删除 draft

因此：

- 自动同步负责“把编辑结果同步到 draft”
- commit 负责“把当前 draft 固化为正式版本”

## 9. 协议定义

### 9.1 `POST /blocks/batch` 请求体

顶层字段：

- `docId`
- `operations`
- `createVersion?`
- `baseVersion?`
- `clientBatchId?`
- `source?`

`source` 当前定义：

- `autosync`
- `manual-save`

### 9.2 `operations`

#### create

```json
{
  "type": "create",
  "clientId": "cid_xxx",
  "syncCreateId": "sync-create:cid_xxx",
  "data": {
    "docId": "doc_xxx",
    "type": "paragraph",
    "parentId": "root_xxx",
    "sortKey": "001500",
    "payload": {}
  }
}
```

#### update

```json
{
  "type": "update",
  "blockId": "b_xxx",
  "data": {
    "payload": {},
    "plainText": "..."
  }
}
```

#### delete

```json
{
  "type": "delete",
  "blockId": "b_xxx"
}
```

#### move

```json
{
  "type": "move",
  "blockId": "b_xxx",
  "parentId": "root_xxx",
  "sortKey": "002000"
}
```

### 9.3 `POST /blocks/batch` 响应体

```json
{
  "acceptedBatchId": "batch_xxx",
  "appliedAt": 1780473045000,
  "serverHead": 12,
  "needsReload": false,
  "conflicts": [],
  "results": [
    {
      "operation": "create",
      "success": true,
      "clientId": "cid_xxx",
      "blockId": "b_xxx",
      "sortKey": "001500",
      "version": 8
    }
  ]
}
```

字段语义：

- `acceptedBatchId`
  服务端最终接受的 batch ID
- `serverHead`
  服务端当前正式 head
- `needsReload`
  是否必须让客户端 reload
- `results`
  每个操作的执行结果和 ACK 信息

## 10. 一致性、恢复与异常场景

### 10.1 ACK 晚到

create 发出后，用户可能继续编辑同一块。

设计要求：

- 只要 `clientId` 仍然匹配，就应允许把 `blockId/sortKey` patch 回当前块
- 不能因为正文文本已经变化，就放弃身份回写

否则会出现：

- 服务端已经创建块
- 前端当前块仍没有 `blockId`
- 下一轮删除时前端无法发出正确 delete

### 10.2 create 成功但本地块已删除

由 orphaned create delete 逻辑补偿。

### 10.3 baseVersion 冲突

如果出现 `needsReload = true`：

- 客户端应停止当前链路
- 重新加载编辑内容
- 重建 snapshot 基线

### 10.4 浏览器刷新

刷新后重新从 `GET /documents/:docId/edit-content` 拉取内容。

正确性依赖：

- 服务端当前 draft/head 的事实

不应依赖：

- 浏览器是否还保有旧的临时事务元数据

### 10.5 老浏览器约束

设计上不应假设以下能力永远可靠：

- `IndexedDB`
- `localStorage`
- 页面恢复缓存
- WebView 的持久化一致性

因此：

- 浏览器本地快照可以作为体验增强
- 不能作为同步正确性的唯一依据

## 11. 本地快照、对比和调试

本地快照的作用是：

- 对比刷新前后内容
- 辅助排查同步错乱
- 降低“视觉正常但元信息抖动”带来的误报

为了减少噪音，快照 compare/hash 应默认忽略以下字段：

- `clientId`
- `data-client-id`
- `syncCreateId`
- `clientBatchId`
- `data-sync-create-id`
- `data-block-id`
- `data-sort-key`

原因：

- 这些字段里有些是事务字段
- 有些是 DOM 别名字段
- 它们变化并不等于正文内容真的变化

## 12. 当前已知问题

### 12.1 同步元信息仍然混在节点 attrs 中

现状上，`clientId`、`syncCreateId`、`clientBatchId`、`data-*` 仍然可能出现在节点 attrs 中。

这会带来三个问题：

1. 刷新前后 diff 容易出现噪音
2. 事务字段和内容字段层次不清
3. 某些边界时序下，容易把短生命周期字段误当作长期事实

### 12.2 `clientId` 仍是前端同步关键依赖

这不是错误，但必须明确定义边界：

- `clientId` 是前端运行期身份
- 不是服务端持久事实
- 不是跨浏览器恢复承诺

### 12.3 `syncCreateId` 的长期驻留方式仍待收敛

`syncCreateId` 本质上更像：

- 协议级 create 幂等键

而不是：

- 文档内容字段

后续应进一步收敛其驻留位置，避免长期污染内容层。

## 13. 建议的后续演进方向

### 13.1 字段归属收敛

建议逐步明确：

- 内容事实层：`blockId`、`sortKey`
- 本地身份层：`clientId`
- 协议事务层：`syncCreateId`、`clientBatchId`
- DOM 别名层：`data-*`

### 13.2 降低事务字段进入内容层的概率

优先级建议：

1. `clientBatchId` 不再长期驻留节点 attrs
2. `syncCreateId` 尽量收敛为协议和幂等层字段
3. compare/hash/diff 统一复用同一套 logical normalization

### 13.3 继续保持“浏览器非真相源”

同步正确性应继续建立在：

- 服务端 draft/head 事实
- batch 协议幂等
- ACK patch 正确闭环

而不是建立在：

- 浏览器本地存储一定存在
- 浏览器刷新后仍保有全部事务元数据

## 14. 一句话总结

当前内容同步系统的本质是：

- 前端以 `clientId` 为本地身份，按块级 diff 生成 batch
- 后端以 `blockId + sortKey + blockVersionMap` 为事实落盘到 draft
- 手动保存再将 draft 提交为正式版本

后续最重要的演进方向，不是继续增加更多同步字段，而是把字段放回各自应该所在的层。

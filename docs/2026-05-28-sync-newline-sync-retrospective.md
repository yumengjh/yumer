# 2026-05-28 换行/空行同步修复复盘

## 1. 背景

本轮修复聚焦一个非常具体、但影响极大的编辑器同步问题：

- 用户在文档中快速输入并换行，尤其是连续创建空行时
- 刷新后出现以下异常：
  - 空行丢失
  - 空行位置漂移
  - 偶发多出空行
  - 更严重时，刷新后只剩下第一行内容

典型复现场景：

```txt
1

2

3
```

刷新后有时变成：

```txt
1
2

3
```

更糟时甚至只剩：

```txt
1
```

这类问题不是纯渲染问题，而是同步引擎在“连续 create + 后续 update + 服务端回读”这条链路上，未能稳定维护块身份与顺序元数据。

---

## 2. 本轮修复前的错误判断

### 2.1 只把问题当成 sortKey 问题

最初的判断是：

- 连续空行本质上就是连续新建 paragraph
- 只要为连续 create 分配不同 sortKey，问题就会消失

这个判断只覆盖了一部分症状。它解释了“空行顺序漂移”，但不能解释“多个 create 最终被折叠成同一个块”。

### 2.2 被错误 worktree 基线干扰

在排查过程中，曾经误用了旧基线 worktree，导致：

- 某些验证结果混入旧逻辑
- 临时得出“修复已生效/未生效”的错误结论

后来统一回到 `main` 主分支做定位，才把问题重新收敛到真实线上逻辑。

---

## 3. 真正的根因链路

本轮最终确认，问题不是单点，而是三层问题叠加。

### 3.1 服务端回读时 `sortKey` 没有被前端保留

前端把后端 block tree 重组为 TipTap JSON 时，节点 attrs 里只保留了：

- `blockId`
- `clientId`

但没有保留：

- `sortKey`

这会导致编辑器下一轮 diff 时，无法基于真实顺序元数据计算新块位置。

### 3.2 连续 create 在单次 diff 中会共享同一个排序位置

连续空行在同步引擎里会表现为多个新的顶层 paragraph。

如果每个 create 都独立用“当前位置左右邻居”求一次 sortKey，但不把前一个新建块视为锚点，就可能出现：

```txt
空行1 -> 002000
空行2 -> 002000
空行3 -> 002000
```

这会让后端虽然收到多个 create，但它们在同一个 sibling 空间中使用了相同排序锚点，刷新后顺序不再可靠。

### 3.3 多次快照推进时，本地新块没有被当成后续锚点

即使第一次创建空行时分配出了新的 sortKey，如果这个 sortKey 没有及时回写到本地 snapshot，那么下一次快速输入继续发生时：

- 前一个本地新块虽然已经存在
- 但还没有服务端 blockId
- 如果引擎只把“有 blockId 的块”当作有效锚点，就会忽略它

于是下一次 create 还会被错误地算成“直接插在旧块后面”。

### 3.4 最致命问题：create 的 `syncCreateId` 被旧块污染

从请求日志 `res.txt` 可以看到，最严重的错误并不是 sortKey，而是：

- 多个 create 的 `clientId` 明明不同
- 但它们的 `syncCreateId` 却相同

这意味着后端幂等层会把多个不同 create 误判成“同一个 create 的重复重试”，从而全部折叠成同一个 block。

这就是为什么刷新后有时只剩下一行 `1`：

- 不是内容没发送
- 而是多个新块被后端当成了同一个块

### 3.5 `create + update` 合并时，脏 attrs 被带回 payload

当用户快速输入时，常见链路是：

1. create 一个空 paragraph
2. 立刻对它 update，写入 `2` 或 `3`

如果 reducer 在合并 `create + update` 时直接拿 update payload 覆盖 create payload，就可能把旧块上的：

- `syncCreateId`
- `sortKey`
- `blockId`

错误地带到新块 payload 中。

这会让前面明明已经生成的新块身份再次被污染。

---

## 4. 本轮最终修复

### 4.1 前端保留服务端 `sortKey`

修改：

- `src/services/tiptap-converter.ts`
- `src/components/markdown-editor/extensions/blockIdAttribute.ts`

效果：

- 后端返回的 `sortKey` 会进入 TipTap 节点 attrs
- 编辑器后续 diff 可以基于真实顺序元数据继续工作

### 4.2 连续 create run 一次性分配唯一排序键

修改：

- `src/services/sync/order.ts`
- `src/services/sync/engine.ts`

引入：

- `createSortKeysBetween(...)`

效果：

- 同一段连续 create 不再逐个独立“猜位置”
- 而是一次性分配唯一递增排序键

### 4.3 把本地新块的 sortKey 回写进 snapshot

修改：

- `src/services/sync/snapshot.ts`

效果：

- 第一次生成的本地空行 sortKey 会保留在 snapshot 中
- 下一次快速输入时，这个本地新块也能成为排序锚点

### 4.4 后续排序计算不只认 `blockId`，也认本地已有 `sortKey`

修改：

- `src/services/sync/engine.ts`

效果：

- 即使一个本地新块还没有服务端 `blockId`
- 只要它已经有稳定 `sortKey`
- 后续 create 也会把它当作有效锚点

### 4.5 每个 create 强制使用自己的 `syncCreateId`

修改：

- `src/services/sync/types.ts`
- `src/services/sync/engine.ts`
- `src/services/sync/api.ts`

效果：

- `syncCreateId = sync-create:${clientId}`
- 不再继承前一个块或旧 payload 中的脏 `syncCreateId`

### 4.6 reducer 合并时规范化 create payload

修改：

- `src/services/sync/reducer.ts`

效果：

当 `create + update`、`create + move` 或其他 merge 发生时，create payload 会被重新标准化为：

- `blockId = null`
- `clientId = 当前 create 自己的 clientId`
- `syncCreateId = 当前 create 自己的 syncCreateId`
- `sortKey = 当前 create 自己的 sortKey`

### 4.7 请求发送前再做一次最终兜底规范化

修改：

- `src/services/sync/api.ts`

效果：

即使前面某一层遗漏了，最终发往 `/blocks/batch` 的 create payload 仍会被强制纠正，避免脏 attrs 进入后端。

---

## 5. 验证方式

本轮验证不再只依赖手工体验，而是引入了针对具体根因的单测。

### 新增/扩展测试

- `src/services/__tests__/tiptap-converter-sync-metadata.test.ts`
  - 确认服务端 `sortKey` 被保留到 TipTap 节点

- `src/services/sync/__tests__/engine-order.test.ts`
  - 连续 create 分配唯一排序键
  - `syncCreateId` 不继承旧块身份

- `src/services/sync/__tests__/snapshot.test.ts`
  - 本地空行在连续快照推进里仍保留排序锚点

- `src/services/sync/__tests__/reducer.test.ts`
  - `create + update` merge 后 payload attrs 仍被规范化

### 验证命令

```powershell
pnpm exec vitest run src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/engine-order.test.ts src/services/sync/__tests__/snapshot.test.ts
pnpm exec vitest run src/services/sync/__tests__ src/services/__tests__/document-load-order.test.ts src/services/__tests__/tiptap-converter-sync-metadata.test.ts
```

本轮测试通过后，再结合真实日志确认：

- 每个 create 的 `clientId` 不同
- 每个 create 的 `syncCreateId` 也不同
- 每个 create 不再被后端折叠成同一个 `blockId`

---

## 6. 经验教训

### 6.1 只修排序，不修身份，是不够的

换行/空行问题一开始看起来像纯排序问题，但真实线上表现证明：

- 顺序元数据
- 本地快照推进
- create 幂等身份

三者缺一不可。

### 6.2 payload 内容“看起来正常”不代表同步请求是正确的

文本内容正确，不等于同步身份正确。

此次最关键的日志证据就是：

- 文本不同
- `clientId` 不同
- 但 `syncCreateId` 相同

这会让后端理所当然地把它们合并成同一个块。

### 6.3 不能只靠前面几层正确，最终发送前必须有兜底

编辑器 transaction、快照推进、reducer merge 都可能污染 payload。

因此：

> create 请求在真正发往后端之前，必须再规范化一次。

### 6.4 worktree 基线错误会极大放大排查成本

这次排查过程中，一个重要教训是：

- 错误基线 worktree 会制造大量“伪症状”
- 混入旧 bundle / 旧行为后，问题会显得像“修了但没修”

因此后续任何同步链问题，必须优先确认：

- 当前运行实例对应的源码基线
- 当前测试日志是否来自正确实例

---

## 7. 仍需后续关注的点

虽然本轮已经修复了“连续换行/空行”的主要问题，但后续仍建议继续观察：

1. 超大文档中的连续 create / move 是否还会出现边缘排序抖动
2. ack 回填是否需要进一步把服务端最终 `sortKey` patch 回本地 editor
3. 是否要把这套规范化逻辑收敛成更明确的“create payload builder”，避免 engine/reducer/api 三处重复约束
4. 是否要增加浏览器级端到端回归，把 `1 / 空行 / 2 / 空行 / 3 / 刷新` 固化成自动化场景

---

## 8. 总结

这次问题表面上是“换行不稳、空行丢失”，但真正的根因是：

> **连续 create 场景下，顺序元数据和稳定身份在快照推进与请求序列化链路中被污染或丢失。**

最终修复不是单个补丁，而是一条完整链路的收紧：

- 保留服务端 `sortKey`
- 连续 create 分配唯一排序键
- 本地 snapshot 保留排序锚点
- create 强制拥有自己的 `syncCreateId`
- merge 后规范化 payload
- 请求发送前最终兜底

这轮修复后，编辑器在“快速输入 + 连续换行 + 空行 + 刷新”这类高频真实场景中的稳定性明显回升，也为后续继续增强同步正确率打下了更清晰的基础。

# GC 调试面板使用说明

> 日期：2026-05-27  
> 适用仓库：`E:\workspace\editor-demo\app` + `E:\workspace\yuweb\back\server`  
> 适用版本：块版本 GC v1（preview-only）

## 1. 这套 GC 现在到底是什么

当前的 GC 系统还不是“自动删数据”的系统，而是一个**预览和诊断系统**。

它的目标是先回答这些问题：

- 哪些 `block_versions` 仍然被正式版本引用
- 哪些 `block_versions` 仍然被草稿引用
- 哪些 `block_versions` 理论上已经不再被引用
- 如果未来要做真正删除，当前数据是否健康到足以支持删除

所以第一版 GC 的核心特征是：

- **只做 preview**
- **只做统计**
- **只做候选识别**
- **不做物理删除**

你现在看到的调试面板，本质上是在观察这个 preview 系统是否按预期工作。

## 2. 先有一个全景观

### 2.1 当前 GC 模型里的关键表

#### `block_versions`

这是被 GC 分析的目标对象。

每一个块内容版本都存在这里。GC 要回答的核心问题是：

> 这个块版本还在不在任何有效引用链里？

#### `doc_snapshots`

这是正式版本引用图。

每个正式文档版本都有一个 `blockVersionMap`，它描述：

```json
{
  "block_a": 3,
  "block_b": 7,
  "block_c": 2
}
```

意思是这个文档版本要读取：

- `block_a@3`
- `block_b@7`
- `block_c@2`

只要某个 `blockId@ver` 出现在这里，它就是正式 root 引用，不能被回收。

#### `document_drafts`

这是草稿引用图。

草稿并不复制一套块版本表，而是也通过 `blockVersionMap` 引用 `block_versions`。

这意味着：

- 只要某个块版本还在草稿里被引用
- 它就不能成为 GC 候选

这也是为什么当前 GC 必须把草稿算进 root。

#### `gc_runs`

这是每次 GC preview 的运行记录。

你每点击一次“触发 Preview”，后端就会生成一条新的 run，记录：

- 这次扫描的 scope
- 使用的策略
- 健康检查结果
- summary 统计
- 是否保存了 candidate 明细

#### `gc_run_candidates`

这是某次 preview run 产生的候选明细。

注意：

- 这里的 candidate 只是“理论候选”
- 不是“已经被删”
- 也不是“马上会删”

它只是在告诉你：

> 如果未来允许删除，这些版本是最值得关注的候选对象

## 3. GC 面板里每个动作是干什么的

### 3.1 `x-system-admin-token`

这是**内部管理接口令牌**。

当前 GC API 都是内部调试接口，受 `SystemAdminTokenGuard` 保护，所以前端调试面板必须带这个头：

```http
x-system-admin-token: <token>
```

没有它，后端不会放行这些 GC 接口。

它的用途不是业务身份认证，而是：

- 防止普通前端请求随意触发内部 GC 诊断
- 把 GC preview 限定在明确授权的调试场景里

### 3.2 `x-operator-id`

这是**可选的操作者标识**。

它不会参与权限判断，也不会影响 GC 结果。

它的唯一用途是：

- 给 `gc_runs.triggeredBy` 留痕
- 让你知道这次 preview 是谁触发的

举例：

- 你填 `debug-local`
- 后端会把这次 run 标记成由 `debug-local` 触发

不填时，后端会退回到：

- 请求 IP
- 或 `system_admin`

所以它更像审计标签，不是安全令牌。

### 3.3 “刷新状态”

刷新状态**不会创建新 run**。

它做的是读取当前已有数据：

1. 调 `GET /admin/gc/block-versions/health`
2. 调 `GET /admin/gc/block-versions/runs`
3. 如果有最近一条 run，再调：
   - `GET /admin/gc/block-versions/runs/:runId`
   - `GET /admin/gc/block-versions/runs/:runId/candidates`

所以“刷新状态”的含义是：

> 重新读取当前 scope 下已有的 GC 健康状态和最近 preview 结果

它适合这些场景：

- 你刚编辑完文档，想看当前状态有没有变化
- 你想重新看最近一条 run 的结果
- 你不想产生新的 run，只想读现有结果

### 3.4 “触发 Preview”

触发 Preview 会创建一条新的 `gc_runs` 记录。

也就是：

```http
POST /admin/gc/block-versions/runs
```

当前前端面板会自动把当前页面文档的：

- `workspaceId`
- `docId`

带给后端，所以这次 preview 是**文档级 scope** 的，不是全库扫描。

触发 Preview 的作用是：

1. 按当前文档 scope 做一次新的 GC 预览
2. 重新计算：
   - health
   - hard roots
   - policy retained
   - candidates
3. 保存一条新的 run
4. 如果勾选“保存候选明细”，还会把 candidate 明细写入 `gc_run_candidates`

它适合这些场景：

- 你刚做了一轮编辑、保存、提交草稿，想看最新状态
- 你想明确知道“在当前时刻，GC 认为哪些东西是 candidate”
- 你想确认某个块版本在编辑后是否还被 root 引用

### 3.5 “保存候选明细”

这个选项控制的是：

> 这次 preview 是否把 candidate 明细落到 `gc_run_candidates`

不勾选：

- 仍会有 run summary
- 但不会有候选明细表数据

勾选：

- 会把候选明细保存下来
- 面板下方的 Candidates 区域就能展示具体条目

建议调试时默认勾选。

## 4. Health 面板怎么理解

Health 面板的任务不是告诉你“删不删”，而是先回答：

> 当前数据健康不健康，是否适合做 GC preview 判断？

### 4.1 `status`

只有两个值：

- `ok`
- `blocked`

#### `ok`

说明当前 scope 下，GC 前置健康检查通过。

这意味着：

- 快照覆盖关系基本完整
- 发布快照引用没有明显断裂
- root map 引用的块版本能在 `block_versions` 里找到

#### `blocked`

说明当前数据还不够健康，preview 虽然可以返回信息，但不会认为结果足够可信去生成有效候选。

这时候你应该优先修数据健康问题，而不是看 candidate。

### 4.2 `missingRevisionSnapshots`

中文可以理解为：

> 缺快照版本数

具体含义：

- 某条 `doc_revisions(docId, docVer)` 存在
- 但对应的 `doc_snapshots(docId, docVer)` 不存在

这会导致问题：

- 正式版本的引用图不完整
- GC 不知道这个历史版本到底引用了哪些块版本

所以这是很严重的健康问题。

### 4.3 `missingPublishedSnapshots`

中文可以理解为：

> 缺发布快照数

具体含义：

- 某个文档 `publishedHead > 0`
- 说明它有发布版本
- 但 `publishedSnapshotId` 找不到对应的 `doc_snapshots` 记录

这说明：

- 发布态引用图断了
- GC 无法可靠判断哪些块版本是发布内容必需的

### 4.4 `missingRootBlockVersions`

中文可以理解为：

> root map 指向了不存在的块版本数

具体含义：

- 某个 snapshot 或 draft 的 `blockVersionMap`
- 引用了例如 `b_1@7`
- 但 `block_versions` 里根本找不到这条记录

这比前两个更直接，说明引用图本身已经坏了。

### 4.5 `samples`

这个对象是健康问题的样例，不是全部列表。

它的作用是让你快速知道：

- 是哪篇文档坏了
- 坏在哪个版本
- 哪个 resource key 丢了

例如：

```json
{
  "missingRootBlockVersions": [
    {
      "source": "document_drafts",
      "docId": "doc_xxx",
      "resourceKey": "b_123@9"
    }
  ]
}
```

意思是：

- 有一个草稿 map
- 正在引用 `b_123@9`
- 但 `block_versions` 里没有这条版本

## 5. Health 面板下方的原始对象怎么看

Health 卡片下方那段 JSON 只是把后端原始返回完整展开。

它的意义不是给普通用户看，而是给调试者看：

- 数值聚合看得不够时，可以看完整结构
- 样例数组有哪些对象，一眼就知道
- 以后后端 health 字段扩展了，前端不用等 UI 先行支持也能看到

你可以把它当成“调试透传层”。

## 6. Latest Run 面板怎么理解

Latest Run 代表：

> 当前 scope 下最近一次 GC preview run 的完整结果

### 6.1 顶部 `status`

常见值：

- `completed`
- `blocked`
- `failed`
- `running`

#### `completed`

本次 preview 正常跑完了。

#### `blocked`

健康检查没过，run 被记录了，但候选结果不可信。

#### `failed`

运行本身出错了，例如代码抛错、持久化失败。

#### `running`

通常只会在 run 正在执行、结果还没最终写回时出现，当前本地调试场景里一般比较短暂。

### 6.2 四个核心计数

#### `blockVersionsScanned`

本次 scope 内一共扫描了多少条 `block_versions`。

它反映的是：

- 本文档的块版本池规模

#### `hardRootedBlockVersions`

有多少条块版本被**显式 root** 引用。

当前 root 只来自：

- `doc_snapshots.blockVersionMap`
- `document_drafts.blockVersionMap`

这个值越大，说明当前仍然活跃引用的版本越多。

#### `policyRetainedBlockVersions`

这些版本虽然没被显式 root 引用，但因为策略原因仍被保留。

当前策略包括：

- 最近 30 天内创建的版本
- 每个 block 最近若干个版本
- `Block.latestVer` 指向的当前最新版本

所以它的含义是：

> 这些版本现在还不能被当成 candidate，因为策略主动保留了它们

#### `candidateBlockVersions`

这是最关键的数字。

它表示：

> 在当前 preview 下，被认为“未被 root 引用，且超出保留策略”的候选版本数量

再次强调：

- candidate 不等于已删除
- candidate 不等于马上删除
- 它只是“理论上如果未来要做 sweep，可以优先关注的对象”

### 6.3 `runId`

这是本次 run 的唯一标识。

你后续查看：

- run 详情
- candidate 列表

都靠它。

### 6.4 `startedAt` / `finishedAt`

表示这次 preview 的起止时间。

用于判断：

- 这是不是你刚刚触发的 run
- 最近一次运行和当前编辑行为之间是否匹配

### 6.5 `policySnapshot`

这是这次运行实际使用的策略快照。

它不是“当前全局默认值”的抽象概念，而是：

> 本次 run 当时真实使用的参数

典型字段有：

- `gracePeriodDays`
- `keepLatestPerBlock`
- `maxCandidatesToStore`
- `rootSources`

它的调试意义很大：

- 以后策略调整了，你还能知道旧 run 当时用的是什么策略

### 6.6 `health`

Latest Run 里的 `health` 是这次 run 自己运行时记录下来的健康状态。

它和上面的 Health 面板通常会接近，但含义不完全一样：

- 顶部 Health 面板是“当前重新读取”的状态
- Latest Run 里的 health 是“那次 run 当时看到的状态”

如果你发现两边不一致，说明：

- 数据在两次请求之间发生过变化

### 6.7 `candidateDetailsStored`

表示这次 run 有没有保存候选明细。

- `true`：下方 Candidates 有机会看到数据
- `false`：只有 summary，没有 candidate 条目

### 6.8 `candidateDetailsTruncated`

表示候选明细有没有被截断。

为什么会截断：

- summary 可以记录真实 candidate 总数
- 但明细表不一定要无限保存

如果是 `true`，说明：

- 真实候选数可能大于当前下方展示条数

## 7. Latest Run 下方那段完整对象是什么意思

它就是 `GET /admin/gc/block-versions/runs/:runId` 的原始完整返回。

之所以保留，是因为调试时你经常会需要看：

- `scope`
- `policySnapshot`
- `health`
- `summary`
- `errorMessage`
- `triggeredBy`

如果把它们都拆成单独 UI，维护成本太高，也不利于追字段。

所以这里保留完整对象是故意的，方便做“原始语义核对”。

## 8. Recent Runs 是什么

Recent Runs 不是“统计历史图表”，而是：

> 当前 scope 最近若干次 preview run 的简表

你可以把它当成一组历史快照。

它的用途主要是：

- 对比你不同编辑动作后的 run 变化
- 看某次 run 是 `completed` 还是 `blocked`
- 切换某条 run，查看它的 candidate 明细

### 8.1 每一列是什么意思

#### `Run`

本次运行的唯一 ID。

#### `状态`

就是这次 run 的执行结果：

- `completed`
- `blocked`
- `failed`
- `running`

#### `扫描`

本次扫描到的 `block_versions` 数量。

#### `候选`

本次 summary 中的 `candidateBlockVersions` 数量。

#### `开始时间`

本次 run 的启动时间。

### 8.2 点击某一行会发生什么

点击某条 run 后，前端会：

1. 把它设为当前 `selectedRun`
2. 如果该 run 保存了 candidate 明细
3. 就去拉这条 run 的 candidates

也就是说：

- Recent Runs 是“切换调试上下文”的入口

## 9. Candidates 是什么

Candidates 面板是：

> 当前选中 run 下保存下来的候选块版本明细

每一行代表一条候选 `block_version`。

### 9.1 `Version`

就是 canonical key：

```text
blockId@ver
```

例如：

```text
b_1779xxx@4
```

表示块 `b_1779xxx` 的第 4 个版本。

### 9.2 `原因`

当前第一版最常见的是：

```text
unreferenced_older_than_policy
```

意思是：

- 没被显式 root 引用
- 已经过了保留窗口
- 也不属于最近保留版本

所以它被标为 candidate。

### 9.3 `风险`

当前第一版默认多半会显示 `medium`。

这是保守标记，不是风险评分系统的终态。

它表达的是：

> 这只是诊断候选，不应直接拿来删除

### 9.4 `版本时间`

这是该块版本自己的创建时间。

你可以用它判断：

- 这是很老的历史版本
- 还是刚刚编辑产生的新版本

## 10. 推荐调试流程

下面是最实用的使用方式。

### 场景 A：想确认编辑后是否产生了新的 candidate

1. 打开文档
2. 打开 GC 调试面板
3. 输入 `x-system-admin-token`
4. 点击“刷新状态”，看当前 baseline
5. 编辑文档
6. 触发一次保存或提交
7. 点击“触发 Preview”
8. 查看：
   - `Latest Run.summary`
   - `Recent Runs`
   - `Candidates`

观察重点：

- `blockVersionsScanned` 是否增加
- `hardRootedBlockVersions` 是否变化
- `candidateBlockVersions` 是否变化

### 场景 B：想确认草稿是否正确保护了块版本

1. 编辑文档但**不要 commit**
2. 触发 preview
3. 看 `candidateBlockVersions`
4. 看 health 是否正常

预期：

- 草稿当前引用的版本不应该进入 candidate

如果你怀疑某个版本被误判成 candidate：

- 对照 `document_drafts.blockVersionMap`
- 看该版本是否真的还在草稿引用里

### 场景 C：想确认历史快照是否完整

1. 直接看 Health
2. 如果 `status = blocked`
3. 看：
   - `missingRevisionSnapshots`
   - `missingPublishedSnapshots`
   - `missingRootBlockVersions`
4. 再展开 `samples`

预期：

- 正常情况下这三个数都应该是 0

## 11. 如何理解“正常工作”

GC preview 正常工作，不等于 candidate 一定很多或一定很少。

它真正的“正常”标准是：

1. Health 为 `ok`
2. 触发 Preview 后能生成新的 run
3. Latest Run 的 summary 数值变化符合你的编辑行为
4. 草稿引用的版本不会误进 candidate
5. 已无引用、且超出保留窗口的旧版本能进入 candidate

## 12. 常见误区

### 误区 1：`x-operator-id` 是权限凭证

不是。

它只是记录“谁触发了这次 run”。

### 误区 2：刷新状态会重新跑 GC

不会。

刷新状态只读现有结果，不会新建 run。

### 误区 3：触发 Preview 会删除数据

不会。

当前 v1 完全不删除数据。

### 误区 4：candidate 就是垃圾

不完全是。

candidate 只是：

> 按当前 preview + 当前策略看，理论上可以进一步观察的对象

它仍然不是 sweep 行为。

### 误区 5：Health 正常就一定没有任何问题

也不是。

Health 只说明最关键的前置关系没坏，不代表业务语义完全正确。

## 13. 当前版本的限制

你现在用这套工具时，需要知道它的边界：

1. 只支持 `block_version` 这一类资源
2. 只支持 preview，不支持删除
3. 当前 scope 主要是文档级调试，不是全库运维面板
4. Candidates 只会显示被保存下来的部分明细
5. JSON 原始对象保留较多，是故意偏向调试，不是最终产品态

## 14. 一句话总结

这套 GC 调试面板不是“垃圾回收按钮”，而是一个：

> 用来观察块版本引用图、数据健康度和候选集合是否符合预期的预览与诊断工具

最简单的使用心智模型是：

- **Health**：现在这份数据健康吗
- **Refresh**：重新看当前状态
- **Preview**：生成一份新的 GC 诊断快照
- **Latest Run**：最近一次诊断结论
- **Recent Runs**：诊断历史
- **Candidates**：这次诊断认为值得关注的旧版本候选

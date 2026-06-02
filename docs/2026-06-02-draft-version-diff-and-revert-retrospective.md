# 2026-06-02 草稿/保存版本 diff 与版本回退改造复盘

## 背景

这轮改造的起点并不是单一 bug，而是文档编辑链路里两个长期缺口叠加之后暴露出来的一组问题：

1. 版本对比页只能比较两个已保存版本，无法直接比较“当前草稿”和“任意已保存版本”。
2. 版本回退接口虽然已经存在，但没有和当前“正式版本 + 草稿工作副本”的双态模型打通。
3. 回退后继续编辑会触发 `SqliteError: UNIQUE constraint failed: block_versions.versionId`，说明回退语义与块版本号生成策略不一致。

这三个问题并不是彼此独立的。
如果只给前端加一个“草稿 diff”按钮，但后端 diff 仍把 tombstone 版本算作可见内容，就会出现“摘要显示有新增、页面却看不到差异”的错觉；
如果只把回退入口露出来，但不处理草稿保留策略，就会把用户的未提交工作置于高风险状态；
如果只补回退交互而不修块版本号分配规则，回退后的下一次编辑仍然会在后端炸掉唯一键。

因此这轮工作最终演变为一个完整的前后端联动补丁，目标不是“补一个按钮”，而是把以下语义补齐：

- 草稿是一个一等比较对象；
- 回退永远生成新版本，而不是修改 head 指针；
- 草稿存在时，回退必须明确选择“保留草稿”还是“丢弃草稿”；
- 回退后块版本号必须继续单调递增，不能复用旧号。

## 本轮目标

本轮最终落地的目标有四个：

1. **版本对比支持 draft vs revision**
   - 允许“草稿 ↔ 任意保存版本”统一走现有 diff 页面；
   - 不再单独新开页面或新建并行渲染器。

2. **回退语义与版本历史保持一致**
   - 回退永远生成一个新的保存版本；
   - 历史版本不会被丢弃；
   - 版本历史仍可继续对比、继续回退。

3. **草稿态下回退必须显式决策**
   - 保存草稿并回退；
   - 丢弃草稿并回退；
   - 取消。

4. **回退后的后续编辑必须安全**
   - 不能再出现 `block_versions.versionId` 唯一键冲突；
   - 块版本号必须基于历史最大值继续增长。

## 最终设计

### 1. 版本对比：把草稿纳入现有 diff 模型

最终没有新建一个 `/draft-diff` 页面或新的专用后端接口，而是扩展现有：

- `GET /documents/:docId/diff`

原来它只接受：

- `fromVer`
- `toVer`

现在扩展为支持引用类型：

- `fromKind = revision | draft`
- `toKind = revision | draft`
- `fromVer / toVer` 仅在 `kind=revision` 时提供

这样一来，前端不需要分裂成两套 diff UI，也不需要为草稿重新造一个渲染器。现有版本对比弹窗只需要把选择器从“版本号”升级成“比较引用（revision/draft）”。

### 2. 回退：永远生成新版本，不改 head 指针

本轮明确拒绝了“把当前 head 指针直接改回旧版本”的方案。

原因很简单：

- 如果把 `v1 v2 v3 v4 v5` 直接把 head 改到 `v2`，那么 `v3 v4 v5` 怎么处理会立即变成一组额外复杂度：
  - 删除？风险太高；
  - 保留但不在主链上？现有模型没有 branch 语义；
  - 标记悬挂？后续所有历史读取与对比都会变复杂。

因此本轮统一采用：

- **回退 = 生成新的文档版本**

例如：

- 原历史：`v1 v2 v3 v4 v5`
- 回退到 `v2` 后：`v1 v2 v3 v4 v5 v6`
- 其中 `v6` 的内容等于 `v2`

这样能保证：

- 旧历史不丢；
- 后续仍可回退回 `v5`；
- 与现有 `doc_revisions` / `doc_snapshots` 模型完全兼容。

### 3. 草稿态下回退的产品语义

当文档存在草稿时，回退必须经过显式选择。

#### 方案 A：保存草稿并回退

会连续生成两个新版本：

1. `保存回退前草稿`
2. `回退到 vN`

这样做的意义是：

- 用户当前工作不会丢；
- 回退动作本身仍保持明确；
- 版本历史里能清楚地区分“保留工作副本”与“回退结果”。

#### 方案 B：丢弃草稿并回退

只生成一个版本：

1. `回退到 vN`

这样做的意义是：

- 用户明确接受丢弃当前草稿；
- 历史更简洁；
- 依然不会破坏旧 revision 历史。

#### 方案 C：取消

- 不做任何事。

### 4. 版本消息语义

按照产品确认，本轮采用简洁版 message：

- 保存草稿：`保存回退前草稿`
- 回退：`回退到 vN`

没有采用更长的上下文型 message（例如“保存回退前草稿（回退到 v2 前）”），原因是：

- 当前历史列表空间有限；
- 简洁消息更适合作为主文案；
- 更详细的因果关系已经体现在版本顺序里。

## 关键问题与根因分析

## 1. 草稿 diff 摘要与页面展示不一致

### 现象

用户在取消草稿后，对比“最新保存版本 ↔ 草稿”时：

- 右上角摘要显示 `+7 新增`；
- 页面内容却看不出任何差异。

### 根因

后端 diff 的实现和内容树构建使用了两套“可见性”规则：

- `buildDiff()` 直接对比两个 `blockVersionMap`；
- `buildContentTreeFromVersionMap()` 会把 `payload.attrs.deleted === true` 的 tombstone 版本过滤掉。

这意味着：

- 草稿 map 里残留的删除 tombstone 会被 `buildDiff()` 统计成 `added`；
- 但真正渲染页面时，这些块又会被树构建阶段过滤掉；
- 最终形成“摘要有变化，内容看不见”的错觉。

### 修复

统一 diff 与内容树的“可见内容”定义：

- tombstone block version 不再被当作可见新增；
- 若某块在旧版本可见、草稿里变成 tombstone，则算 `deleted`；
- 若 tombstone 只存在于 draft map 中且两边最终都不可见，则直接忽略。

前端同时补了一个展示兜底：

- 当没有任何可见差异时，明确显示：
  - `所选草稿与版本没有可见差异`

这样用户不再看到空白 diff 区域配合误导性摘要。

## 2. 回退后继续编辑触发 `UNIQUE constraint failed: block_versions.versionId`

### 现象

复现路径：

1. 文档已经存在多个块版本；
2. 回退到旧保存版本；
3. 再输入内容并进行草稿同步；
4. 后端返回：
   - `SqliteError: UNIQUE constraint failed: block_versions.versionId`

### 根因

块版本号生成规则原来是：

- `newVer = block.latestVer + 1`

但回退逻辑会把：

- `block.latestVer`

直接指回某个旧版本号，例如从 `5` 改成 `2`。

与此同时，历史表 `block_versions` 中的：

- `blockId@3`
- `blockId@4`
- `blockId@5`

并没有删除。

于是下一次编辑时：

- 代码会根据 `latestVer=2` 算出 `newVer=3`
- 试图再次写入 `blockId@3`
- 直接撞上 `versionId` 唯一键。

### 修复

把所有“已有块生成新版本”的逻辑统一改成：

- **历史最大 ver + 1**

而不是：

- `latestVer + 1`

这样即使回退后当前块指向旧版本，后续编辑也会继续分配：

- `@6`
- `@7`
- `@8`

不会复用历史版本号。

这个修复不是只补一处，而是覆盖了 `BlocksService` 中多个会写入新 `BlockVersion` 的路径，包括：

- update
- move
- batch update
- batch delete tombstone
- batch move

## 前端改动概览

本轮前端主改动集中在以下文件：

- `F:\yuediter\src\services\document.ts`
- `F:\yuediter\src\components\VersionDiffModal.tsx`
- `F:\yuediter\src\components\DocumentHeader.tsx`
- `F:\yuediter\src\components\EditorPage.tsx`

### 1. `document.ts`

新增与扩展：

- `DiffRefKind = "revision" | "draft"`
- `getVersionDiff(docId, fromRef, toRef)`
- `revertDocument(docId, version, draftStrategy?)`

职责变化：

- 前端不再假设 diff 只能比较两个数字版本号；
- 回退请求开始显式支持草稿策略。

### 2. `VersionDiffModal.tsx`

本轮最核心的 UI 改动都在这里：

- 版本对比弹窗可显示 `草稿` 作为选项；
- 有草稿时默认比较：`最新保存版本 -> 草稿`；
- 侧边栏支持直接点开草稿内容；
- 选择某个保存版本后可点击：
  - `回退到此版本`
- 有草稿时会弹出三态确认；
- 无草稿时只显示普通确认；
- 回退成功后自动关闭弹窗并触发外层刷新。

### 3. `DocumentHeader.tsx`

只做最小改动：

- 给 `VersionDiffModal` 透传回退成功后的刷新回调。

### 4. `EditorPage.tsx`

新增了一个“回退后重载当前文档”的闭环：

- 重新 `selectDoc`
- 重新 `loadContent`
- 清理脏状态
- 把当前 UI 状态拉回最新正式内容

这样能避免“后端已回退，前端仍显示旧编辑态”的短暂分叉。

## 后端改动概览

本轮后端主改动集中在以下文件：

- `F:\yumer-server\src\modules\documents\dto\diff-versions.dto.ts`
- `F:\yumer-server\src\modules\documents\dto\diff-response.dto.ts`
- `F:\yumer-server\src\modules\documents\dto\revert-version.dto.ts`
- `F:\yumer-server\src\modules\documents\documents.controller.ts`
- `F:\yumer-server\src\modules\documents\documents.service.ts`
- `F:\yumer-server\src\modules\documents\services\document-draft.service.ts`
- `F:\yumer-server\src\modules\blocks\blocks.service.ts`

### 1. diff DTO / response

扩展现有 diff 契约，使之支持：

- `revision ↔ revision`
- `revision ↔ draft`
- `draft ↔ revision`

并在响应中增加：

- `fromRef`
- `toRef`

让前端能明确知道当前比较对象的语义，而不是只能靠 `fromVer / toVer` 猜测。

### 2. 回退 DTO

新增：

- `draftStrategy?: "preserve" | "discard"`

用于显式表达草稿处理策略。

### 3. `DocumentsService.revert()`

回退逻辑现在明确分支：

- 无草稿：直接回退
- preserve：先保存草稿，再回退
- discard：先丢弃草稿，再回退

同时把回退生成的新 revision message 改成：

- `回退到 vN`

并在 `opSummary` 与 snapshot metadata 中记录：

- `revertedFrom`
- `draftStrategy`

这让后续如果要扩展版本历史 tooltip、审计面板或更细的调试页，会有足够上下文可用。

### 4. `DocumentDraftService`

为了让“保存草稿并回退”处于同一个事务里，本轮把原来的草稿提交/删除能力进一步拆分：

- `commitDraft()` 保留外层事务包装
- 新增 `commitDraftWithManager()`
- 新增 `discardDraftWithManager()`

这样回退服务就可以在同一个事务里：

1. 先保存草稿或丢弃草稿
2. 再完成回退
3. 再创建新的回退 revision 与 snapshot

避免多事务拆裂带来的中间态问题。

### 5. `BlocksService`

这是解决唯一键冲突的关键补丁。

新增了统一的块版本号分配函数，基于：

- 某 block 历史上已有的最大 `ver`

来生成下一个号。

这个改动确保：

- doc revision 回退可以回到旧 block version；
- 但 block version 历史本身仍单调递增；
- `versionId = blockId@ver` 永不复用。

## 测试与验证

### 后端测试

本轮补了并跑通以下定向测试：

```powershell
pnpm test -- --runInBand src/modules/documents/documents.service.spec.ts
pnpm test -- --runInBand src/modules/blocks/blocks.service.draft.spec.ts
```

覆盖点包括：

- revision ↔ draft diff
- tombstone diff 可见性
- preserve/discard 两种回退策略
- 回退后块版本号继续从历史最大值递增

### 前端测试

本轮跑通：

```powershell
pnpm vitest run src/components/__tests__/version-diff-modal.source.test.ts src/services/__tests__/document-diff-api.source.test.ts
```

覆盖点包括：

- 草稿 diff 选项存在
- 回退按钮存在
- preserve/discard UI 文案存在
- 前端回退 API 已接入

### TypeScript 全量检查说明

之前已经确认，两边项目当前工作区都存在若干与本轮无关的历史类型错误，因此：

- `pnpm exec tsc --noEmit`

不能作为本轮改动是否正确的唯一验收标准。

本轮验收仍以：

- 定向单测
- 代码路径检查
- 真实问题链路复现与修复一致性

为主。

## 这轮工作的几个关键经验

### 1. “文档版本回退”和“块版本号”不是同一个层面的版本

这是本轮最重要的认知修正。

- 文档版本（doc revision）可以回退到旧内容；
- 但块版本（block version）不能因此回退并重新复用编号。

如果混淆这两个概念，就会自然写出 `latestVer + 1` 这种在平时看起来合理、但在回退后一定出错的逻辑。

### 2. 草稿是工作副本，不是弱化版正式内容

一旦草稿成为一等状态：

- diff 里要能比较它；
- 回退里要能选择如何处理它；
- 提交 message 要明确表达它；
- 它的存在不能只靠前端局部状态猜。

也就是说，草稿不是“还没保存的 UI 临时值”，而是完整工作副本模型的一部分。

### 3. 同一语义必须在“统计层”和“渲染层”一致

tombstone 问题本质上不是 diff 算法不会算，而是：

- diff summary 的“变化”定义
- content tree 的“可见内容”定义

不一致。

这种问题最容易骗过人工观察，因为它不是直接报错，而是“界面像没问题，但又明显不对”。

以后类似链路都应该优先检查：

- 摘要
- 详情列表
- 最终渲染

是否使用了同一套可见性规则。

### 4. 回退必须被当成“内容变换”而不是“指针跳转”

从产品视角看，用户想要的是：

- 恢复旧内容
- 不丢新历史
- 能继续编辑

而不是“数据库里的 head 指针变成某个旧数值”。

一旦坚持“回退 = 新版本”，后续很多实现和审计问题都会简单很多。

## 提交前建议

本轮涉及前后端两个仓库，建议分为两组提交：

### `F:\yumer-server`
建议包含：

- documents diff/revert 相关 DTO 与 service/controller
- document draft service 的事务化扩展
- blocks service 的 block version 号分配修复
- 对应测试

建议提交主题可参考：

- `fix(documents): support draft-aware revert and monotonic block versions`

### `F:\yuediter`
建议包含：

- draft-aware version diff UI
- revert 按钮与草稿策略弹窗
- 回退后自动重载链路
- 对应前端 source tests
- 本复盘文档

建议提交主题可参考：

- `feat(editor): add draft-aware diff and revert flow`

## 仍需注意的事项

1. 当前 `F:\yumer-server` 工作区里还有一个未跟踪文件：
   - `.env.example`
   这不是本轮核心改动的一部分，提交前应确认是否属于你本来就要一起提交的内容。

2. 版本历史页目前的“回退”入口在版本详情栏里已经可用，但如果后续继续优化 UX，可以考虑：
   - 在历史列表项上直接给出 hover 操作；
   - 或在回退版本上显示更明显的来源标签。

3. 目前 message 已经采用简洁版：
   - `保存回退前草稿`
   - `回退到 vN`
   后续如果要做更强的审计展示，可以再利用 `opSummary` 补充上下文，而不是把 message 文案继续拉长。

## 总结

这轮工作表面上看是“给版本对比页加草稿 diff，再补一个回退功能”，但实际落地后，它修正的是三个更底层的系统边界：

1. 草稿是正式的一等工作副本；
2. 回退是生成新版本，不是修改 head 指针；
3. block version 历史必须单调递增，不能因 doc revision 回退而复用旧号。

如果只做其中任何一个局部修补，这组问题都会以别的形式继续出现。
这次补丁的价值，不只是解决了眼前的 diff、回退和唯一键报错，更重要的是把这三条语义第一次统一到了同一套实现里。

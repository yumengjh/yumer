# 2026-05-30 高频编辑下块顺序污染 BUG 修复复盘

## 背景

编辑器使用 TipTap JSON 表示块文档。每个顶层 block 依赖 `blockId`、`clientId` 和 `sortKey` 进行身份识别与顺序同步，其中 `sortKey` 是持久化排序语义。用户在高频输入、回车分裂段落、删除、跨块跳转编辑时，曾出现本地 TipTap `content` 数组顺序与 `attrs.sortKey` 顺序脱节，保存或重新加载后云端按 `sortKey` 排序，导致视觉顺序被“打乱”。

## 现象

压力测试步骤大致为：

1. 删除所有内容；
2. 高频输入创建多个块；
3. 快速回车、删除、跨块编辑；
4. 等待自动同步或手动保存；
5. 对比本地快照、同步请求、同步响应和云端加载结果。

日志里曾出现几类症状：

- 本地快照后半段 `sortKey` 倒退；
- 普通同步把已有块误判为 move；
- create ack 到达后旧 snapshot 回灌，覆盖当前编辑器顺序；
- 后端 reserve sortKey 在部分场景下改写客户端请求的插入语义；
- 最终确认的一条主链路是：pending create 初次入队时的 `dirtyOrder/sortKey` 在高频编辑后过期，flush 时仍按旧顺序发送。

## 根因

### 1. pending create 使用了过期的排序计划

高频编辑时，新块在本地通常先以 `opType=create` 进入 sync reducer。之后用户继续换行、删除、跨块编辑，当前 TipTap content 数组顺序已经变化，但这些 pending create 的：

- `dirtyOrder`
- `entry.sortKey`
- `entry.payload.attrs.sortKey`

仍可能保持第一次创建时的旧值。最终 flush 时，请求顺序不再等于当前用户可见顺序，后端按请求中的 sortKey 创建块，云端 reload 后就与视觉顺序不一致。

### 2. create ack 不应整体回灌旧 snapshot

自动同步响应 create ack 后，旧实现会把 patched snapshot 直接 `setContent` 回 React state。高频编辑时 ack 对应的是较早的 snapshot，如果整体回灌会覆盖用户当前正在编辑的真实顺序。

### 3. sortKey 损坏时普通同步不应静默 repair

之前的 LIS move 规划会在 previous/next sortKey 已经脏时继续推导 move，可能把未移动的已有块改写 sortKey。普通同步应该检测、降级、阻止污染，而不是静默 compact 或 repair。

### 4. 后端 reserve 需要统一入口且避免脏占位影响插入语义

非 batch create/move 曾直接信任客户端 sortKey；batch create/move 虽有 reserve，但需要确保 payload 中的 sortKey 与最终持久化 sortKey 一致，并避免逻辑删除/隐藏块继续作为有效 sibling 占位。

## 修复内容

### 前端

1. `deriveSyncEntries` 同时检测 previous 和 next sortKey 完整性：
   - 发现重复、倒退、数组顺序冲突时，不再为已有块生成 move；
   - 普通同步不自动 repair，不批量改写已有块 sortKey。

2. fresh identity 新块清理继承的排序元数据：
   - split/insert 产生新 `clientId` 或重复 `blockId` 被清空时，同时清理继承的 `sortKey` / `data-sort-key`。

3. create ack 不再整体覆盖当前编辑器内容：
   - ack 只按 `clientId` 合并 `blockId/sortKey/syncCreateId/clientBatchId` 等同步 attrs；
   - 不再用旧 snapshot 覆盖当前 TipTap content 数组。

4. flush 前按当前 editor snapshot 重建 pending creates 的排序计划：
   - 以当前 TipTap content 数组顺序为权威；
   - 连续 pending create run 使用 `createSortKeysBetween` 重新分配 sortKey；
   - 同步更新 `entry.sortKey` 与 `entry.payload.attrs.sortKey`；
   - `dirtyOrder` 也按当前视觉顺序重排。

5. 显式拖拽/菜单移动场景补齐被移动块 sortKey：
   - 这不是本次压力测试主因，但属于同类排序语义入口；
   - 显式移动时只更新被移动块 sortKey，并写入 `data-sort-key`。

### 后端

1. 非 batch create/move 统一通过 `reserveUniqueSortKey`，避免继续写入重复 sortKey。
2. batch create 先 reserve 最终 sortKey，再用最终 sortKey 合并 payload，避免 `BlockVersion.sortKey` 与 `payload.attrs.sortKey` 不一致。
3. sibling sortKey 查询过滤 `payload.attrs.deleted === true` 的旧块，避免隐藏/逻辑删除块继续影响新块插入位置。

## 最终原则

- 当前用户可见 TipTap content 数组是 pending create flush 前的权威顺序；
- 普通文本编辑不改变已有块 sortKey；
- 新建块可以生成/重算 sortKey，但应在发送前以最新视觉顺序为准；
- 显式移动才允许改变被移动块 sortKey；
- 普通同步检测到 sortKey 损坏时只能降级/阻止污染，不能静默 repair；
- 显式 repair 流程应单独实现，并明确 authority 与 repair report。

## 验证

最终用户使用真实高频压力测试确认修复成功。此前也补充了针对以下场景的自动化覆盖：

- 脏 sortKey 下普通文本更新不产生已有块 move；
- 重复 sortKey 下插入新块不移动未变已有块；
- fresh identity 节点清理继承 sortKey；
- 拖拽/菜单显式移动时生成新的移动块 sortKey；
- 后端非 batch create/move 对 occupied sortKey 做唯一化处理。

## 后续建议

1. 单独实现显式 `repairDocumentSortKeys` / `repairSortKeys`，并返回 repair report。
2. 增加端到端压力测试：删除所有内容、高频换行、跨块编辑、删除、等待 autosync、reload 后比对视觉顺序。
3. 数据库层考虑增加同级唯一约束，或至少在服务层所有写入口强制统一 reserve / reject / report。
4. sync debug log 继续保留 blockId、clientId、oldIndex/newIndex、oldSortKey/newSortKey、entryType，以便后续定位。

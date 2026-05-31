# 2026-05-31 空文档首块同步与孤儿块修复复盘

## 背景

本轮修复围绕 TipTap 编辑器在“全选删除内容 → 不刷新页面 → 重新输入首行/多行 → 自动同步 → 刷新”场景下的同步一致性问题展开。

该场景同时触发了多条脆弱链路：

- 空文档状态下 TipTap 会保留一个本地 paragraph 占位块；
- 首个真实输入块在服务端 create ack 返回前没有 `blockId`；
- 高频输入、删除、回车会让 create/update/delete 同时处于 pending 或 inflight；
- create ack 对应的是较早 snapshot，如果处理不当会导致本地编辑器、React state、sync snapshot 三者分叉；
- 用户快速删除 inflight create 后，服务端仍可能成功创建块，形成云端多余块。

## 现象

用户反馈的主要异常包括：

1. 全选删除后，不刷新页面直接编辑第一行；
2. UI 显示已同步，但第一行实际没有发出有效 create/update；
3. 刷新后第一行消失、变空、被后续块顶替或顺序异常；
4. 修复首行丢失后，又出现本地快照正常、云端内容顺序正确但多出几个旧输入块的情况；
5. 编辑器默认示例内容会与空文档恢复链路混在一起，干扰判断和使用体验。

最新 `sync.log` 里能看到，本地快照只有 4 个目标块，但云端多出 3 个内容为 `naho / niaho / niaho` 的块。这 3 个多余块都带有同一个 `clientBatchId=batch_1780160839007_fzf5pr`，说明它们来自早期一次 create 批次，并不是当前本地快照顺序错误。

## 根因

### 1. 空文档首块被误判为已同步

同步快照初始化时，`previousSnapshot=null` 会被当成“只建立基线，不 enqueue change”。这对正常加载服务端文档是合理的，但对空文档首个真实输入不成立。

当唯一顶层块没有服务端 `blockId` 时，如果它被直接写入基线 snapshot，后续文本变化会被算成 `update`。而 `update` 没有 `blockId`，请求构建层会跳过该操作，导致：

- UI 看起来进入 saved；
- 实际没有可执行同步请求；
- 刷新后首行丢失。

### 2. create ack 没有同步回当前 editor / React content

上一轮修复中，create ack 只合并到了 sync snapshot，避免旧 snapshot 覆盖用户正在输入的内容。但真实浏览器链路还需要把服务端返回的：

- `blockId`
- `sortKey`
- `data-block-id`
- `data-sort-key`

以“仅 patch attrs”的方式写回当前 TipTap editor 与 React `content`。

否则刷新前继续编辑时，当前 editor 里的首块仍然可能没有服务端身份，后续 diff 继续产生无效 update 或重复 create。

### 3. 嵌套节点与顶层节点复用 clientId

列表转换、输入规则或节点拆分可能让嵌套 paragraph 与后续顶层 paragraph 复用同一个 `clientId/syncCreateId`。这会让后端幂等层把不同块误判为同一个 create，出现缺块、复用旧块或内容错位。

原先身份唯一性检查只覆盖顶层块，不足以处理列表内部 paragraph、listItem 等嵌套节点。

### 4. inflight create 被本地删除后形成云端孤儿块

最新一次多余块问题不是本地快照错误，而是时序问题：

1. 本地发出 create；
2. 用户继续编辑或删除，使这些 clientId 从当前本地 snapshot 中消失；
3. 服务端仍成功创建这些块并返回 create ack；
4. 前端没有发现“ack 回来的 clientId 已经不在本地文档里”；
5. 因此没有补发 delete，云端保留了孤儿块。

这解释了为什么本地快照正常，但云端多出几个旧输入块。

## 修复内容

### 1. 空文档不再使用示例内容

修改：

- `src/components/EditorPage.tsx`
- `src/services/document.ts`

内容：

- 移除编辑器默认欢迎示例；
- 默认内容改为真正空白 TipTap doc：

```ts
{
  type: "doc",
  content: [{ type: "paragraph" }],
}
```

- `loadDocumentContentV2` 在服务端无内容块时也返回空白 TipTap doc，而不是 `""`。

效果：

- 空文档加载不再回退到示例内容；
- sync engine 始终走 TipTap JSON 路径；
- 避免 HTML 空字符串与 JSON 文档模式混用。

### 2. 无 blockId 的块按 create 处理

修改：

- `src/services/sync/engine.ts`
- `src/services/sync/snapshot.ts`

内容：

- `deriveSyncEntries` 中，previous 里存在但没有服务端 `blockId` 的节点不再被视为已同步已有块；
- 删除操作只针对已有服务端 `blockId` 的块；
- 初始 snapshot 若只有一个无 `blockId` 且已有真实内容的块，会立即 enqueue create。

效果：

- 空文档首行输入会发出 create；
- 后续编辑不会退化成无 `blockId` 的 update。

### 3. create ack 只 patch attrs，并写回三处状态

修改：

- `src/components/EditorPage.tsx`
- `src/components/markdown-editor/MarkdownEditor.tsx`

内容：

- create ack 到达后，按 `clientId` 合并同步 attrs；
- 只更新当前节点 attrs，不整体回灌旧 snapshot 内容；
- 同时写回：
  - TipTap editor；
  - React `content`；
  - sync snapshot。

效果：

- 不覆盖用户正在输入的文本和视觉顺序；
- 刷新前继续编辑时，节点已有服务端 `blockId/sortKey`；
- 解决“首行已同步 UI 但刷新丢失”的核心问题。

### 4. 递归修正同步身份

修改：

- `src/services/sync/identity.ts`
- `src/components/markdown-editor/editorIdentity.ts`

内容：

- `ensureDocumentIdentity` 从只处理顶层改为递归处理；
- 编辑器事务里的身份补丁从 `doc.forEach` 改为 `doc.descendants`；
- 发现重复 `clientId` 或重复 `blockId` 时，为后续节点生成 fresh identity，并清理继承的排序元数据。

效果：

- 列表内部 paragraph 与顶层块不会复用同一个 `clientId`；
- 避免后端幂等 create 折叠不同块。

### 5. create ack 孤儿块自动补发 delete

修改：

- `src/services/sync/orphaned-create.ts`
- `src/hooks/useDocumentSync.ts`

内容：

- create ack 返回后，对比 ack mappings 与当前本地 snapshot；
- 如果某个 ack 的 `clientId` 已经不在当前本地文档里，判定为 orphaned create；
- 自动 enqueue 一个后续 delete，删除服务端刚创建出的孤儿块。

效果：

- 防止用户快速删除 inflight create 后云端留下多余块；
- 本地快照正常时，云端最终也能收敛到本地内容集合。

## 新增/扩展测试

- `src/services/sync/__tests__/snapshot.test.ts`
  - 初始无 `blockId` 首块应入队 create；
  - 后续编辑仍保持 create，而不是无效 update。

- `src/services/sync/__tests__/identity.uniqueness.test.ts`
  - 嵌套节点与后续顶层节点重复 `clientId` 时，后续节点会获得新身份。

- `src/services/sync/__tests__/orphaned-create.test.ts`
  - create ack 返回但 clientId 已不在本地 snapshot 时，生成后续 delete。

- `src/services/__tests__/document-edit-content.test.ts`
  - 空文档加载返回空白 TipTap doc，而不是空字符串或示例内容。

## 验证

本轮执行过以下验证：

```powershell
pnpm exec vitest run src/services/sync/__tests__ src/services/__tests__/document-edit-content.test.ts src/components/markdown-editor/__tests__/identity-selection.test.ts
pnpm exec eslint src/hooks/useDocumentSync.ts src/services/sync/orphaned-create.ts src/services/sync/__tests__/orphaned-create.test.ts src/components/EditorPage.tsx src/components/markdown-editor/MarkdownEditor.tsx src/services/document.ts src/services/sync/engine.ts src/services/sync/snapshot.ts src/services/sync/identity.ts
pnpm build
```

结果：

- 同步模块与相关编辑器/文档加载测试通过；
- ESLint 通过，仅保留项目现有 `MODULE_TYPELESS_PACKAGE_JSON` warning；
- Next build / TypeScript 通过；
- 用户手工复测确认：
  - 全删后首行刷新不再丢失；
  - 顺序正确；
  - 后续孤儿块修复后不再继续产生同类多余块。

## 后端影响

本轮没有后端代码修改。

多余块问题从日志看属于前端时序补偿缺失：服务端正常执行了早期 create，但前端没有在本地删除已发生后补发 delete。当前修复放在前端 sync ack 处理层即可闭环。

## 经验教训

1. **UI saved 不等于请求可执行。**  
   需要检查最终 batch body 是否真正包含 create/update/delete，而不是只看 reducer 状态。

2. **空文档首块是特殊状态。**  
   它看起来像“文档已有一个 paragraph”，但同步语义上可能是“尚未创建的首个内容块”。

3. **ack 不能整体回灌旧 snapshot。**  
   高频编辑下 ack 总是滞后于当前 editor，只能 patch 身份 attrs，不能覆盖内容和顺序。

4. **本地快照正常不代表云端无孤儿块。**  
   如果 create 已经 inflight，用户删除后仍要处理 create ack 成功的补偿 delete。

5. **同步身份必须递归唯一。**  
   只看顶层块不足以覆盖列表、表格、任务项等嵌套结构。

## 后续建议

1. 为“全删 → 输入首行 → 输入多行 → 删除部分 inflight 块 → 等 autosync → reload”增加浏览器级 E2E 回归。
2. sync debug log 增加 create ack orphan 检测日志，记录被补删的 `clientId/blockId/batchId`。
3. 提供一个显式“以当前本地快照为准清理云端多余块”的维护工具，用于处理历史孤儿块。
4. 后端可考虑提供按 `clientBatchId` / `syncCreateId` 查询最近 create 的调试 API，辅助排查时序问题。

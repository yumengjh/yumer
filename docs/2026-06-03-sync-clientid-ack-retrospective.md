# 2026-06-03 同步身份漂移与 ACK 回写修复复盘

## 背景

这轮修复围绕两个连续暴露的前端同步问题展开：

1. `bug001`：删除旧块、立即重建新内容后，刷新页面会“复活”旧段落；
2. `bug003`：视觉上编辑器已经只剩 1 段，但刷新后云端仍残留 1 个旧块。

两次问题表面症状不同，但都发生在同一条链路上：

```text
TipTap 本地块身份
  -> sync snapshot 基线
  -> autosync create/update/delete
  -> 服务端 create ack
  -> editor / React content / snapshot 回写
  -> 下一轮 diff
```

核心结论是：问题不在 `sortKey` 算法本身，而在“本地块身份是否稳定、ACK 是否真正写回当前事实、下一轮 diff 是否仍使用正确身份”。

## 现象

### bug001

`bug001.txt` 里能看到两类异常：

1. 后续 create 请求的 `clientId` 直接变成旧 `blockId`；
2. 删除失败后，前端继续把旧块当作本地待创建块重放。

这说明前端本地身份已经漂移，旧服务端块被重新当成新本地块参与同步。

### bug003

`bug003.txt` 的特征与 `bug001` 不同：

1. 没有再出现 `clientId = 旧 blockId`；
2. 最终残留的旧块 `b_1780472175342_0d9aebcf` 从头到尾没有被前端发出 `delete`；
3. 也就是说，这次不是“后端拒绝删”，而是“前端根本不知道自己应该删它”。

这说明第一轮修复挡住了身份串块，但还有一条更隐蔽的链路没有闭环。

## 根因

### 1. 本地同步键曾混用 `blockId` 和 `clientId`

早期逻辑里，本地 reducer/snapshot 的主键会退化到 `blockId ?? clientId`。这会导致：

- 已加载的服务端块被错误当作本地同步主键；
- 后续 diff / ACK / 删除补偿时，旧 `blockId` 容易串进本地身份空间；
- 在极端时序下，出现 `clientId` 漂移成旧 `blockId`。

### 2. 服务端加载内容不保证有稳定 `clientId`

从服务端加载的 TipTap doc 如果只有 `blockId`、没有 `clientId`，用户一旦立即编辑，这个块的本地身份就会不稳定。后续 diff 虽然还能勉强工作，但很容易在 ACK、删除、重排时进入错误分支。

### 3. create ACK 回写过于保守

这是 `bug003` 的关键。

编辑器当前的 ACK patch 逻辑原本要求：

- `clientId` 能对上；
- 节点类型一致；
- 节点正文内容也必须完全一致。

这样做的初衷是避免把旧 ACK 回灌到已经被用户改过的块上。但副作用是：

1. 本地块发出 create 后，用户继续输入；
2. 服务端 create ACK 返回时，当前编辑器里的正文已经和“发请求那一刻”不同；
3. ACK patch 因正文不一致而跳过；
4. React content / snapshot 虽然可能短暂持有服务端 `blockId`，但编辑器当前节点本身没有补上；
5. 下一次真实 `onChange` 发生时，编辑器再次导出没有 `blockId` 的当前节点，覆盖外部状态；
6. 最终删除该块时，前端认为它只是本地临时块，不会给服务端发 `delete`。

`bug003` 里那个残留旧块，本质上就是这样漏掉的。

## 修复内容

### 1. 本地同步状态统一以 `clientId` 为主键

修改：

- `src/services/sync/engine.ts`
- `src/services/sync/snapshot.ts`

原则调整为：

- 本地 reducer / dirty 队列 / snapshot entry 只用真实 `clientId` 做主键；
- `blockId` 只用于跨快照匹配“这是同一个已存在的服务端块”；
- 不再允许旧 `blockId` 混入本地待同步身份空间。

这直接修复了 `bug001` 中的身份漂移主链路。

### 2. 服务端加载文档时立即补齐 `clientId`

修改：

- `src/services/tiptap-converter.ts`

`blocksToTiptapJson(...)` 现在会在返回 doc 前执行 `ensureDocumentIdentity(...)`，保证：

- 已加载的服务端块即使只有 `blockId`，也会立刻获得稳定 `clientId`；
- 后续编辑、diff、ACK 都基于同一套本地身份。

### 3. ACK 回写允许“同 clientId、正文已变化”的块补身份

修改：

- `src/components/markdown-editor/editorIdentity.ts`

现在按 `clientId` 回写服务端 `blockId/sortKey` 时：

- 仍要求节点类型一致；
- 但不再要求正文内容完全一致。

换句话说，只要这是同一个本地块，就应该把服务端确认下来的身份写回去；正文是否已经被用户继续编辑，不应阻止身份补丁生效。

这是 `bug003` 的关键修复。

## 新增与调整测试

### 同步引擎测试

- `src/services/sync/__tests__/engine-order.test.ts`
  - 验证已有服务端块编辑/移动时保留真实 `clientId`；
  - 验证 blockId-only 场景会补出新的本地 `clientId`。

- `src/services/sync/__tests__/snapshot.test.ts`
  - 验证本地 dirty 队列不再以 `blockId` 作为主键；
  - 新增一条更贴近 `bug003` 的时序回放，确认在 create inflight、局部替换、再删除的链路里，旧服务端块不会被静默漏删。

- `src/services/__tests__/tiptap-converter-sync-metadata.test.ts`
  - 验证从服务端加载只有 `blockId` 的块时，会自动补 `clientId`。

### 编辑器 ACK 回写测试

- `src/components/markdown-editor/__tests__/identity-selection.test.ts`
  - 新增回归用例：
    - create ACK 返回时，本地块文本已经继续变化；
    - 仍应成功补上 `blockId/sortKey`；
    - 且不能移动当前 selection，也不能覆盖用户最新输入。

## 验证结果

本轮已执行：

```powershell
pnpm exec vitest run src/services/sync/__tests__/engine-order.test.ts src/services/sync/__tests__/snapshot.test.ts src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/orphaned-create.test.ts src/services/sync/__tests__/identity.uniqueness.test.ts src/services/__tests__/tiptap-converter-sync-metadata.test.ts src/services/__tests__/document-edit-content.test.ts src/components/markdown-editor/__tests__/identity-selection.test.ts

pnpm exec eslint src/services/sync/engine.ts src/services/sync/snapshot.ts src/services/tiptap-converter.ts src/services/sync/__tests__/engine-order.test.ts src/services/sync/__tests__/snapshot.test.ts src/services/__tests__/tiptap-converter-sync-metadata.test.ts src/components/markdown-editor/editorIdentity.ts src/components/markdown-editor/__tests__/identity-selection.test.ts
```

结果：

- 相关 `vitest` 用例全部通过；
- `eslint` 通过，仅保留项目现有的 `MODULE_TYPELESS_PACKAGE_JSON` warning；
- 用户手工复测确认：
  - 视觉上编辑正常；
  - 刷新后不再复活旧块；
  - 本地快照对比大部分关键字段正常；
  - `bug003` 场景已不再出现残留旧段落。

## 仍需讨论的隐藏问题

### ACK 现在只按 `clientId` 补身份，前提是 `clientId` 必须绝对稳定且唯一

本轮为了修复 `bug003`，放宽了 ACK patch 的匹配条件，这是正确的。但它也把系统对 `clientId` 稳定性的依赖进一步提高了。

潜在风险是：

1. 如果某个极端编辑器转换路径仍然产生重复 `clientId`；
2. 或者某个插件/输入规则错误复用了已有块的 `clientId`；
3. 那么 ACK patch 会更积极地把服务端 `blockId` 补到“同 clientId”的节点上；
4. 一旦重复 clientId 逃过前置修正，就可能把 ACK 打到错误块上。

当前我们已经有两层保护：

- `ensureDocumentIdentity(...)` 会递归去重；
- `patchEditorDocumentIdentity(...)` 也会在编辑器事务里清理重复身份。

但这件事仍值得继续讨论，因为它关系到这轮修复的边界条件。

### 建议

1. 在开发环境或同步 debug 模式下，新增一条“重复 `clientId` 诊断日志”；
2. 一旦发现同一份 doc 内出现重复 `clientId`，把节点路径、节点类型、blockId 一并打出来；
3. 如果后续还出现难解的 ACK 误配问题，优先先看 `clientId` 唯一性，而不是先怀疑后端排序。

## 提交建议

建议按一个前端同步修复提交，主题聚焦在两点：

1. 同步身份统一为 `clientId`，服务端加载内容补齐本地身份；
2. create ACK 回写允许本地文本继续变化时仍补 `blockId/sortKey`。

可参考提交说明：

```text
fix(sync): stabilize client identity and relax create ack identity patch
```

如果要拆分提交，建议顺序为：

1. `sync engine identity normalization`
2. `editor ack patch regression fix`
3. `tests and retrospective doc`

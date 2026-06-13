# Delta 功能最近提交代码审查记录

审查时间：2026-06-13  
审查范围：

- 前端仓库：`F:\yuediter`
  - HEAD：`6edfe5e8 fix(sync): suppress batch_partial_failure reload for active editor`
  - 重点提交：`74552853`、`8e9609e2`、`7185cba2`、`210f0d29`、`0046856b`、`4506cf0e`
- 后端仓库：`F:\yumer-server`
  - HEAD：`746143b fix(blocks): keep batch ack version and skip draft bump on partial failure`
  - 重点提交：`4779b8a`、`a5c40c6`、`815ec92`、`3712276`、`746143b`

## 验证结果

已通过：

- 前端 delta 相关单测：
  - `pnpm test:unit -- src/services/sync/__tests__/delta.test.ts src/services/sync/__tests__/api.test.ts src/services/sync/__tests__/base-store.test.ts src/services/sync/__tests__/batch-failure-delta.test.ts`
  - 结果：4 个测试文件、33 个用例通过
- 后端 delta 相关单测：
  - `pnpm test -- src/modules/blocks/block-delta/block-delta.spec.ts src/modules/blocks/block-delta/block-payload-resolver.service.spec.ts src/modules/blocks/dto/batch-block.dto.spec.ts`
  - 结果：3 个测试文件、17 个用例通过
- 后端构建：
  - `pnpm build`
  - 结果：通过
- 本地服务连通性：
  - `http://localhost:3001` 返回 200
  - `http://localhost:5200/api/v1` 返回 200

未通过：

- 前端构建：
  - `pnpm build`
  - 失败位置：`src/hooks/useDocumentSync.ts:1284`
  - 错误：`response.draftRevision` 类型是 `number | undefined`，传给了要求 `number` 的参数。

## 主要问题

### 1. 前端生产构建失败

位置：

- `src/services/sync/api.ts:15`
- `src/hooks/useDocumentSync.ts:1276-1286`
- `src/hooks/useDocumentSync.ts:1309-1318`

问题：

`SyncBatchResponse.draftRevision` 被声明为可选字段，但 `useDocumentSync` 中多处按必填 `number` 使用。当前前端单测能过，但 `next build` 的类型检查失败，生产构建不可用。

建议：

- 如果后端协议保证 batch response 一定返回 `draftRevision`，前端类型应改为必填。
- 如果协议允许省略，则在进入闭包前先保存已收窄的局部变量，例如 `const serverDraftRevision = response.draftRevision`，并在所有调用处显式兜底或提前返回。

优先级：高。

### 2. 后端部分读取路径仍直接使用 `BlockVersion.payload`，遇到 delta 行会读到 `null`

已实现的主路径 `buildContentTreeFromVersionMap` 会通过 `BlockPayloadResolverService.resolveBlockPayloads` 还原 delta payload，这是正确方向。

但以下路径仍直接读取 `payload`：

- diff 路径：
  - `src/modules/documents/documents.service.ts:3562-3572`
  - `src/modules/documents/documents.service.ts:3678-3686`
  - `src/modules/documents/documents.service.ts:3726-3729`
- startBlock 分页/按需树路径：
  - `src/modules/documents/documents.service.ts:3948-3949`
  - `src/modules/documents/documents.service.ts:4084-4085`
  - `src/modules/documents/documents.service.ts:4122-4123`
  - `src/modules/documents/documents.service.ts:4152-4153`
  - `src/modules/documents/documents.service.ts:4277-4278`

影响：

- diff 中 delta 版本会显示成 `paragraph` + 空 payload，可能造成版本对比结果错误。
- `startBlockId` 分页或按需加载命中 delta 版本时，返回内容可能缺失。

建议：

- diff 查询应包含 `id/docId/payloadKind/baseVer/delta/payload`，再统一走 `BlockPayloadResolverService`。
- startBlock/children 的按需路径也应在组装返回节点前批量或局部 resolve payload，避免直接使用 delta 行的 `payload`。

优先级：高。

### 3. 后端 move/delete 等写路径遇到最新版本是 delta 时可能丢 payload

位置：

- delete 草稿路径：
  - `src/modules/blocks/blocks.service.ts:2510-2532`
  - `src/modules/blocks/blocks.service.ts:2584-2585`
- move 路径：
  - `src/modules/blocks/blocks.service.ts:2659-2672`

问题：

这些逻辑直接使用 `latestVersion.payload`。如果最新版本是 delta 行，`payload` 为 `null`：

- delete 生成的 deleted payload 会丢失原始内容，只剩删除标记。
- create/delete compensation 可能读不到 `clientId/syncCreateId`。
- move 会创建一个 payload 为 `null` 的新版本，但 hash 仍沿用旧 hash，后续解析和内容读取存在风险。

建议：

- 凡是从最新版本派生新版本，都先通过 `BlockPayloadResolverService.resolveBlockPayload` 得到完整 payload。
- move 这种结构变更也应写入完整 payload，或明确保留 delta 语义但必须保证 resolver 可恢复。

优先级：高。

### 4. 后端 migration 对 SQLite 类型判断不一致

位置：

- `src/database/migrations/1783200000000-AddBlockVersionDeltaFields.ts:33`
- `src/database/migrations/1783200000000-AddBlockVersionDeltaFields.ts:45`

问题：

运行时配置里 SQLite 使用 TypeORM 类型 `better-sqlite3`，但项目环境变量使用 `DB_TYPE=sqlite`。当前 migration 判断只检查 `better-sqlite3`，如果迁移执行时 `queryRunner.connection.options.type` 不是预期值，可能走到 `jsonb`。

建议：

- 统一使用现有 `isSqlite` 语义，或同时兼容 `sqlite` / `better-sqlite3`。
- 同时建议给该 migration 增加一次 SQLite 环境下的迁移测试。

优先级：中。

## 其他观察

- 后端 `git status` 显示两个文件 modified：
  - `src/modules/blocks/block-delta/block-delta.spec.ts`
  - `src/modules/blocks/dto/batch-block.dto.ts`
  - 但 `git diff` / `git diff --numstat` 没有实际内容差异，像是工作树 stat 状态脏了，不是代码内容变更。
- delta 核心 canonical/hash/patch 契约前后端基本对齐，相关单测覆盖了主要路径。
- 当前最大风险不在 delta 编码本身，而在“存储层 payload 可为空”之后，历史读取/派生版本路径没有全部改成 resolver。

## 建议处理顺序

1. 先修前端构建失败，保证生产构建可用。
2. 后端统一梳理所有直接读取 `BlockVersion.payload` 的路径：
   - 内容树
   - diff
   - move/delete/rollback/revert 派生版本
   - 搜索/渲染/GC 如有直接使用也一并确认
3. 为“最新版本是 delta 后再 move/delete/diff/startBlock 加载”的场景补测试。
4. 再跑完整验证：
   - 前端 `pnpm build`
   - 前端 sync/delta 单测
   - 后端 `pnpm build`
   - 后端 delta + document sync e2e 测试

---

## 2026-06-13 修复记录

本次已修复上述高优先级问题中的前端构建类型错误，以及后端 delta payload 在 diff、startBlock/children 按需读取、move/delete 派生版本路径中的 `null payload` 风险。

### 已修复项

1. 前端 `SyncBatchResponse.draftRevision` 类型与实际协议对齐
   - 文件：`src/services/sync/api.ts`
   - 处理：将 `draftRevision` 从可选字段改为必填字段，匹配当前后端 batch response 与前端调用方预期。

2. 前端 move 衍生抑制集合的构建类型错误
   - 文件：`src/services/sync/engine.ts`
   - 处理：避免 `blockId && ...` 推导出 `"" | ReadonlySet<string>`，显式使用三元表达式返回 `ReadonlySet<string> | undefined`。

3. 后端 move/delete 派生新版本前先恢复完整 payload
   - 文件：`F:/yumer-server/src/modules/blocks/blocks.service.ts`
   - 测试：`F:/yumer-server/src/modules/blocks/blocks.service.draft.spec.ts`
   - 覆盖：最新版本为 delta 时，move/delete 不再把 `payload: null` 继续写入派生版本或 delete compensation。

4. 后端 diff 返回快照前先恢复 delta payload
   - 文件：`F:/yumer-server/src/modules/documents/documents.service.ts`
   - 测试：`F:/yumer-server/src/modules/documents/documents.service.spec.ts`
   - 覆盖：diff 查询补齐 `id/docId/payloadKind/baseVer/delta` 等 resolver 所需字段，比较/输出 snapshot 时使用 resolved payload。

5. 后端 startBlock/children 按需内容树路径恢复 delta payload
   - 文件：`F:/yumer-server/src/modules/documents/documents.service.ts`
   - 测试：`F:/yumer-server/src/modules/documents/documents.service.spec.ts`
   - 覆盖：分页/按需加载子块时，返回节点的 `type/payload` 来自 `BlockPayloadResolverService`，避免 delta 行返回空内容。

### 本次验证

- 后端相关测试：
  - 命令：`pnpm test -- src/modules/blocks/block-delta/block-delta.spec.ts src/modules/blocks/block-delta/block-payload-resolver.service.spec.ts src/modules/blocks/dto/batch-block.dto.spec.ts src/modules/blocks/blocks.service.draft.spec.ts src/modules/documents/documents.service.spec.ts --runInBand`
  - 结果：5 个测试文件、86 个用例通过。
- 后端构建：
  - 命令：`pnpm build`
  - 结果：通过，TSC 0 issues，SWC 编译成功。
- 前端相关测试：
  - 命令：`pnpm test:unit -- src/services/sync/__tests__/delta.test.ts src/services/sync/__tests__/api.test.ts src/services/sync/__tests__/base-store.test.ts src/services/sync/__tests__/batch-failure-delta.test.ts`
  - 结果：4 个测试文件、33 个用例通过。
- 前端构建：
  - 命令：`pnpm build`
  - 结果：通过，Next.js 生产构建与 TypeScript 检查通过。

### 仍待后续处理

- migration 对 SQLite 类型判断不一致的问题本次未修改；建议后续单独补 SQLite/better-sqlite3 迁移测试后修复。
- 可继续全局搜索 `BlockVersion.payload` 直读路径，尤其是搜索、渲染缓存、GC、历史恢复等非本次覆盖路径，确认是否也需要统一经过 resolver。


# 多端实时增量同步设计

日期：2026-06-10
状态：设计稿，待评审
涉及项目：
- 前端：`F:\yuediter`
- 后端：`F:\yumer-server`

## 1. 设计结论

第一版多端 / 多标签页同文档同步采用：

```text
客户端 A 本地编辑
  -> 客户端 A 通过现有 /blocks/batch 提交增量 operations
  -> 后端完成权限、版本、draftRevision、session 校验并落库
  -> 后端把已接受的 canonical remote operations 通过 SSE 广播给同一文档的其他在线端
  -> 客户端 B 收到 SSE
  -> 如果客户端 B 当前本地 clean，则直接应用远端增量
  -> 如果客户端 B 当前 dirty / flushing / revision 不连续，则弹出冲突提示并重新加载完整内容
```

核心策略：

1. **写入仍走现有 `/blocks/batch`。**
2. **服务端反向发送增量变更，不默认要求其他端全量拉取。**
3. **SSE 只广播服务端确认后的 canonical operations，不原样广播客户端请求。**
4. **本地 clean 时自动应用远端增量。**
5. **本地 dirty / flushing / 远端 revision 不连续时不做合并，提示冲突并重载。**
6. **第一版不做 CRDT、不做 OT、不做真正多人同时编辑合并。**

这能在不推翻现有同步系统的前提下，实现低延迟、多端可见的文档内容同步。

## 2. 背景

当前项目已经具备客户端到服务端的增量同步：

- 前端通过 `src/services/sync` 计算编辑器变更。
- 前端将变更转为 `create / update / delete / move` operations。
- 后端通过 `POST /blocks/batch` 接收批量增量写入。
- 后端使用 `baseVersion`、`draftRevision`、`clientBatchId`、`sessionId`、`sessionEpoch` 等字段保证幂等、版本一致和会话有效。
- 后端在冲突时返回 `needsReload` 和 `conflicts`。

但当前缺少服务端到客户端的实时反向通知，因此多个标签页或多个设备同时打开同一篇文档时，其他端无法低延迟看到最新内容。之前的简单方案是：收到服务端通知后重新拉取完整 `edit-content`。该方案正确但低效。

本设计在现有增量同步基础上增加反向增量广播，让其他在线端直接应用远端增量，只有异常和冲突场景才 fallback 到完整重载。

## 3. 当前项目同步现状

### 3.1 前端已有同步模块

当前前端同步相关文件：

```text
F:\yuediter\src\services\sync\
  api.ts
  batching.ts
  checkpoint.ts
  engine.ts
  identity.ts
  order.ts
  reducer.ts
  snapshot.ts
  types.ts
```

现有能力包括：

- Tiptap 文档规范化。
- 顶层 block diff。
- `create / update / delete / move` 增量生成。
- `clientId` / `blockId` 身份映射。
- `sortKey` 生成与修正。
- `draftRevision` 跟踪。
- batch ack 处理。
- `needsReload` / conflict 状态处理。
- sync session lease 状态处理。

### 3.2 后端已有 batch 写入协议

当前后端已有：

```http
POST /blocks/batch
```

请求包含：

```ts
interface BatchBlockDto {
  docId: string;
  operations: BatchOperation[];
  createVersion?: boolean;
  baseVersion?: number;
  draftRevision?: number;
  clientBatchId?: string;
  source?: "autosync" | "manual-save";
  sessionId?: string;
  sessionEpoch?: number;
  ackedThroughOpSeq?: number;
}
```

响应包含：

```ts
interface SyncBatchResponseDto {
  serverHead: number;
  draftRevision: number;
  ackedThroughOpSeq?: number;
  needsReload?: boolean;
  conflicts?: SyncConflictDto[];
  results?: SyncOperationResultDto[];
}
```

其中 `results` 已经包含 create ack 所需的 `clientId`、`blockId`、`sortKey` 等信息。

### 3.3 后端已有冲突检测

`BlocksService.batch()` 已经检测：

- `CLIENT_BATCH_ID_REQUIRED`
- `CLIENT_BATCH_ID_REUSED`
- `BASE_VERSION_REQUIRED`
- `BASE_VERSION_MISMATCH`
- `DRAFT_REVISION_MISMATCH`
- `SYNC_SESSION_REQUIRED`
- `SYNC_SESSION_MISMATCH`
- `SYNC_SESSION_EXPIRED`

这些冲突能力可以继续复用。多端实时同步的第一版不需要重做后端一致性控制。

### 3.4 当前不是协同编辑系统

当前同步协议是“客户端增量保存 + 服务端版本校验”，不是 CRDT / OT。因此本设计不尝试实现多人同时编辑自动合并，而是采用：

```text
clean 端自动应用远端增量
非 clean 端提示冲突并重新加载
```

## 4. 目标

### 4.1 功能目标

1. 同一篇文档在多个标签页打开时，一个标签页编辑后，其他标签页低延迟看到更新。
2. 同一篇文档在手机和电脑同时打开时，一个设备编辑后，另一个设备低延迟看到更新。
3. 正常情况下不重新拉取完整文档，而是应用服务端广播的增量 operations。
4. 同时编辑冲突时，后收到远端更新或后提交的一端提示冲突，并重载完整内容。
5. SSE 断线后自动重连；如果发现事件缺失，则 fallback 重载。

### 4.2 非目标

第一版不做：

1. CRDT。
2. OT。
3. 光标 presence。
4. 多人同时编辑自动合并。
5. 字符级 patch 合并。
6. WebSocket 双向协同。
7. 离线编辑队列跨设备合并。
8. 后端向前端发送 Tiptap 文本 diff patch。

## 5. 总体架构

```text
客户端 A
  Tiptap editor
  sync engine
  POST /blocks/batch
        ↓
后端 BlocksService.batch
  校验版本 / session / 权限
  应用 create/update/delete/move
  生成 SyncBatchResponse
  生成 canonical remote operations
  发布 document_remote_ops 事件
        ↓
RealtimeModule / SSE
        ↓
客户端 B / C / D
  EventSource 接收 document_remote_ops
  校验 origin / draftRevision / syncState
  clean: applyRemoteOpsToEditor
  dirty/flushing: showConflictAndReload
```

## 6. 为什么使用 SSE

第一版服务端只需要向浏览器单向推送文档变更事件，而客户端写入仍使用现有 HTTP 接口。因此 SSE 比 WebSocket 更适合第一版：

1. 浏览器原生 `EventSource` 支持。
2. 自动重连。
3. 服务端实现简单。
4. 与现有 REST 写入协议兼容。
5. 部署和调试成本低。
6. 后续仍可升级到 WebSocket + CRDT。

NestJS 支持 `@Sse()` 创建 SSE 路由，方法返回 `Observable<MessageEvent>`。

## 7. 后端模块设计

新增模块：

```text
F:\yumer-server\src\modules\realtime\
  realtime.module.ts
  realtime.controller.ts
  document-realtime.service.ts
  document-realtime.types.ts
```

### 7.1 RealtimeModule

职责：

- 提供 SSE controller。
- 提供 `DocumentRealtimeService`。
- 被 `BlocksModule` 或更上层模块引用，以便 batch 成功后发布事件。

### 7.2 RealtimeController

建议 endpoint：

```http
GET /realtime/documents/:docId/events
```

职责：

1. 校验用户已登录。
2. 校验用户有权读取该文档。
3. 建立 SSE 订阅。
4. 返回 `Observable<MessageEvent>`。
5. 连接断开时释放 subscriber。

伪代码：

```ts
@Controller("realtime")
@UseGuards(JwtAuthGuard)
export class RealtimeController {
  constructor(
    private readonly realtime: DocumentRealtimeService,
    private readonly documentsService: DocumentsService,
  ) {}

  @Sse("documents/:docId/events")
  async documentEvents(
    @Param("docId") docId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<Observable<MessageEvent>> {
    await this.documentsService.assertCanReadDocument(docId, user.userId);
    return this.realtime.subscribeDocument(docId, user.userId);
  }
}
```

如果 `DocumentsService` 当前只有 private 的 `assertAccessWithoutViewIncrement`，需要新增一个 public 方法：

```ts
assertCanReadDocument(docId: string, userId: string): Promise<Document>
```

该方法只做访问校验，不增加 view count。

### 7.3 DocumentRealtimeService

职责：

1. 管理文档维度的订阅者。
2. 发布文档远端增量事件。
3. 定期发送 heartbeat。
4. 订阅断开时清理资源。
5. 提供基础指标和日志。

内部数据结构：

```ts
type DocumentSubscriber = {
  id: string;
  userId: string;
  docId: string;
  subject: Subject<MessageEvent>;
  connectedAt: number;
  lastEventId?: string;
};

class DocumentRealtimeService {
  private subscribersByDocId = new Map<string, Map<string, DocumentSubscriber>>();
}
```

订阅方法：

```ts
subscribeDocument(docId: string, userId: string): Observable<MessageEvent>
```

发布方法：

```ts
publishDocumentRemoteOps(event: DocumentRemoteOpsEvent): void
```

清理策略：

- `finalize()` 中删除 subscriber。
- 某个 docId 下没有 subscriber 时删除 docId entry。
- heartbeat 失败时由 Observable 关闭链路清理。

## 8. SSE 事件协议

### 8.1 顶层事件类型

第一版支持：

```ts
type RealtimeSseEvent =
  | DocumentRemoteOpsEvent
  | DocumentReloadRequiredEvent
  | RealtimeHeartbeatEvent;
```

### 8.2 document_remote_ops

用于广播服务端已接受的远端增量变更。

```ts
interface DocumentRemoteOpsEvent {
  type: "document_remote_ops";
  eventId: string;
  docId: string;
  serverHead: number;
  previousDraftRevision: number;
  draftRevision: number;
  source: "autosync" | "manual-save" | "agent" | "unknown";
  originClientId: string | null;
  originTabId: string | null;
  clientBatchId: string;
  operations: RemoteDocumentOperation[];
  occurredAt: string;
}
```

字段说明：

- `eventId`：SSE 事件 ID，用于调试和断线判断。
- `docId`：文档 ID。
- `serverHead`：服务端当前文档 head。
- `previousDraftRevision`：本批变更应用前的草稿 revision。
- `draftRevision`：本批变更应用后的草稿 revision。
- `source`：变更来源。
- `originClientId`：发起变更的客户端实例 ID。
- `originTabId`：发起变更的标签页 ID。
- `clientBatchId`：原始 batch ID，用于幂等和调试。
- `operations`：服务端确认后的 canonical remote operations。
- `occurredAt`：事件发生时间。

### 8.3 document_reload_required

用于服务端无法安全广播增量，但知道文档已变化时提示客户端重载。

```ts
interface DocumentReloadRequiredEvent {
  type: "document_reload_required";
  eventId: string;
  docId: string;
  serverHead: number;
  draftRevision: number;
  reason:
    | "operations_not_replayable"
    | "batch_partial_failure"
    | "server_compaction"
    | "manual_admin_change";
  occurredAt: string;
}
```

第一版可以少用该事件，但保留协议有利于后续扩展。

### 8.4 heartbeat

用于保持连接和快速发现连接异常。

```ts
interface RealtimeHeartbeatEvent {
  type: "heartbeat";
  eventId: string;
  docId: string;
  occurredAt: string;
}
```

建议 20-30 秒发送一次。

## 9. RemoteDocumentOperation 协议

### 9.1 类型定义

```ts
type RemoteDocumentOperation =
  | RemoteCreateOperation
  | RemoteUpdateOperation
  | RemoteDeleteOperation
  | RemoteMoveOperation;
```

### 9.2 create

```ts
interface RemoteCreateOperation {
  type: "create";
  blockId: string;
  clientId?: string | null;
  parentId: string;
  sortKey: string;
  blockType: string;
  payload: Record<string, unknown>;
  plainText?: string;
  version?: number;
}
```

要求：

- `blockId` 必须是服务端生成的最终 ID。
- `sortKey` 必须是服务端最终采用的排序键。
- `payload.attrs.blockId` 应写入服务端 blockId。
- `payload.attrs.clientId` 可以保留原客户端 clientId，用于调试，但其他端不能依赖它作为主身份。

### 9.3 update

```ts
interface RemoteUpdateOperation {
  type: "update";
  blockId: string;
  payload: Record<string, unknown>;
  plainText?: string;
  version?: number;
}
```

### 9.4 delete

```ts
interface RemoteDeleteOperation {
  type: "delete";
  blockId: string;
  version?: number;
}
```

如果 delete 请求只通过 `clientId` 或 `syncCreateId` 命中，后端广播前也必须解析成确定的 `blockId`。无法解析时不广播 delete op，改发 `document_reload_required`。

### 9.5 move

```ts
interface RemoteMoveOperation {
  type: "move";
  blockId: string;
  parentId: string;
  sortKey: string;
  version?: number;
}
```

## 10. 为什么必须广播 canonical operations

不能直接广播客户端提交的 `BatchOperation`，原因如下：

### 10.1 create 需要服务端确认 ID

客户端 create 只有 `clientId`，服务端落库后才有 `blockId`、最终 `sortKey`、版本号。其他端必须使用服务端确认后的 ID。

### 10.2 sortKey 可能被服务端调整

前端请求的 sortKey 可能与已有 sortKey 冲突，后端会通过 `reserveUniqueSortKey` 采用最终 sortKey。广播必须使用最终 sortKey。

### 10.3 delete 可能通过 tombstone 或 client identity 命中

delete 操作可能针对尚未 ack 的 create，需要后端补偿和 tombstone 逻辑。其他端只应该收到最终明确的删除目标。

### 10.4 partial failure 不适合直接广播

如果 batch 中部分操作失败，广播原始请求会导致其他端状态错误。第一版建议：只有 batch 全部成功时广播 remote ops；如存在失败，发 reload required 或不广播，由提交端处理错误。

## 11. 后端发布时机

发布必须发生在事务成功之后。

建议流程：

```text
BlocksService.batch
  ↓
开启事务
  ↓
读取 serverDraftRevisionBefore
  ↓
校验 baseVersion / draftRevision / session
  ↓
执行 operations
  ↓
生成 results
  ↓
更新 Document.draftRevision
  ↓
保存 batch receipt
  ↓
事务提交
  ↓
如果 needsReload=false 且全部成功
      生成 DocumentRemoteOpsEvent
      realtime.publishDocumentRemoteOps(event)
  ↓
返回 SyncBatchResponse 给提交端
```

不要在事务内提前推送 SSE，避免客户端收到一个最终回滚的事件。

## 12. 后端 canonical operations 生成

### 12.1 输入

生成 remote ops 需要：

- 原始 `batchBlockDto.operations`
- 后端 `results`
- `acceptedBatchId`
- `serverHead`
- `serverDraftRevisionBefore`
- `draftRevisionAfter`
- `source`
- `originClientId`
- `originTabId`

### 12.2 create 映射

原始 operation：

```ts
BatchCreateOperation
```

result：

```ts
{
  operation: "create";
  success: true;
  clientId?: string;
  blockId?: string;
  sortKey?: string;
}
```

生成：

```ts
RemoteCreateOperation
```

需要使用：

- `result.blockId`
- `result.sortKey ?? operation.data.sortKey`
- `operation.data.parentId`
- `operation.data.type`
- `operation.data.payload`

同时需要修正 payload attrs：

```ts
payload.attrs.blockId = result.blockId
payload.attrs["data-block-id"] = result.blockId
payload.attrs.sortKey = result.sortKey
payload.attrs["data-sort-key"] = result.sortKey
```

### 12.3 update 映射

原始 operation：

```ts
BatchUpdateOperation
```

生成：

```ts
{
  type: "update",
  blockId: operation.blockId,
  payload: operation.data.payload,
  plainText: operation.data.plainText,
  version: internalVersion
}
```

如果需要服务端 canonical payload，应优先使用 `handleBatchUpdate` 返回的 payload。当前内部结果可能没有公开 payload，第一版可以基于请求 payload，因为 update 的 payload 已经被后端接受并写入。若后端有 merge/preserve 行为，应扩展内部结果包含 canonical payload。

### 12.4 delete 映射

生成要求：

- 必须有明确 `blockId`。
- 若 result 没有 blockId，尝试从 operation.blockId 获取。
- 若仍无法确定，不能广播增量 delete，改发 reload required。

### 12.5 move 映射

生成：

```ts
{
  type: "move",
  blockId: operation.blockId,
  parentId: operation.parentId,
  sortKey: result.sortKey ?? operation.sortKey,
  version: internalVersion
}
```

## 13. Batch DTO 扩展

为了让其他端识别事件来源，`BatchBlockDto` 增加可选字段：

```ts
originClientId?: string;
originTabId?: string;
```

说明：

- `originClientId` 表示浏览器/设备级客户端实例，存于 localStorage。
- `originTabId` 表示当前标签页实例，存于 sessionStorage。
- 两者都不是安全凭据，只用于事件去重和调试。
- 后端不能基于它们做权限判断。

Swagger DTO 可添加：

```ts
@ApiPropertyOptional({ description: "客户端实例 ID，用于实时同步事件去重" })
@IsOptional()
@IsString()
originClientId?: string;

@ApiPropertyOptional({ description: "标签页实例 ID，用于实时同步事件去重" })
@IsOptional()
@IsString()
originTabId?: string;
```

## 14. 前端连接设计

### 14.1 客户端身份

前端生成：

```ts
clientInstanceId: string
browserTabId: string
```

存储建议：

- `clientInstanceId`：localStorage，长期稳定。
- `browserTabId`：sessionStorage，每个标签页独立。

示例：

```ts
const clientInstanceId = getOrCreateLocalStorageId("yuediter.clientInstanceId");
const browserTabId = getOrCreateSessionStorageId("yuediter.browserTabId");
```

所有 `/blocks/batch` 请求附带：

```ts
originClientId: clientInstanceId,
originTabId: browserTabId,
```

### 14.2 SSE 连接生命周期

打开文档时：

```text
加载 edit-content
  ↓
初始化 sync reducer
  ↓
建立 EventSource(/realtime/documents/:docId/events)
```

关闭文档或切换文档时：

```text
关闭 EventSource
清理 remote queue
```

断线重连：

- EventSource 自动重连。
- 前端维护 `lastSeenRealtimeEventId`。
- 如果重连后收到的事件 revision 不连续，则 fallback reload。

### 14.3 认证问题

浏览器原生 EventSource 不方便设置 Authorization header。可选方案：

1. 如果项目使用 cookie auth，可直接使用 `withCredentials`。
2. 如果当前主要使用 Bearer token，需要实现带 token 的 SSE 方案：
   - 使用 query 参数短期订阅 token。
   - 或使用 fetch-based SSE polyfill 支持 header。

建议第一版优先使用 fetch-based SSE 客户端，避免把长期 JWT 放入 URL。

如果必须使用原生 EventSource，则后端可以提供短期 realtime token：

```http
POST /realtime/token
GET /realtime/documents/:docId/events?token=short_lived_token
```

该 token 有效期建议 1-5 分钟，只能用于 SSE 订阅，不能用于普通 API。

## 15. 前端 remote apply 设计

### 15.1 总体流程

```ts
function onDocumentRemoteOps(event: DocumentRemoteOpsEvent) {
  if (isSameOrigin(event)) return;

  if (!isLocalClean()) {
    showConflictAndReload(event);
    return;
  }

  if (!isRevisionContinuous(event)) {
    showConflictAndReload(event);
    return;
  }

  try {
    applyRemoteOperationsToEditor(event.operations);
    markRemoteRevisionApplied(event);
    showRemoteSyncedToast();
  } catch (error) {
    showConflictAndReload(event);
  }
}
```

### 15.2 来源去重

```ts
function isSameOrigin(event: DocumentRemoteOpsEvent) {
  return (
    event.originClientId === clientInstanceId &&
    event.originTabId === browserTabId
  );
}
```

同一浏览器不同标签页具有相同 `originClientId`、不同 `originTabId`，因此可以收到彼此的变更。

同一个标签页自己的事件应忽略，因为提交端已经通过 batch response 更新本地状态。

### 15.3 clean 判断

第一版只有在本地同步状态为 clean 时应用远端增量。

允许应用：

```ts
syncState === "idle" && dirtyOrder.length === 0 && !inflightBatchId
```

拒绝应用并冲突重载：

```ts
syncState === "dirty"
syncState === "flushing"
syncState === "error"
syncState === "conflicted"
syncState === "lease-lost"
inflightBatchId != null
dirtyOrder.length > 0
```

### 15.4 revision 连续性判断

```ts
function isRevisionContinuous(event: DocumentRemoteOpsEvent) {
  return event.previousDraftRevision === localDraftRevision;
}
```

如果不连续，说明：

- SSE 断线漏事件。
- 本地状态过期。
- 其他端已经应用了多个远端变更。

此时不能增量应用，必须重载完整内容。

### 15.5 应用远端操作时避免回写

远端 apply 必须标记 transaction meta：

```ts
tr.setMeta("syncSource", "remote")
```

现有编辑器同步监听需要跳过：

```ts
if (transaction.getMeta("syncSource") === "remote") {
  return;
}
```

否则会产生回声写入：

```text
A 写入 -> B 收到 remote -> B 应用 -> B 又同步回后端
```

## 16. 前端 remote operations 应用规则

### 16.1 create

处理：

1. 根据 `parentId` 找到父节点。
2. 构造 Tiptap node。
3. 写入 `attrs.blockId`、`attrs.clientId`、`attrs.sortKey`。
4. 按 `sortKey` 插入到正确位置。
5. 更新 sync snapshot index。

如果父节点不存在，则应用失败并触发重载。

### 16.2 update

处理：

1. 根据 `blockId` 找到当前节点。
2. 替换该 block 的 payload。
3. 保留必要的本地非内容状态时要谨慎，第一版以服务端 payload 为准。
4. 更新 sync snapshot index。

如果 block 不存在，则应用失败并触发重载。

### 16.3 delete

处理：

1. 根据 `blockId` 找到当前节点。
2. 删除该 block。
3. 更新 sync snapshot index。

如果 block 不存在，可以视为幂等成功，也可以触发重载。第一版建议视为成功并记录 debug 日志，因为可能此前已经应用过同等效果。

### 16.4 move

处理：

1. 根据 `blockId` 找到节点。
2. 根据 `parentId` 找到目标父节点。
3. 更新排序位置。
4. 写入 `sortKey`。
5. 更新 sync snapshot index。

如果找不到 block 或 parent，则应用失败并触发重载。

### 16.5 顶层 block 限制

当前前端 sync engine 主要围绕顶层 block diff 工作。第一版 remote apply 应优先支持顶层 block 的 create / update / delete / move。

如果后续需要支持嵌套 block 精细移动，需要扩展前端索引和应用逻辑。第一版遇到不支持的嵌套操作时触发重载。

## 17. 应用成功后的本地状态更新

远端增量应用成功后，必须更新：

```ts
baseVersion = event.serverHead
draftRevision = event.draftRevision
lastRemoteEventId = event.eventId
syncState = "idle"
```

还必须更新：

- 当前 editor doc。
- sync snapshot。
- sync snapshot index。
- blockId / clientId 映射。
- sortKey 状态。

建议新增 reducer action：

```ts
applyRemoteBatchSuccess(state, {
  serverHead,
  previousDraftRevision,
  draftRevision,
  eventId,
})
```

该 action 不清理本地 dirty entries，因为只有 clean 状态才允许进入。

## 18. 冲突处理策略

### 18.1 冲突触发条件

收到远端事件时，以下任一条件成立即视为冲突：

1. 本地 `syncState !== "idle"`。
2. 本地存在 `dirtyOrder`。
3. 本地存在 `inflightBatchId`。
4. `event.previousDraftRevision !== localDraftRevision`。
5. remote operations 应用失败。
6. remote operations 包含当前前端不支持的操作形态。
7. 后端 batch response 返回 `needsReload`。
8. SSE 断线后无法确认连续性。

### 18.2 冲突用户体验

提示文案：

```text
其他设备已修改此文档，当前本地内容已过期。为避免覆盖远端内容，将重新加载最新版本。
```

按钮：

```text
立即重新加载
```

可选按钮：

```text
复制当前内容后重新加载
```

第一版可以自动重载，但建议至少显示 toast 或 modal，避免用户困惑。

### 18.3 冲突重载流程

```text
停止当前 autosync flush
  ↓
标记 syncState = conflicted
  ↓
提示用户
  ↓
GET /documents/:docId/edit-content
  ↓
替换 editor content
  ↓
重建 sync snapshot
  ↓
更新 baseVersion / draftRevision / syncSession
  ↓
恢复 syncState = idle
```

如果重载失败，保持 `conflicted` 状态并允许用户手动重试。

### 18.4 后提交者冲突

如果两个端同时编辑：

```text
A 和 B 都基于 draftRevision=5 编辑
A 先提交成功，服务端 draftRevision=6
B 随后提交 draftRevision=5
```

服务端返回：

```json
{
  "needsReload": true,
  "conflicts": [
    {
      "code": "DRAFT_REVISION_MISMATCH",
      "serverDraftRevision": 6,
      "clientDraftRevision": 5
    }
  ]
}
```

B 前端处理：

```text
弹出冲突提示
重新加载完整内容
```

这是第一版明确接受的行为。

## 19. 断线与漏事件处理

### 19.1 SSE 自动重连

EventSource 会自动重连。fetch-based SSE 客户端也应实现重连。

### 19.2 eventId

每个事件有 `eventId`，SSE message 也设置 `id`：

```ts
{
  id: event.eventId,
  type: event.type,
  data: event,
}
```

### 19.3 revision 连续性优先于 eventId

第一版不需要持久化事件日志，因此不实现按 `Last-Event-ID` 补发历史事件。

客户端收到任何 `document_remote_ops` 后，用 revision 判断是否连续：

```text
event.previousDraftRevision === localDraftRevision
```

如果不连续，直接重载。

### 19.4 可选后续事件缓冲

后续可以在后端保存最近 N 个事件：

```ts
recentEventsByDocId: Map<docId, RingBuffer<DocumentRemoteOpsEvent>>
```

重连时根据 `Last-Event-ID` 补发。但第一版不做，避免复杂度。

## 20. 与 sync session 的关系

当前后端有 `DocumentSyncSession`，同一文档有活跃 session lease。多端实时同步第一版不改变 session 语义。

需要注意：

1. 同一用户多个端可能复用同一个 session。
2. 多端本地的 `ackedThroughOpSeq` 可能不同。
3. 提交端仍然必须携带 session 信息。
4. 其他端应用远端增量后，只更新本地 revision，不调用 `/blocks/batch`。

如果后续发现同一用户多端共享 session 导致 ack 语义混乱，可以再升级为：

```text
sessionId: 文档编辑租约
clientInstanceId: 客户端实例
clientOpSeq: 每个客户端独立操作序列
```

第一版先不改 session 模型。

## 21. 与 AI Agent patch 的关系

AI Agent 生成 patch 后，仍然由当前前端确认并应用，随后触发现有 autosync。autosync 成功后，后端会通过同一套 SSE remote ops 广播给其他端。

因此多端同步不需要为 AI 单独设计通道。

```text
AI patch -> 当前端应用 -> /blocks/batch -> SSE remote ops -> 其他端应用
```

## 22. 与 RAG / 知识库的关系

RAG 是只读能力，不直接参与实时同步。

但后续如果有知识库索引状态变化，可以复用 `RealtimeModule` 发布：

```text
knowledge_index_updated
```

第一版不纳入范围。

## 23. 后端安全与权限

1. SSE 订阅必须校验读取权限。
2. `originClientId` 和 `originTabId` 不能作为权限依据。
3. 发布事件时只推送给已通过权限校验的在线订阅者。
4. 不在日志中记录完整 payload 正文。
5. 连接断开必须清理 subscriber。
6. 对每个用户或每篇文档可设置最大 SSE 连接数，避免资源滥用。

建议限制：

```text
单用户最大 SSE 连接数：20
单文档最大 SSE 连接数：100
heartbeat 间隔：25 秒
空闲连接由客户端关闭，服务端靠断开回调清理
```

## 24. 后端错误与降级

### 24.1 SSE 发布失败

某个 subscriber 发送失败时：

- 不影响 batch response。
- 清理该 subscriber。
- 记录 debug 级日志。

### 24.2 remote ops 不可生成

如果 batch 成功但无法安全生成 remote ops：

- 发布 `document_reload_required`。
- 客户端收到后重载。

### 24.3 partial failure

如果 batch results 中存在失败：

- 不广播 remote ops。
- 如果文档状态已部分变化，发布 `document_reload_required`。
- 更推荐后端 batch 保持当前语义，由提交端处理失败；其他端不主动应用不完整变更。

## 25. 前端文件设计

建议新增：

```text
F:\yuediter\src\services\realtime\
  document-events.ts
  event-source-client.ts
  types.ts

F:\yuediter\src\services\sync\
  remote-ops.ts
```

### 25.1 document-events.ts

职责：

- 建立文档 SSE 连接。
- 解析事件。
- 自动重连。
- 暴露 subscribe/unsubscribe。

### 25.2 remote-ops.ts

职责：

- 把 `RemoteDocumentOperation[]` 应用到 Tiptap doc。
- 所有 transaction 标记 `syncSource=remote`。
- 应用失败时抛出明确错误。

### 25.3 sync reducer 扩展

新增：

```ts
applyRemoteBatchSuccess
markRemoteConflict
```

## 26. API / DTO 汇总

### 26.1 BatchBlockDto 新增字段

```ts
originClientId?: string;
originTabId?: string;
```

### 26.2 新增 SSE endpoint

```http
GET /realtime/documents/:docId/events
```

### 26.3 新增事件类型

```ts
DocumentRemoteOpsEvent
DocumentReloadRequiredEvent
RealtimeHeartbeatEvent
```

## 27. 兼容性策略

### 27.1 老客户端

老客户端不连接 SSE，仍然使用现有 autosync。行为不变。

### 27.2 新客户端连接失败

如果 SSE 不可用：

- 编辑和 autosync 仍可工作。
- 多端实时更新不可用。
- 可以提示“实时同步已断开”。

### 27.3 后端未发布 remote ops

客户端仍可在提交冲突时通过 `needsReload` 发现过期并重载。

## 28. 测试计划

### 28.1 后端单元测试

覆盖：

1. `DocumentRealtimeService.subscribeDocument` 能注册和清理 subscriber。
2. `publishDocumentRemoteOps` 只向同 docId 订阅者发送事件。
3. heartbeat 事件结构正确。
4. `BatchBlockDto` 接受 `originClientId` / `originTabId`。
5. batch 成功后生成 canonical create operation。
6. batch 成功后生成 canonical update operation。
7. batch 成功后生成 canonical delete operation。
8. batch 成功后生成 canonical move operation。
9. batch partial failure 不广播 remote ops。
10. `needsReload=true` 时不广播 remote ops。

### 28.2 后端集成测试

覆盖：

1. 用户无权限订阅文档 SSE 被拒绝。
2. 用户有权限订阅后能收到其他客户端 batch 事件。
3. 事件包含 `previousDraftRevision` 和 `draftRevision`。
4. create 事件包含服务端 `blockId`。
5. sortKey 冲突时事件包含服务端最终 sortKey。

### 28.3 前端单元测试

覆盖：

1. same origin event 被忽略。
2. idle + revision 连续时应用 remote ops。
3. dirty 时触发 conflict reload。
4. flushing 时触发 conflict reload。
5. revision 不连续时触发 conflict reload。
6. remote apply transaction 不触发 autosync diff。
7. create/update/delete/move 应用后 editor doc 正确。
8. remote apply 后更新 `draftRevision`。

### 28.4 E2E 测试

覆盖：

1. 两个标签页打开同一文档，A 编辑后 B 自动显示更新。
2. 两个标签页同时编辑，后提交端收到冲突并重载。
3. 手机模拟端和电脑模拟端同步。
4. SSE 断线期间发生更新，重连后 revision 不连续触发重载。
5. SSE 连接失败时普通编辑保存不受影响。

## 29. 分阶段实施计划

### Phase 1：基础 SSE 与事件广播

后端：

1. 新增 `RealtimeModule`。
2. 新增 `/realtime/documents/:docId/events`。
3. 新增 `DocumentRealtimeService`。
4. `BatchBlockDto` 增加 `originClientId` / `originTabId`。
5. `BlocksService.batch()` 成功后发布 `document_remote_ops`。

前端：

1. 生成 `clientInstanceId` / `browserTabId`。
2. batch 请求带来源字段。
3. 打开文档时连接 SSE。
4. 收到事件先只记录日志，不应用。

### Phase 2：clean 状态远端增量应用

前端：

1. 实现 `applyRemoteOperationsToEditor`。
2. remote transaction 标记 `syncSource=remote`。
3. sync listener 跳过 remote transaction。
4. 应用成功后更新本地 sync reducer 状态。
5. 显示“已同步其他设备修改”。

### Phase 3：冲突重载

前端：

1. dirty / flushing 时收到 remote ops 触发冲突提示。
2. revision 不连续触发冲突提示。
3. remote apply 失败触发冲突提示。
4. 实现完整重载流程。

### Phase 4：稳定性优化

1. SSE auth 优化。
2. heartbeat 和连接状态 UI。
3. reconnect backoff。
4. debug panel 增加 realtime events。
5. 后端 subscriber 限流和指标。

### Phase 5：后续协同编辑探索

如果未来要支持真正多人同时编辑：

1. WebSocket。
2. Yjs / CRDT。
3. ProseMirror collaboration。
4. presence / cursor。
5. 操作 rebase。

该阶段会显著改变编辑同步模型，不属于本设计第一版。

## 30. 关键决策记录

1. 第一版使用 SSE，不使用 WebSocket。
2. 写入仍走现有 `/blocks/batch`。
3. 服务端广播 canonical remote operations。
4. 不原样广播客户端 batch 请求。
5. clean 端自动应用远端增量。
6. dirty / flushing / revision 不连续时不合并，提示冲突并重载。
7. remote apply 必须跳过 autosync。
8. remote apply 成功后必须更新 `baseVersion`、`draftRevision` 和 sync snapshot。
9. 第一版不做 CRDT / OT。
10. 异常情况下 fallback 完整重载。

## 31. 待评审问题

1. SSE 鉴权采用 fetch-based SSE 还是短期 realtime token？建议优先 fetch-based SSE。
2. 第一版 remote apply 是否只支持顶层 block？建议只支持顶层 block，其他情况 fallback reload。
3. 冲突时是否自动重载，还是弹窗等待用户点击？建议弹窗说明后自动或由用户点击“立即重新加载”。
4. 是否需要把实时事件记录进现有 sync debug log？建议记录，便于排查多端同步问题。


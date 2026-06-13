# 内容同步字段分析：前端 Batch 协议字段分层与瘦身建议

> 日期：2026-06-13  
> 范围：`src/services/sync/*`、`src/hooks/useDocumentSync.ts`，并对照后端 `yumer-server/src/modules/blocks/dto/*`。  
> 结论摘要：当前字段确实偏多，但主要是因为“编辑器内部状态、幂等同步协议、块结构、内容 payload、delta 优化、ACK/重试/实时协同”混在同一条链路里。多数不是无用字段，不过已经需要明确分层，否则后续维护成本会继续升高。

---

## 1. 同步链路概览

当前前端内容同步大致分成 4 层：

```text
编辑器文档变化
  ↓ deriveSyncEntriesWithMetrics()
SyncEntry 内部变更队列
  ↓ selectSyncBatchOperations()
本次 batch 的 SyncEntry[]
  ↓ buildSyncBatchOperations()
HTTP /blocks/batch requestBody
  ↓ 后端处理后返回
SyncBatchResponse / results / ACK 回填
```

关键文件：

- 内部同步队列类型：`src/services/sync/types.ts`
- 文档差异推导：`src/services/sync/engine.ts`
- batch 选取：`src/services/sync/batching.ts`
- HTTP 协议构造：`src/services/sync/api.ts`
- ACK / 重试 / 状态机：`src/hooks/useDocumentSync.ts`、`src/services/sync/reducer.ts`
- delta base 缓存：`src/services/sync/base-store.ts`
- delta 编码：`src/services/sync/delta-encoding.ts`、`src/services/sync/delta.ts`

---

## 2. 字段为什么会显得很多

字段多的根因不是单一接口设计失控，而是多个目标叠加：

1. **块身份稳定性**  
   本地编辑器节点先有 `clientId`，服务端 ACK 后才有 `blockId`，中间还要靠 `syncCreateId` 做幂等和删除补偿。

2. **批次幂等与重试**  
   网络失败后同一个 `clientBatchId` 可以安全重试，后端通过 batch receipt 回放响应。

3. **草稿修订一致性**  
   `draftRevision` 防止本地基于过期草稿继续写入。

4. **会话与实时事件去重**  
   `sessionId/sessionEpoch` 保护编辑会话连续性，`originClientId/originTabId` 用于实时同步事件去重。

5. **结构同步与内容同步合流**  
   同一个 batch 同时承载 create/update/delete/move，因此结构字段、内容字段、身份字段会同时出现。

6. **delta 优化**  
   update 可以传完整 `payload`，也可以传 `delta`。这又引入 `baseVer/baseHash/patch/resultHash` 以及本地 baseStore。

7. **partial failure / ACK 修复**  
   `results` 里需要回传 `clientId/blockId/sortKey/version/matchBy/diagnosticCode`，前端才能做局部清理、重试、重排和 baseStore 更新。

所以当前问题不是“字段都没用”，而是**字段职责没有在代码和文档中分层表达**。

---

## 3. 前端内部字段：`SyncEntry`

位置：`src/services/sync/types.ts`

```ts
interface SyncEntry {
  clientId: string;
  blockId: string | null;
  opType: "create" | "update" | "delete" | "move";
  syncCreateId?: string;
  blockType?: string;
  payload?: Record<string, unknown>;
  plainText?: string;
  parentId?: string;
  sortKey?: string;
  revision?: number;
}
```

| 字段 | 层级 | 用途 | 是否直接发给后端 | 说明 |
|---|---|---|---|---|
| `clientId` | 内部身份 / ACK 对应 | 本地节点稳定 ID；create ACK、delete 未回填块、队列去重 | create/delete 会发；update/move 通常不发 | 同步队列的主 key。 |
| `blockId` | 服务端身份 | 已存在块的服务端 ID | update/move/delete 会发 | create 时为 `null`。 |
| `opType` | 内部操作类型 | 区分 create/update/delete/move | 转成 HTTP operation 的 `type` | 内部命名是 `opType`，HTTP 命名是 `type`。 |
| `syncCreateId` | 创建幂等身份 | create 重试、create 后未 ACK 又 delete、tombstone 匹配 | create/delete 会发 | 一般形如 `sync-create:${clientId}`。 |
| `blockType` | 内容类型 | create 时写入 `data.type` | create 发 | update 可从 payload/basePayload 推断 type，不单独发。 |
| `payload` | 内容数据 | create/update 的完整块内容 | create/update-full 发 | update 发送前会 `stripPayloadForSync()` 去掉同步元数据。 |
| `plainText` | 内部辅助 | 当前类型里保留，但本轮主链路未看到明显 HTTP 用途 | 不发 | 可后续确认是否还需要。 |
| `parentId` | 结构字段 | move 或 update 携带结构变化 | update/move 发 | 未提供时通常使用 `rootBlockId`。 |
| `sortKey` | 结构字段 | 顶层块排序 | create/update/move 发 | create 时还会写入 payload attrs，存在冗余。 |
| `revision` | 本地操作序号 | 计算 `ackedThroughOpSeq`，判断 ACK 是否覆盖当前 entry | 不作为 operation 字段发 | 只参与 batch 顶层高水位。 |

### 观察

`SyncEntry` 同时承担了：

- 队列索引；
- 操作协议草稿；
- 编辑器 payload 快照；
- ACK 清理依据；
- delta base 更新来源。

这导致它天然偏胖。更理想的做法是把它视为**内部工作单元**，不要直接把它理解为网络协议对象。

---

## 4. `/blocks/batch` 顶层请求字段

位置：`src/services/sync/api.ts` 的 `postSyncBatch()`。

当前实际 request body：

```ts
{
  docId,
  baseVersion,
  draftRevision,
  clientBatchId,
  originClientId,
  originTabId,
  sessionId?,
  sessionEpoch?,
  ackedThroughOpSeq?,
  operations,
}
```

| 字段 | 用途 | 来源 | 评价 |
|---|---|---|---|
| `docId` | 目标文档 | hook 初始化参数 | 必需。 |
| `baseVersion` | 客户端基于的文档 head | sync reducer state | 必需；用于版本冲突判断。 |
| `draftRevision` | 客户端基于的草稿修订号 | sync reducer state | 必需；当前前端已按必填处理。 |
| `clientBatchId` | 批次幂等 ID | `createBatchId()` | 必需；重试和 receipt 回放依赖它。 |
| `originClientId` | 客户端实例 ID | `getRealtimeOriginIdentity()` | 协同去重需要。 |
| `originTabId` | 标签页实例 ID | `getRealtimeOriginIdentity()` | 协同去重需要。 |
| `sessionId` | 编辑会话 ID | sync session | 可选但重要；用于会话保护。 |
| `sessionEpoch` | 会话纪元 | sync session | 可选但重要；用于续租/抢占判断。 |
| `ackedThroughOpSeq` | 本批覆盖到的本地操作序号高水位 | `SyncEntry.revision` max | 用于服务端记录当前会话 ACK 进度。 |
| `operations` | 具体块操作 | `buildSyncBatchOperations()` | 必需。 |

### 一个不一致点：`source`

`postSyncBatch()` 的输入包含：

```ts
source: "autosync" | "manual-save"
```

后端 DTO 也定义了：

```ts
source?: "autosync" | "manual-save"
```

但当前 `requestBody` 没有把 `source` 放进去。它主要用于：

- 前端 debug log；
- delete identity watch evidence；
- retry trace。

这不一定影响基本功能，但协议上有不一致：**前端有 source，后端也支持 source，实际却没传**。如果后端实时事件或审计需要区分 autosync/manual-save，建议后续补上。

---

## 5. Create 操作字段

前端构造：`BatchCreateBody`

```ts
{
  type: "create",
  clientId,
  syncCreateId,
  data: {
    docId,
    type,
    payload,
    parentId,
    sortKey,
  }
}
```

| 字段 | 用途 | 是否必要 | 分析 |
|---|---|---|---|
| `type` | 操作类型 | 必需 | HTTP discriminator。 |
| `clientId` | 本地节点 ID | 必需 | create ACK 回填 blockId 依赖它。 |
| `syncCreateId` | 创建幂等 ID | 强烈建议必需 | 重试、删除未 ACK create、tombstone 都依赖它。 |
| `data.docId` | 文档 ID | 冗余但后端 CreateBlockDto 需要 | 与顶层 `docId` 重复。 |
| `data.type` | 块类型 | 必需 | 后端 Block.type。 |
| `data.payload` | 块内容 | 必需 | create 必须有完整 payload。 |
| `data.parentId` | 父块 | 必需/默认根块 | 前端默认传 `rootBlockId`。 |
| `data.sortKey` | 排序键 | 需要 | 排序协议核心字段。 |

### Create payload attrs 中的冗余

`buildCreatePayload()` 会把身份/排序也写入 payload attrs：

```ts
attrs: {
  blockId: null,
  clientId,
  sortKey,
}
```

也就是说 create 请求里 `clientId/sortKey` 至少出现两处：

- operation 顶层：`clientId`
- data 顶层：`sortKey`
- payload attrs：`clientId/sortKey/blockId:null`

这看起来冗余，但有实际原因：

- operation 顶层字段服务于协议和 ACK；
- payload attrs 字段服务于编辑器节点身份回填和后续本地树稳定性；
- 后端历史逻辑也会从 payload attrs 里做 create/delete compensation 匹配。

短期不建议删除，但应在文档中明确：**payload attrs 里的同步字段是编辑器节点身份层，不等同于 HTTP 协议字段。**

---

## 6. Update 操作字段

前端构造：`BatchUpdateBody`

```ts
{
  type: "update",
  blockId,
  data: {
    payload?: Record<string, unknown>,
    delta?: {
      format: "dmp-v1",
      baseVer,
      baseHash,
      patch,
      resultHash,
    },
    sortKey?,
    parentId?,
  }
}
```

| 字段 | 用途 | 说明 |
|---|---|---|
| `type` | 操作类型 | 固定为 `update`。 |
| `blockId` | 服务端块 ID | update 必须是已存在块。 |
| `data.payload` | 完整内容 | 与 `delta` 二选一。发送前会剥离同步 attrs。 |
| `data.delta.format` | delta 格式版本 | 当前为 `dmp-v1`。 |
| `data.delta.baseVer` | delta 基准块版本 | 后端用来找 base version。 |
| `data.delta.baseHash` | 基准 payload hash | 防止基准内容不一致。 |
| `data.delta.patch` | patch 文本 | 实际增量。 |
| `data.delta.resultHash` | 应用 patch 后结果 hash | 防止 patch 结果不一致。 |
| `data.sortKey` | 可选结构变化 | update 可顺带 move。 |
| `data.parentId` | 可选父块 | 仅随 sortKey 搭配使用。 |

### Update 的复杂度来源

Update 是字段最多、分支最多的操作，原因是它同时处理：

1. 完整内容更新；
2. delta 内容更新；
3. 内容更新顺带 sortKey/parentId 结构调整；
4. ACK 后更新 baseStore；
5. delta base mismatch 后强制下一轮 full payload。

### payload 与 delta 的边界

后端 DTO 明确要求：

- `payload` 和 `delta` 必须二选一；
- 不能同时存在；
- 不能都不存在。

前端 `buildSyncBatchOperations()` 也遵守这个规则：

- 有可用 base 且 delta 有收益时传 `delta`；
- 否则传 stripped full `payload`。

这个边界是清晰的。

---

## 7. Move 操作字段

前端构造：`BatchMoveBody`

```ts
{
  type: "move",
  blockId,
  parentId,
  sortKey,
}
```

| 字段 | 用途 | 说明 |
|---|---|---|
| `type` | 操作类型 | 固定为 `move`。 |
| `blockId` | 被移动块 | 必需。 |
| `parentId` | 新父块 | 目前多数情况下是 rootBlockId。 |
| `sortKey` | 新排序键 | 必需。 |

Move 是当前最干净的 operation。复杂度主要不在字段，而在：

- 前端排序修复；
- move 优先于 update/create 的 batch 选择；
- ACK sortKey 与请求 sortKey 不一致时的 suppression；
- 后端 move 需要基于 latest payload 派生新版本。

---

## 8. Delete 操作字段

前端构造：`BatchDeleteBody`

```ts
{
  type: "delete",
  blockId?,
  clientId?,
  syncCreateId?,
}
```

| 字段 | 用途 | 说明 |
|---|---|---|
| `type` | 操作类型 | 固定为 `delete`。 |
| `blockId` | 已知服务端块 ID | 有 blockId 时优先按 blockId 删除。 |
| `clientId` | 本地节点 ID | 删除未 ACK create 或做兜底匹配。 |
| `syncCreateId` | 创建幂等 ID | 删除未 ACK create、tombstone 匹配更稳定。 |

Delete 字段看起来“可选很多”，但这是为了覆盖三种场景：

1. 删除已 ACK 的服务端块：有 `blockId`。
2. 删除刚 create 但还没 ACK 的本地块：可能只有 `clientId/syncCreateId`。
3. create/delete 在不同 batch 或重试中交错：需要 tombstone 防止“删除后又复活”。

因此 delete 的字段多属于幂等保护，不建议简单裁剪。

---

## 9. ACK 响应字段

前端类型：`SyncBatchResponse` / `SyncBatchResult`  
后端 DTO：`SyncBatchResponseDto` / `SyncOperationResultDto`

顶层响应：

| 字段 | 用途 | 前端处理 |
|---|---|---|
| `serverHead` | 服务端最新文档版本 | 更新 `baseVersion`。 |
| `draftRevision` | 服务端最新草稿修订 | 更新 `draftRevision`；当前按必填。 |
| `ackedThroughOpSeq` | 服务端确认的本地 op 序号 | 更新 `lastAckedOpSeq`。 |
| `needsReload` | 是否要求客户端重载 | 冲突/不可局部修复时使用。 |
| `conflicts` | 冲突列表 | 区分 draft revision mismatch 等。 |
| `results` | 逐操作 ACK | 清理 inflight entries、回填 blockId/sortKey/version。 |
| `manifestDigest` | 服务端顶层清单摘要 | 用于跳过全量 reconcile。 |

逐操作结果：

| 字段 | 用途 | 说明 |
|---|---|---|
| `operation` | 对应操作类型 | create/update/delete/move。 |
| `success` | 是否成功 | 后端可省略 true，前端 normalize 为 true。 |
| `clientId` | 本地节点 ID | create/delete ACK 对应。 |
| `blockId` | 服务端块 ID | create 回填、本地 baseStore 更新、ACK patch。 |
| `sortKey` | 服务端最终排序键 | ACK 后修正本地排序。 |
| `version` | 块版本号 | baseStore recordAck 需要。 |
| `error` | 失败信息 | partial failure 汇总。 |
| `diagnosticCode` | 诊断码 | delete/tombstone 等调试和分支处理。 |
| `matchBy` | delete 命中方式 | blockId/syncCreateId/clientId/not_found。 |
| `tombstoned` | 是否被 tombstone 覆盖 | delete 幂等语义。 |

### 响应字段多的原因

ACK 不是简单告诉“成功/失败”，它还承担：

- create 的 server blockId 回填；
- sortKey 纠偏；
- delta baseStore 更新；
- partial failure 时只清理成功项；
- delete not-found 幂等处理；
- 同步 session 的高水位更新。

所以 `results` 是协议复杂度的集中体现。

---

## 10. 字段分层建议

建议以后把字段按 5 层理解，而不是都叫“同步字段”：

### 10.1 Envelope：批次信封字段

负责“这是谁、基于什么状态、是否可重试”：

- `docId`
- `baseVersion`
- `draftRevision`
- `clientBatchId`
- `sessionId`
- `sessionEpoch`
- `ackedThroughOpSeq`
- `originClientId`
- `originTabId`
- `source`（建议补传）

### 10.2 Operation：操作意图字段

负责“我要做什么”：

- `type`
- `blockId`
- `clientId`
- `syncCreateId`

### 10.3 Structure：结构字段

负责“块在哪里”：

- `parentId`
- `sortKey`
- `indent`
- `collapsed`

### 10.4 Content：内容字段

负责“块内容是什么”：

- `blockType` / `data.type`
- `payload`

### 10.5 Delta：传输优化字段

负责“如何用较少字节表达内容变化”：

- `format`
- `baseVer`
- `baseHash`
- `patch`
- `resultHash`

---

## 11. 当前明显冗余或可整理点

### 11.1 `docId` 重复

create 操作中同时有：

- batch 顶层 `docId`
- `operation.data.docId`

这是后端 `CreateBlockDto` 复用导致的重复。短期可接受，长期可以考虑为 batch create 定义更薄的 DTO，默认继承 batch 顶层 docId。

### 11.2 `sortKey` 多处出现

可能出现于：

- `SyncEntry.sortKey`
- create `data.sortKey`
- create `payload.attrs.sortKey`
- update `data.sortKey`
- move `sortKey`
- response result `sortKey`

这些字段分别服务于内部队列、HTTP 结构变更、编辑器节点 attrs、ACK 修正。不是完全重复，但命名相同容易混淆。

建议文档约定：

- HTTP 顶层/operation 的 `sortKey` 是协议字段；
- `payload.attrs.sortKey` 是编辑器节点镜像字段；
- ACK `result.sortKey` 是服务端最终采用值。

### 11.3 `clientId` / `syncCreateId` 在协议和 payload attrs 中交叉存在

create/delete 需要它们做幂等和 ACK，对 payload attrs 的写入又让后端历史补偿逻辑可以从 payload 反查身份。

短期不建议删，但建议统一注释：

- operation 层：用于请求/ACK；
- attrs 层：用于编辑器节点身份持久化和补偿。

### 11.4 `source` 有类型但未实际发送

这是本次分析里最值得单独处理的小问题。

建议：

```ts
const requestBody = {
  ...,
  source: input.source,
  operations: bodyOperations,
};
```

这样前后端协议更一致，也方便服务端实时事件和审计区分 autosync/manual-save。

### 11.5 `plainText` 当前价值不清晰

`SyncEntry.plainText` 在类型中存在，但本轮主同步发送链路没有看到它进入 HTTP 请求。可能是历史遗留或未来搜索/摘要用途。

建议后续确认：

- 如果无用途，移除；
- 如果有用途，补注释说明它是内部字段，禁止进入协议层。

---

## 12. 建议的后续演进路径

不建议马上大改同步协议。更稳妥的顺序是：

1. **先补协议文档和注释**  
   明确哪些字段是内部字段，哪些字段是 HTTP 字段，哪些字段是 payload attrs 镜像字段。

2. **补一层显式类型分离**  
   例如：

   ```ts
   type InternalSyncEntry = SyncEntry;
   type BatchEnvelope = ...;
   type BatchOperationBody = ...;
   ```

   当前已有 `BatchOperationBody`，可以继续加强注释和 discriminated union。

3. **把 requestBody 构造集中为唯一出口**  
   现在基本集中在 `buildSyncBatchOperations()` / `postSyncBatch()`，这是好的。后续不要在 hook 中散落构造 HTTP 字段。

4. **逐步减少 DTO 复用造成的冗余**  
   后端可以考虑单独定义 `BatchCreateDataDto`，让 `docId` 从 batch envelope 继承，减少 create.data.docId 重复。

5. **为字段职责加测试**  
   例如：
   - create 必须带 `clientId/syncCreateId`；
   - update payload 与 delta 二选一；
   - delete 至少带 `blockId/clientId/syncCreateId` 之一；
   - source 应传到后端；
   - payload attrs 中不应携带 `clientBatchId/syncCreateId` 等临时字段，除 create 需要的稳定身份外。

---

## 13. 结论

当前进入内容同步时字段确实偏多，但大部分字段有明确原因：

- 身份字段解决本地节点到服务端块的映射；
- batch 字段解决幂等、重试和冲突检测；
- session/origin 字段解决实时协同和多标签页去重；
- structure 字段解决排序和移动；
- payload/delta 字段解决内容传输；
- response result 字段解决 ACK 回填、partial failure 和 baseStore 更新。

真正的问题是：**这些字段现在混在一个同步心智模型里，没有足够清晰的协议分层。**

短期最值得做的小修是补传 `source`，并把字段分层写进代码注释/协议文档。中期再考虑瘦身 create DTO 中的 `docId` 重复、确认 `plainText` 是否遗留、以及进一步区分内部队列字段与 HTTP 协议字段。

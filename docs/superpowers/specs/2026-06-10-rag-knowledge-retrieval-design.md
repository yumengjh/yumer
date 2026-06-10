# RAG / 知识库检索接入设计

日期：2026-06-10
状态：设计稿，待评审
关联设计：`docs/superpowers/specs/2026-06-10-ai-agent-module-design.md`
涉及项目：
- 前端：`F:\yuediter`
- 后端：`F:\yumer-server`

## 1. 结论

当前项目加入 RAG / 知识库检索的阻力不大，不需要大量破坏性更改。

原因是后端已经具备 RAG 的关键基础：

1. 文档和块已经结构化存储。
2. `BlockVersion` 中已有 `plainText`，可直接作为检索文本来源。
3. 已有 `SearchModule`，支持文档标题和块文本搜索。
4. 搜索逻辑已经包含 workspace 权限过滤。
5. Postgres 环境下已有 `searchVector` / `plainto_tsquery` 检索路径，SQLite 环境下已有 `LIKE` 降级路径。
6. 当前 AI Agent 设计已经要求工具链封装在 `ai` 模块内，不直接暴露现有 HTTP API，这很适合把 RAG 作为 LangChainJS tool 接入。

因此推荐第一版采用低侵入式 Keyword RAG：先复用现有 `SearchService.globalSearch()` 作为知识检索底座；后续再升级为 Hybrid RAG，引入 embedding 和向量检索。

## 2. 当前项目现状

### 2.1 后端已有 SearchModule

后端已有：

```text
F:\yumer-server\src\modules\search\
  search.controller.ts
  search.module.ts
  search.service.ts
  dto\
    search-query.dto.ts
    advanced-search.dto.ts
```

`SearchService` 当前提供：

- `globalSearch(dto, userId)`
- `advancedSearch(dto, userId)`

其中 `globalSearch` 能搜索：

- 文档标题：`Document.title`
- 块文本：`BlockVersion.plainText`

并返回：

- `docId`
- `docTitle`
- `blockId`
- `plainText`
- `ver`
- `docUpdatedAt`

这些字段足够支撑第一版 RAG 的上下文召回。

### 2.2 权限基础已经存在

`SearchService` 内部已经基于 workspace 做权限过滤：

- 如果传入 `workspaceId`，会调用 `workspacesService.checkAccess(workspaceId, userId)`。
- 如果不传 `workspaceId`，会通过 `workspacesService.findAll(userId)` 获取用户可访问的 workspace 列表。
- 搜索条件限制在 `d.workspaceId IN (:...workspaceIds)`。
- 已排除 `status = deleted` 的文档。

这意味着 RAG 第一版可以直接复用这条权限链路，不需要重新设计权限体系。

### 2.3 文档内容来源已经可用

后端已有实体包括：

```text
Document
Block
BlockVersion
DocDraft
DocRevision
DocSnapshot
```

其中 RAG 第一版最直接的数据来源是：

```text
BlockVersion.plainText
```

因为它已经是块级纯文本，天然适合：

- keyword search
- 构建 prompt context
- 后续生成 embedding
- 作为 citation source

### 2.4 数据库兼容现状

当前搜索逻辑已经兼容两类数据库：

- SQLite：使用 `LIKE`。
- Postgres：使用 `searchVector @@ plainto_tsquery(:query)` 和 `ts_rank`。

这决定了 RAG 的演进策略应该分层：

1. 第一版不依赖向量数据库，保证 SQLite / Postgres 都能运行。
2. 第二版在 Postgres 下优先支持 `pgvector`。
3. SQLite 环境可以继续使用 keyword RAG，或使用外部向量索引方案。

## 3. RAG 功能目标

### 3.1 第一版目标

第一版目标是让 AI Agent 能够检索用户已有文档，并基于检索结果回答问题或辅助生成编辑 patch。

典型问题：

- “根据我的文档，总结一下这个项目的技术栈。”
- “帮我找一下关于同步机制的说明。”
- “基于已有笔记，补全这段内容。”
- “这个概念之前在哪些文档里出现过？”

### 3.2 非目标

第一版不做以下事情：

1. 不做 embedding 生成。
2. 不新增向量数据库。
3. 不新增全文索引重建任务。
4. 不重写现有 `SearchModule`。
5. 不让 Agent 直接调用 `/search` HTTP API。
6. 不做跨用户、跨权限的全局知识库。
7. 不自动把搜索结果写回文档。

## 4. 推荐总体架构

RAG 作为 AI 模块内部能力接入：

```text
LangChainJS Agent
  ↓
retrieve_knowledge tool
  ↓
AiRagRetrieverService
  ↓
SearchService.globalSearch()
  ↓
Document / Block / BlockVersion
```

目录建议：

```text
F:\yumer-server\src\modules\ai\
  rag\
    rag.types.ts
    rag.service.ts
    rag-retriever.service.ts
    rag-context-builder.service.ts
  tools\
    retrieve-knowledge.tool.ts
```

如果第一版希望更精简，可以先只实现：

```text
ai\rag\rag-retriever.service.ts
ai\tools\retrieve-knowledge.tool.ts
```

## 5. 为什么不要直接暴露现有搜索接口给 AI

不建议让 Agent 直接调用：

```http
GET /search?query=...
POST /search/advanced
```

原因：

1. HTTP API 是给前端和外部调用设计的，不是给模型自主调用设计的。
2. API 参数可能比 Agent 需要的更宽，容易让模型构造不合适的查询。
3. Agent tool 需要更明确的语义、参数限制和结果裁剪。
4. 后续底层从 keyword search 升级到 hybrid search 时，不应该影响 Agent 的工具接口。

应该暴露一个语义化工具：

```text
retrieve_knowledge
```

这个工具内部可以先调用 `SearchService.globalSearch()`，未来再切换为 hybrid retriever。

## 6. LangChainJS Tool 设计

### 6.1 retrieve_knowledge

用途：在用户有权访问的知识库中检索与问题相关的文档片段。

输入 schema：

```ts
const RetrieveKnowledgeInputSchema = z.object({
  query: z.string().min(1).max(500),
  scope: z
    .enum(["current_document", "workspace", "all_accessible"])
    .default("all_accessible"),
  workspaceId: z.string().optional(),
  docId: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(8),
});
```

注意：

- `userId` 不在 schema 中，由后端 `AiToolContext` 注入。
- `workspaceId` 和 `docId` 即使由模型传入，也必须在工具内部做权限校验。
- `limit` 必须限制，避免模型一次召回过多上下文。

输出结构：

```ts
interface RetrieveKnowledgeResult {
  chunks: Array<{
    source: "keyword" | "vector" | "hybrid";
    docId: string;
    docTitle: string;
    blockId?: string;
    text: string;
    score?: number;
    updatedAt?: string;
  }>;
}
```

第一版 `source` 固定为 `keyword`。

### 6.2 Tool 内部流程

```text
输入 query / scope / limit
  ↓
校验 tool context 中的 userId
  ↓
根据 scope 决定 workspaceId / docId 过滤
  ↓
调用 SearchService.globalSearch({ query, type: "block", page: 1, pageSize: limit })
  ↓
裁剪 plainText 长度
  ↓
转换成 chunks
  ↓
返回给 Agent
```

### 6.3 上下文裁剪

每个 chunk 的 `text` 应限制长度。建议第一版：

```text
单 chunk 最大 800-1200 字符
总上下文最大 6000-12000 字符
```

超过后截断，并保留 doc title、block id 作为 citation 信息。

## 7. 第一版 Keyword RAG

### 7.1 工作方式

第一版 RAG 不引入 embedding，而是复用已有关键词搜索：

```text
用户问题
  ↓
Agent 判断需要检索
  ↓
调用 retrieve_knowledge
  ↓
SearchService.globalSearch 搜索 BlockVersion.plainText
  ↓
返回相关 block 片段
  ↓
Agent 基于片段回答，并引用来源
```

### 7.2 优点

1. 接入成本低。
2. 不改数据库。
3. 不影响现有同步系统。
4. 不影响文档编辑链路。
5. 支持 SQLite 和 Postgres。
6. 可快速验证知识库问答体验。

### 7.3 缺点

1. 语义检索能力弱。
2. 同义词、抽象问题召回效果有限。
3. 中文分词和排序效果取决于底层数据库能力。
4. 对问题改写和 query expansion 有一定依赖。

### 7.4 缓解方式

第一版可以在 Agent prompt 中要求：

1. 把用户问题改写成 1-3 个检索 query。
2. 优先搜索关键词和专有名词。
3. 如果检索不足，明确说明“未找到足够依据”。
4. 回答时标注来源文档标题。

## 8. 第二版 Hybrid RAG 设计

第二版可以新增 AI 模块内部知识 chunk 表，不改原有文档表。

建议实体：

```ts
interface AiKnowledgeChunk {
  id: string;
  workspaceId: string;
  docId: string;
  blockId?: string;
  sourceType: "block" | "document" | "memory";
  text: string;
  contentHash: string;
  embeddingModel?: string;
  embedding?: unknown;
  tokenCount?: number;
  isStale: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### 8.1 为什么新增表而不是改 BlockVersion

不建议直接把 embedding 字段加到 `BlockVersion` 上作为第一选择。原因：

1. `BlockVersion` 是核心内容版本表，改动风险更高。
2. embedding 属于 AI 派生数据，不应该污染核心文档模型。
3. embedding 可能有多个模型版本。
4. chunk 可能跨 block 或合并多个短 block。
5. 后续可能索引 memory、document summary、附件内容。

新增 `AiKnowledgeChunk` 更模块化，符合“AI 能力集中在 ai 模块中”的目标。

### 8.2 Hybrid 检索流程

```text
用户问题
  ↓
生成 query embedding
  ↓
向量检索 topK
  ↓
关键词检索 topK
  ↓
合并去重
  ↓
按 score / recency / document relevance 排序
  ↓
裁剪上下文
  ↓
返回 chunks 给 Agent
```

### 8.3 数据库选择

#### Postgres

优先考虑：

```text
pgvector
```

优点：

- 与现有 TypeORM / Postgres 体系兼容。
- 不需要单独部署向量数据库。
- 适合中小规模知识库。

#### SQLite

SQLite 下可以保留 Keyword RAG，或后续使用：

- 本地向量索引文件
- 外部向量服务
- 内存索引缓存

第一版不要求 SQLite 支持向量检索。

## 9. 索引更新策略

### 9.1 第一版

第一版没有独立索引更新，因为直接查 `BlockVersion.plainText`。

这意味着：

- 文档同步后，块最新版本更新。
- 搜索直接读最新 `BlockVersion`。
- RAG 天然读到现有搜索能读到的内容。

### 9.2 第二版

引入 embedding 后需要索引更新策略。建议不要一开始同步写 embedding，而是采用异步策略：

```text
block 更新
  ↓
标记对应 AiKnowledgeChunk isStale = true
  ↓
后台任务重新生成 chunk / embedding
  ↓
检索时优先使用 fresh chunk
```

如果暂时没有队列系统，可以先提供手动重建接口或脚本：

```text
scripts/rebuild-ai-knowledge-index.ts
```

后续再接入后台任务。

## 10. 与现有同步系统的关系

RAG 是只读能力，不应该参与当前文档的写入同步。

当前文档编辑链路仍然是：

```text
AI 生成 patch
  ↓
前端展示
  ↓
用户确认
  ↓
前端应用 Tiptap transaction
  ↓
现有 sync engine 自动同步
```

RAG 只负责在 Agent 生成回答或 patch 前提供上下文。

因此第一版 RAG 对现有同步系统没有破坏性影响。

## 11. 与全局记忆的关系

RAG 和 Memory 是相关但不同的能力：

| 能力 | 来源 | 用途 |
|---|---|---|
| RAG | 用户文档、块、知识库 chunk | 查事实、查上下文、引用文档依据 |
| Memory | 用户确认的长期偏好、项目事实 | 个性化、持续偏好、跨会话指令 |

后续 Hybrid RAG 可以把已确认 memory 也作为一种 `sourceType = "memory"` 的 chunk 参与检索，但第一版不需要。

## 12. 前端影响

第一版 RAG 对前端影响较小。

前端主要需要：

1. 在 AI Chat 或 AI Panel 中支持“基于知识库回答”。
2. 展示回答中的来源信息。
3. 对引用来源提供跳转能力：点击 doc title / block id 定位到文档。

第一版不要求修改编辑器同步逻辑。

建议前端展示来源：

```text
参考来源：
1. 《AI Agent 模块化接入设计》
2. 《frontend sync stability analysis》
```

后续可以支持点击跳转到具体 block。

## 13. 错误处理

RAG 工具需要处理：

```ts
type RagErrorCode =
  | "RAG_QUERY_EMPTY"
  | "RAG_PERMISSION_DENIED"
  | "RAG_SEARCH_FAILED"
  | "RAG_CONTEXT_TOO_LARGE"
  | "RAG_NO_RESULTS";
```

策略：

- 无结果：Agent 应明确说明没有找到足够依据。
- 权限失败：不返回具体文档存在与否，避免信息泄漏。
- 搜索失败：回答降级为“不使用知识库的普通回答”，或提示用户重试。

## 14. 安全与隐私

1. RAG 只能检索当前用户有权访问的 workspace。
2. Tool schema 中不暴露 `userId`。
3. 检索结果返回前需要裁剪长度。
4. 日志中不要记录完整 chunk 内容。
5. 回答中引用来源时只显示用户有权访问的文档。
6. 后续 embedding 存储需要记录模型版本和更新时间，便于重建和删除。
7. 删除文档或 workspace 权限变化后，后续向量索引必须能同步失效。

## 15. 测试计划

### 15.1 后端单元测试

覆盖：

1. `retrieve_knowledge` 不接受外部 `userId`。
2. 无权限 workspace 返回权限错误。
3. `limit` 超出范围时被 schema 拒绝。
4. 搜索结果会裁剪文本长度。
5. 空 query 被拒绝。
6. 无搜索结果返回空 chunks，不抛未知错误。

### 15.2 集成测试

覆盖：

1. 用户能检索自己 workspace 内的 block。
2. 用户不能检索无权限 workspace 的 block。
3. AI Chat 调用 RAG 后能在回答中带来源。
4. SQLite 下 keyword RAG 可运行。
5. Postgres 下全文检索排序可运行。

### 15.3 后续 Hybrid RAG 测试

覆盖：

1. chunk 重建后 contentHash 更新。
2. stale chunk 不优先返回。
3. embedding model 变更后可重建索引。
4. keyword + vector 合并去重。

## 16. 分阶段实施建议

### Phase 1：Keyword RAG

- 在 `ai` 模块中新增 `rag-retriever.service.ts`。
- 新增 `retrieve_knowledge` LangChainJS tool。
- 内部复用 `SearchService.globalSearch()`。
- Agent 可基于检索结果回答。
- 前端展示来源。

### Phase 2：RAG 上下文质量优化

- 增加 query rewrite。
- 增加 chunk 裁剪策略。
- 增加来源引用格式。
- 增加 current document / workspace / all accessible scope。
- 增加检索结果去重。

### Phase 3：Hybrid RAG

- 新增 `AiKnowledgeChunk` 实体。
- 增加 embedding 生成。
- Postgres 下支持 `pgvector`。
- 增加索引重建脚本。
- 支持 keyword + vector 合并排序。

### Phase 4：知识库管理

- 前端知识库设置页面。
- 手动重建索引。
- 查看索引状态。
- 排除某些文档或 workspace。
- 支持附件、导入文档、全局记忆进入知识库。

## 17. 对现有代码的改动评估

### 17.1 第一版改动范围

第一版主要新增：

```text
F:\yumer-server\src\modules\ai\rag\*
F:\yumer-server\src\modules\ai\tools\retrieve-knowledge.tool.ts
```

可能需要在 `AiModule` 中 import `SearchModule`。

### 17.2 第一版不需要改动

第一版不需要修改：

- `blocks` 同步协议
- 前端 sync engine
- `BlockVersion` 表结构
- `Document` 表结构
- `SearchController`
- 现有 `/search` API

### 17.3 后续可能需要改动

Hybrid RAG 阶段可能新增：

- `AiKnowledgeChunk` entity
- migration
- embedding 配置
- index rebuild script
- 后台任务或手动重建接口

这些仍然可以作为新增能力实现，不需要破坏核心文档编辑链路。

## 18. 关键决策记录

1. RAG 第一版采用 Keyword RAG。
2. 第一版复用现有 `SearchService.globalSearch()`。
3. RAG tool 放在 `ai` 模块中，不直接暴露 `/search` HTTP API 给 Agent。
4. RAG 是只读能力，不参与文档写入同步。
5. 第一版不新增向量数据库。
6. 后续 Hybrid RAG 通过新增 `AiKnowledgeChunk` 表扩展，不直接污染核心 `BlockVersion` 表。
7. 前端只需要展示 AI 回答和来源，不需要改自动同步逻辑。
8. 权限沿用 workspace 权限过滤，tool 内部不能信任模型传入的权限参数。

## 19. 待评审问题

1. 第一版 RAG 是否跟随 `/ai/editor/chat` 一起实现，还是先只作为 tool 内部能力预留？
2. RAG 第一版是否需要在回答中强制展示来源？建议强制展示。
3. 是否需要给前端提供“仅当前文档 / 当前工作区 / 全部可访问文档”的检索范围选择？建议第一版提供。


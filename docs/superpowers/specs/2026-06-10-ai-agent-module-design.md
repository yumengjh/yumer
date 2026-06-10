# AI Agent 模块化接入设计

日期：2026-06-10
状态：设计稿，待评审
涉及项目：
- 前端：`F:\yuediter`
- 后端：`F:\yumer-server`

## 1. 背景与目标

当前前端已经具备基于 Tiptap 的编辑器和自动增量同步能力，后端已经具备文档、块、搜索、权限、草稿版本、同步会话等模块。第一版 AI Agent 的目标是在不破坏现有编辑与同步链路的前提下，为编辑器提供可预览、可确认、可回滚心智的 AI 辅助能力。

第一版明确采用：

```text
后端运行 Agent
  -> Agent 生成 patch 建议
  -> 前端展示 diff / preview
  -> 用户确认
  -> 前端应用到 Tiptap editor state
  -> 现有自动增量同步落库
```

Agent 不直接修改当前打开文档的数据库内容。这样可以最大化复用现有同步系统，避免后端修改与前端本地编辑状态冲突。

## 2. 非目标

第一版不做以下事情：

1. 不让 Agent 直接调用任意 HTTP API。
2. 不让 Agent 直接写 `blocks`、`documents` 表。
3. 不重写现有前端同步系统。
4. 不引入 WebSocket / SSE 作为必需依赖。
5. 不做完整 LangGraph 长任务编排。
6. 不做自动记忆写入；记忆只做接口预留和提议模型。
7. 不做复杂协同编辑冲突合并。

这些能力可以作为后续阶段扩展。

## 3. 总体原则

### 3.1 模块化优先

所有 AI 相关后端代码集中放在后端 `src/modules/ai` 中。第一版尽量不侵入已有模块，只通过已有 service 或新增轻量 facade 读取必要上下文。

### 3.2 AI 只看到语义化工具

不直接把现有 REST 接口暴露给 AI。AI 只能使用经过封装的 LangChainJS tools，例如：

- `read_current_document_context`
- `search_accessible_documents`
- `read_selected_blocks`
- `propose_selection_patch`
- `propose_memory`

工具的参数由 Zod schema 严格约束，工具内部绑定当前 `userId`、`docId`、`workspaceId` 等上下文，AI 不能伪造权限参数。

### 3.3 写操作默认变成提议

当前文档内的修改只返回 patch proposal，不直接落库。前端必须展示给用户，用户确认后再应用到编辑器，由既有自动同步机制负责落库。

### 3.4 权限在工具内部校验

每个工具内部必须通过后端已有权限逻辑读取文档和块。不要信任模型生成的 `docId`、`blockId`、`workspaceId`。

### 3.5 全局记忆同样需要确认

全局记忆能力第一版只做数据结构和 tool 设计预留。Agent 可以提出“建议记住”，但不能未经用户确认自动写入长期记忆。

## 4. 第一版功能范围

### 4.1 编辑器选区 AI 操作

支持以下基础动作：

1. 润色
2. 扩写
3. 缩写
4. 翻译
5. 续写
6. 总结选区
7. 改写为更清晰的结构

输入来自前端当前编辑器状态，包括：

- `docId`
- `action`
- `selectionText`
- `beforeText`
- `afterText`
- `selection.from`
- `selection.to`
- 可选的当前文档标题、路径、语言偏好

输出为 patch response，不直接写库。

### 4.2 当前文档问答

用户可以围绕当前文档向 AI 提问。后端 Agent 可以读取当前文档上下文，但回答不自动修改内容。

### 4.3 简单跨文档检索

Agent 可以通过只读工具检索用户有权访问的文档，辅助回答问题或生成 patch。

### 4.4 全局记忆预留

第一版允许 Agent 返回 memory proposal，例如：

```json
{
  "type": "memory_proposal",
  "scope": "user",
  "content": "用户偏好中文、简洁、技术细节明确的回答。",
  "reason": "用户多次明确要求默认中文并偏好方案细节。"
}
```

但是否保存由前端提示用户确认。

## 5. 后端模块设计

后端新增模块：

```text
F:\yumer-server\src\modules\ai\
  ai.module.ts
  ai.controller.ts
  ai.service.ts
  dto\
    editor-selection-agent.dto.ts
    editor-chat-agent.dto.ts
    ai-patch-response.dto.ts
    memory-proposal.dto.ts
  agent\
    editor-agent.service.ts
    agent-context.ts
    patch-schema.ts
    agent-output-parser.ts
  tools\
    ai-tool-context.ts
    read-current-document-context.tool.ts
    search-accessible-documents.tool.ts
    read-selected-blocks.tool.ts
    memory-read.tool.ts
    memory-proposal.tool.ts
  memory\
    memory.types.ts
    memory.service.ts
```

第一版可以先不落地真实 `MemoryModule`，但保留 `memory` 子目录和接口类型，方便后续升级。

### 5.1 AiController

职责：

- 暴露前端调用的 AI endpoint。
- 解析 DTO。
- 注入当前用户身份。
- 调用 `AiService`。
- 返回结构化 patch / answer / memory proposal。

建议 endpoint：

```http
POST /ai/editor/selection
POST /ai/editor/chat
POST /ai/memory/confirm
```

第一版可以先实现前两个，`/ai/memory/confirm` 作为后续接口保留在设计中。

### 5.2 AiService

职责：

- 组装 agent context。
- 调用具体 agent service。
- 做统一错误处理、日志、模型配置读取。
- 未来可以加入 token 统计和审计日志。

### 5.3 EditorAgentService

职责：

- 使用 LangChainJS 创建 Agent。
- 注册第一版工具。
- 控制 system prompt。
- 要求模型输出结构化 patch response。
- 对模型输出做 schema 校验。

建议第一版每次请求按上下文创建 agent 或复用 agent factory，不要把用户态信息放在全局单例 agent 中，避免用户上下文串线。

### 5.4 Agent Tool Context

工具上下文由后端创建，不由模型提供：

```ts
interface AiToolContext {
  userId: string;
  docId?: string;
  workspaceId?: string;
  requestId: string;
  locale?: string;
}
```

LangChain tool 闭包中捕获该 context。

## 6. LangChainJS 工具链设计

### 6.1 工具暴露规则

每个工具必须满足：

1. 名称语义清晰。
2. description 明确工具边界。
3. schema 使用 Zod 严格定义。
4. 工具内部执行权限校验。
5. 返回内容经过裁剪，避免把整篇大文档无控制地塞回模型。
6. 写操作只返回 proposal，不直接写入。

### 6.2 第一版只读工具

#### read_current_document_context

用途：读取当前文档摘要、标题、局部内容和选区附近上下文。

输入：

```ts
{
  includeOutline?: boolean;
  maxChars?: number;
}
```

输出：

```ts
{
  docId: string;
  title: string;
  outline?: Array<{ level: number; text: string; blockId?: string }>;
  excerpt: string;
}
```

#### search_accessible_documents

用途：在用户有权访问的文档中检索相关内容。

输入：

```ts
{
  query: string;
  limit?: number;
}
```

输出：

```ts
{
  results: Array<{
    docId: string;
    title: string;
    snippet: string;
  }>;
}
```

#### read_selected_blocks

用途：根据前端传入的选区或 blockId 列表读取相关 block 内容。

输入：

```ts
{
  blockIds?: string[];
  maxChars?: number;
}
```

输出：

```ts
{
  blocks: Array<{
    blockId: string;
    type: string;
    plainText: string;
  }>;
}
```

### 6.3 第一版提议型工具

#### propose_memory

用途：让 Agent 提出可选长期记忆。

输入：

```ts
{
  scope: "user" | "workspace" | "document";
  type: "preference" | "fact" | "instruction" | "summary";
  content: string;
  reason: string;
}
```

输出：

```ts
{
  acceptedBySystem: true;
  requiresUserConfirmation: true;
}
```

注意：这个工具不写库，只把 proposal 收集到最终响应中。

## 7. Patch 响应协议

### 7.1 顶层响应

```ts
interface AiPatchResponse {
  kind: "patch_response";
  title: string;
  summary: string;
  patches: AiPatch[];
  memoryProposals?: MemoryProposal[];
  warnings?: string[];
}
```

### 7.2 Patch 类型

第一版只支持两类 patch，降低前端应用复杂度。

#### replace_selection

```ts
interface ReplaceSelectionPatch {
  type: "replace_selection";
  replacement: string;
}
```

用于润色、翻译、缩写、扩写、改写选区。

#### insert_after_selection

```ts
interface InsertAfterSelectionPatch {
  type: "insert_after_selection";
  content: string;
}
```

用于续写、补充解释、添加示例。

### 7.3 后续 Patch 类型预留

后续可以增加：

```ts
replace_block
insert_blocks_after
append_to_document
create_document_draft
```

但这些不进入第一版。

## 8. 前端接入设计

前端只新增 AI UI 和 patch 应用逻辑，不修改现有 sync engine。

建议新增：

```text
F:\yuediter\src\modules\ai\
  AiPanel.tsx
  AiActionMenu.tsx
  AiPatchPreview.tsx
  applyAiPatch.ts
  types.ts
```

如果希望更低侵入，也可以先放在现有 editor-kit 内部，但长期建议独立 `src/modules/ai`。

### 8.1 前端调用流程

```text
用户选中文本
  -> 点击 AI 动作
  -> 前端收集 selectionText / beforeText / afterText
  -> POST /ai/editor/selection
  -> 收到 AiPatchResponse
  -> 展示 diff preview
  -> 用户确认
  -> applyAiPatch 修改 Tiptap editor state
  -> 现有自动同步触发
```

### 8.2 前端不负责 Agent 编排

前端不运行 LangChainJS Agent，也不持有模型 API Key。前端只负责：

- 上下文采集
- 发起请求
- 展示流式或非流式结果
- 展示 patch diff
- 用户确认
- 应用 patch

### 8.3 Patch 应用

第一版 patch 简单对应编辑器选区：

- `replace_selection`：替换当前 selection。
- `insert_after_selection`：在当前 selection 后插入内容。

应用 patch 后，Tiptap transaction 会触发现有同步监听，sync engine 继续计算 `create/update/delete/move` 增量并调用 `/blocks/batch`。

## 9. 同步与冲突策略

### 9.1 当前文档编辑类操作

当前文档编辑类 AI 操作必须由前端应用 patch，不允许后端直接写库。因此同步仍由现有机制处理。

### 9.2 Patch 过期处理

后端响应 patch 时应带上前端请求中的 selection 信息。前端应用前需要检查：

1. 当前 selection 是否仍然有效。
2. 当前 selection text 是否与请求时一致，或是否可接受差异。
3. 如果不一致，提示用户重新生成。

建议第一版采用保守策略：选区文本变化则拒绝自动应用。

### 9.3 后端 Agent 未来直接修改

后台 Agent 功能后续可以直接写入，但必须满足：

1. 复用统一 mutation service 或 `BlocksService.batch()` 语义。
2. 标记 source 为 `agent`。
3. 产生 draft revision。
4. 通过轮询、SSE 或 WebSocket 通知前端。
5. 当前文档有本地 dirty 时，前端必须提示冲突或要求 reload。

该能力不进入第一版。

## 10. 全局记忆设计预留

### 10.1 记忆类型

```ts
type MemoryScope = "user" | "workspace" | "document";
type MemoryType = "preference" | "fact" | "instruction" | "summary";
```

建议长期数据结构：

```ts
interface MemoryRecord {
  id: string;
  userId: string;
  workspaceId?: string;
  docId?: string;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  source: "user" | "agent" | "system";
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### 10.2 第一版行为

第一版 Agent 可以返回 `memoryProposals`，但不会自动保存。

前端展示：

```text
AI 建议记住：用户偏好中文技术说明。
[记住] [忽略]
```

用户点击“记住”后，后续再调用保存接口。

### 10.3 后续升级

后续可以增加：

- `search_memory`
- `read_user_profile`
- `remember_preference`
- `forget_memory`
- workspace memory
- document summary memory
- vector search / pgvector

## 11. 模型配置

模型配置放后端环境变量或已有 settings 模块中。第一版建议支持：

```text
AI_PROVIDER=openai
AI_MODEL=gpt-4.1-mini 或其他可配置模型
AI_API_KEY=<server-only-secret>
AI_MAX_CONTEXT_CHARS=12000
AI_ENABLE_MEMORY_PROPOSAL=false
```

不要在前端暴露模型 API Key。

## 12. 错误处理

后端统一返回可展示错误：

```ts
interface AiErrorResponse {
  code:
    | "AI_MODEL_ERROR"
    | "AI_TOOL_ERROR"
    | "AI_CONTEXT_TOO_LARGE"
    | "AI_PERMISSION_DENIED"
    | "AI_INVALID_PATCH"
    | "AI_RATE_LIMITED";
  message: string;
  retryable: boolean;
}
```

前端处理策略：

- 模型错误：提示重试。
- 权限错误：提示无权限。
- patch 无效：提示重新生成。
- context too large：提示缩小选区或减少上下文。

## 13. 安全与权限

1. LangChain tools 内部不接受 `userId` 参数，统一使用后端认证上下文。
2. 工具读取文档前必须走现有权限校验。
3. 工具返回内容需要限制长度。
4. Agent 不允许执行任意代码、shell、HTTP 请求。
5. 写入类能力第一版全部改为 proposal。
6. 所有 AI 请求应记录 requestId、userId、docId、action、耗时、错误类型。
7. 日志不要记录完整敏感正文，必要时只记录长度、hash、摘要。

## 14. 测试计划

### 14.1 后端单元测试

覆盖：

1. DTO 校验。
2. patch schema 校验。
3. tool context 不允许覆盖 userId。
4. 无权限文档无法读取。
5. Agent 输出非法 patch 时返回 `AI_INVALID_PATCH`。
6. memory proposal 不会直接写入。

### 14.2 前端单元测试

覆盖：

1. `replace_selection` 正确替换。
2. `insert_after_selection` 正确插入。
3. selection text 已变化时拒绝应用。
4. 用户取消时不修改 editor state。
5. 应用 patch 后会产生普通编辑器 transaction。

### 14.3 集成测试

覆盖：

1. 选区润色完整流程。
2. AI 返回 patch，前端确认，自动同步产生 `/blocks/batch`。
3. 后端权限错误时前端提示。
4. 大上下文时后端裁剪或返回可理解错误。

## 15. 分阶段实施计划

### Phase 1：最小 Editor Agent

- 后端新增 `AiModule`。
- 接入 LangChainJS。
- 实现 `/ai/editor/selection`。
- 支持 `replace_selection` 和 `insert_after_selection`。
- 前端实现 AI 操作入口、预览、确认应用。
- 不做真实 memory 写入。

### Phase 2：当前文档问答与跨文档检索

- 实现 `/ai/editor/chat`。
- 增加只读 tools。
- 支持当前文档问答。
- 支持简单跨文档检索。

### Phase 3：全局记忆基础

- 新增 memory 数据表或实体。
- 支持 memory proposal。
- 前端支持“记住 / 忽略”。
- Agent 请求时注入用户已确认记忆。

### Phase 4：后台 Agent 与实时通知

- 引入后台任务。
- 后端 Agent 可在用户授权下直接写入。
- 复用统一 mutation / batch 语义。
- 增加 SSE 或 WebSocket 通知。
- 必要时引入 LangGraph.js。

## 16. 关键决策记录

1. Agent 运行在后端 NestJS。
2. Agent 框架使用 LangChainJS，便于学习和扩展。
3. 当前文档修改不由后端直接落库。
4. patch 必须返回前端预览。
5. 用户确认后前端应用 patch。
6. 内容修改后复用现有自动增量同步。
7. AI tools 是语义化 facade，不直接暴露现有 HTTP API。
8. 第一版尽量集中在 `ai` 模块中，低侵入接入。
9. 全局记忆只做 proposal 和架构预留，后续确认后再落库。

## 17. 待用户确认的问题

1. 第一版是否只做 `POST /ai/editor/selection`，还是同时做 `/ai/editor/chat`？
2. 第一版模型供应商是否默认 OpenAI，其他供应商后续扩展？
3. 前端 AI UI 是做侧边栏面板，还是先做选区浮动菜单？



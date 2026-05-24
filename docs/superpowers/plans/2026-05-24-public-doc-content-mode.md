# Public Doc 内容模式实现计划

> **给代理执行者的说明：** 推荐使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 按任务逐步执行。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 让 `mode=html` 成为公开阅读默认模式，同时保留 `mode=all` 作为富信息调试/兼容模式，并把前端公开文档详情页切换到 `mode=html`。

**架构：** 保持后端渲染链路和诊断链路不变，只在 `DocumentsService` 中做响应整形；前端只更新默认内容请求模式及对应源码契约测试。

**技术栈：** NestJS、Jest、Next.js App Router、Vitest、TypeScript

---

## 文件结构

- 修改 `back/server/src/modules/documents/documents.service.ts`
  - 为 `mode=html` 增加响应瘦身逻辑
- 修改 `back/server/src/modules/documents/documents.service.spec.ts`
  - 增加 `mode=html` 与 `mode=all` 差异回归测试
- 修改 `F:/yuediter/app/doc/[slug]/page.tsx`
  - 将公开内容请求切换为 `mode=html`
- 修改 `F:/yuediter/src/services/__tests__/doc-page-ssr-rendering.test.ts`
  - 更新源码契约断言

---

### 任务 1：锁定后端 `mode=html` 语义

**文件：**
- 修改：`back/server/src/modules/documents/documents.service.spec.ts`

- [ ] **步骤 1：补失败测试，验证 `mode=html` 删除已成功渲染块的 payload**

验证点：

- paragraph 块已存在 `html`
- `mode=html` 返回后该块不应再包含 `payload`

- [ ] **步骤 2：补失败测试，验证 `mode=html` 保留 codeBlock 的 JSON**

验证点：

- `codeBlock` 没有服务端 `html`
- `mode=html` 返回后仍保留 `payload`

- [ ] **步骤 3：补失败测试，验证 `mode=all` 仍保留已渲染块的 payload**

验证点：

- paragraph 块存在 `html`
- `mode=all` 返回后仍然保留 `payload`

- [ ] **步骤 4：运行后端聚焦测试，确认 RED**

运行：

```bash
pnpm --dir back/server test -- src/modules/documents/documents.service.spec.ts
```

预期：FAIL，新增的 `mode=html` 断言失败。

---

### 任务 2：实现后端轻量 `mode=html` 响应

**文件：**
- 修改：`back/server/src/modules/documents/documents.service.ts`

- [ ] **步骤 1：新增递归响应整形辅助函数**

要求：

- 递归遍历树
- 对已有 `html` 的块删除 `payload`
- 对没有 `html` 的块保留原状

- [ ] **步骤 2：在 `withOptionalRenderedHtml(...)` 中只对 `mode=html` 启用该函数**

要求：

- `mode=html`：先剥离内部元数据，再做 payload 瘦身
- `mode=all`：保持当前逻辑
- `mode=json`：保持当前逻辑

- [ ] **步骤 3：再次运行后端聚焦测试，确认 GREEN**

运行：

```bash
pnpm --dir back/server test -- src/modules/documents/documents.service.spec.ts
```

预期：PASS。

---

### 任务 3：切换前端公开详情页到 `mode=html`

**文件：**
- 修改：`F:/yuediter/app/doc/[slug]/page.tsx`
- 修改：`F:/yuediter/src/services/__tests__/doc-page-ssr-rendering.test.ts`

- [ ] **步骤 1：先修改前端源码契约测试**

将断言从：

```txt
/content?mode=all
```

改为：

```txt
/content?mode=html
```

- [ ] **步骤 2：运行前端聚焦测试，确认 RED**

运行：

```bash
pnpm --dir F:/yuediter vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts
```

预期：FAIL，因为页面代码还没切换。

- [ ] **步骤 3：修改公开详情页默认内容请求**

将：

```ts
const contentUrl = `${API_BASE}/documents/${docId}/content?mode=all`;
```

改成：

```ts
const contentUrl = `${API_BASE}/documents/${docId}/content?mode=html`;
```

- [ ] **步骤 4：再次运行前端聚焦测试，确认 GREEN**

运行：

```bash
pnpm --dir F:/yuediter vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts
```

预期：PASS。

---

### 任务 4：最终验证

**文件：**
- 无新增源码改动

- [ ] **步骤 1：运行后端 documents 相关测试**

```bash
pnpm --dir back/server test -- src/modules/documents/documents.controller.spec.ts src/modules/documents/documents.service.spec.ts src/modules/documents/services/document-render.service.spec.ts
```

预期：PASS。

- [ ] **步骤 2：运行前端公开文档相关测试**

```bash
pnpm --dir F:/yuediter vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts src/services/__tests__/public-doc-content-fetch.test.ts
```

预期：PASS。

- [ ] **步骤 3：运行后端构建**

```bash
pnpm --dir back/server build
```

预期：PASS。

- [ ] **步骤 4：运行前端构建**

```bash
pnpm --dir F:/yuediter build
```

预期：PASS。

- [ ] **步骤 5：手工验证接口语义**

请求：

```bash
curl "http://localhost:5200/api/v1/documents/<docId>/content?mode=html"
curl "http://localhost:5200/api/v1/documents/<docId>/content?mode=all"
```

预期：

- `mode=html`：已渲染块有 `html`，但没有 `payload`
- `mode=html`：`codeBlock` 仍保留 JSON
- `mode=all`：已渲染块同时保留 `html + payload`

---

## 自检

### 规格覆盖

- `mode=html` 轻量响应：任务 1 + 任务 2
- `mode=all` 保持富信息：任务 1 + 任务 2
- 前端公开详情页切换到 `mode=html`：任务 3
- 前后端验证：任务 4

### 占位符检查

- 所有任务都给出了明确的文件、命令和验证目标
- 没有遗留 TBD / TODO / “后续补充” 一类占位描述

### 一致性检查

- 渲染职责仍由 `DocumentRenderService` 负责
- 响应整形职责放在 `DocumentsService`
- 前端默认请求模式与设计文档保持一致

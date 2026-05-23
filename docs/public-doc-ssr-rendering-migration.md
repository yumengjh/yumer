# 公开文档页 SSR 渲染链改造记录

## 1. 背景

当前项目的公开文档展示页位于：

- `F:\yuediter\app\doc\[slug]\page.tsx`

它需要满足两个目标：

1. **保留 SSR**：公开页需要在服务端输出可直接展示的 HTML，便于 SEO、首屏速度和无编辑器阅读场景。
2. **兼容 serverless 环境**：尤其是 Vercel 这类函数环境，不能依赖容易在运行时出问题的浏览器 / 虚拟 DOM 链路。

项目此前在自有云服务器环境中运行正常，但部署到 Vercel 后，公开页访问出现 500，错误链路稳定落在：

- `isomorphic-dompurify`
- `jsdom`
- `html-encoding-sniffer`
- `@exodus/bytes`
- `ERR_REQUIRE_ESM`

而编辑器页面没有问题。

---

## 2. 为什么编辑器正常，公开页异常

这是本次分析里最重要的前置结论。

### 2.1 编辑器页并不走 SSR

编辑器入口页面：

- `F:\yuediter\app\dash\page.tsx`
- `F:\yuediter\app\dash\edit\[slug]\page.tsx`

使用的是：

```tsx
const EditorPage = dynamic(() => import("@/components/EditorPage"), {
  ssr: false,
})
```

也就是说编辑器本质是 **纯客户端渲染**：

- 浏览器真实 DOM 可用
- `useEditor`、`@tiptap/react`、浏览器侧扩展都能正常执行
- 就算内部有较重的富文本逻辑，也不会进入 Vercel SSR 运行时

### 2.2 公开页是真正的 SSR

公开页此前流程是：

1. 请求后端 `/documents/:docId/content`
2. 得到 block tree / Tiptap JSON
3. 前端 Next.js 服务端组件内：
   - `renderBlockTreeToHtml(...)`
   - `highlightCodeBlocks(...)`
   - `DOMPurify.sanitize(...)`
4. 最终输出 `dangerouslySetInnerHTML`

这条链在服务端执行，因此一旦其中某个库需要：

- DOM
- 虚拟 DOM
- `jsdom`

就会进入 serverless 兼容性风险区。

---

## 3. 旧方案的具体问题

### 3.1 服务端 HTML 生成使用了浏览器导向实现

文件：

- `F:\yuediter\src\services\generate-block-html.ts`

旧实现使用：

- `@tiptap/core` 的 `generateHTML`
- 手动注入 `jsdom`

问题：

1. `@tiptap/core` 的 `generateHTML` 更适合浏览器环境
2. 手动 `require("jsdom")` 会把公开页 SSR 依赖链带到 `jsdom`
3. 在 Vercel 生产函数里，`jsdom` 相关依赖可能因为 ESM/CJS、运行时裁剪、打包策略而失败

### 3.2 HTML 清洗使用了 `isomorphic-dompurify`

文件：

- `F:\yuediter\app\doc\[slug]\page.tsx`

旧实现使用：

- `isomorphic-dompurify`

该库服务端分支会依赖：

- `jsdom`

这进一步把 SSR 运行时带进了不稳定依赖链。

### 3.3 问题并不是“JSON 不能在 serverless 环境渲染”

真正的问题是：

> **旧渲染实现走的是 `jsdom` 路线，而不是 Tiptap 官方更适合服务端 / 静态渲染的路线。**

---

## 4. 本次讨论过的几种方案

这次并不是直接拍板某一个方案，而是对多个方案逐个讨论、权衡后才确定当前改造。

---

## 4.1 方案 A：继续让前端 SSR 现算 HTML（旧方案）

### 描述

前端公开页拿到 JSON/tree 后，在 Next.js SSR 中自行：

- JSON → HTML
- 代码高亮
- sanitize

### 优点

1. 架构上“内容接口”和“展示逻辑”分离
2. 后端无需了解 HTML 渲染细节

### 缺点

1. 在 serverless 环境中容易踩到 `jsdom` / `DOMPurify` 依赖链问题
2. 每次 SSR 都会重复渲染
3. 前端函数体承担富文本渲染成本
4. 运行时依赖复杂，错误更难追踪

### 结论

**旧方案在传统服务器上可工作，但在 Vercel / serverless 中风险较高。**

---

## 4.2 方案 B：发布时存整篇 HTML

### 描述

点击发布时，把整篇文档 tree 渲染成最终 HTML，存数据库一个字段，公开页直接读取。

### 优点

1. 公开页最简单
2. SSR 成本最低
3. 不需要每次请求现算

### 缺点

1. 和现有 `startBlockId + limit + maxDepth` 的分片/懒加载模型不兼容
2. 不适合超大文档按段加载
3. 整篇缓存一旦过期就需要全量重算

### 结论

**适合纯博客类全文展示，不适合当前项目已有的块树懒加载架构。**

---

## 4.3 方案 C：发布时按块缓存 HTML

### 描述

在保存或发布保存时，把某些块渲染成 HTML 存到块旁字段，公开页按块取 HTML。

### 优点

1. 保留懒加载能力
2. 可与 block/version 架构对齐
3. 后续可做按需渐进缓存

### 缺点

1. 设计复杂度高
2. 需要定义哪些块适合服务端渲染缓存，哪些不适合
3. 容器型块（list/table/blockquote）与原子块边界要谨慎设计
4. 需要额外维护缓存缺失、缓存失效、渲染状态

### 结论

**这是一个可行的中长期方案，但不是当前“先解决 SSR 兼容问题”的最小实现。**

---

## 4.4 方案 D：后端 `/content` 接口直接内联返回 HTML

### 描述

增强：

- `/api/v1/documents/:docId/content`

在后端 tree 构建完成后，顺手把当前片段渲染成 HTML 一并返回。

### 优点

1. 能保留懒加载
2. 前端 SSR 只消费 HTML
3. 不必落库缓存
4. 更适合目前“后端是传统服务器”的现实环境

### 缺点

1. 如果未来后端也迁到 serverless，仍然需要确保后端渲染链本身不依赖 `jsdom`
2. 相同片段可能重复渲染
3. 内容接口职责会变重

### 结论

**这是最务实的后续演进方案之一。**

本次没有立刻实现它，但在设计讨论中被记录下来，未来如果决定把渲染责任移到后端，可以沿这个方向推进。

---

## 4.5 方案 E：继续前端 SSR，但改成 Tiptap 官方服务端渲染路线（本次采用）

### 描述

不改动后端接口，不改数据库结构，只把前端公开页的：

- HTML 生成方式
- sanitize 方式

切换到 **不依赖 `jsdom` 运行时链** 的实现。

### 结论

这是本次最终采用的方案，因为它：

1. 保留 SSR
2. 改动面最小
3. 不动后端
4. 能最快验证 Vercel / serverless 兼容性

---

## 5. Tiptap 官方渲染路线对比

本次讨论里重点对比了两个官方路线：

- `@tiptap/html`
- `@tiptap/static-renderer`

---

## 5.1 `@tiptap/html`

官方定位：

- 服务端或浏览器均可使用的 `generateHTML`

优点：

1. 官方支持
2. 接口接近原有 `generateHTML`
3. 改造成本较低

缺点：

1. 本质上仍是“HTML utility”路线
2. 实现层面会借助虚拟 DOM
3. 相比 static renderer，不是最纯粹的“无 DOM / 无 editor instance”静态映射方案

适合：

- 需要尽量贴近原 `generateHTML` 用法
- 服务端环境可接受它的运行时依赖

---

## 5.2 `@tiptap/static-renderer`

官方定位：

- 纯静态渲染工具
- 不需要 editor instance
- 不需要浏览器 DOM
- 可以直接把 JSON / ProseMirror 内容渲染成 HTML 字符串

优点：

1. 更适合 SSR / serverless
2. 不需要手动引入 `jsdom`
3. 更符合“静态内容输出”场景
4. 对公开页阅读型页面更自然

缺点：

1. 对项目现有自定义扩展的 `renderHTML` 一致性要自行验证
2. 如果扩展设计不规范，可能暴露出渲染差异

适合：

- 当前项目的公开文档页
- 未来可能迁到 serverless 的渲染链

### 最终选择

本次改造选择：

- `@tiptap/static-renderer/pm/html-string`

原因：

> 它更符合“公开页静态 HTML 输出”的场景，也更适合作为未来 serverless 兼容方向的基础。

---

## 6. 本次最终实现

---

## 6.1 改造目标

1. 保留公开页 SSR
2. 不改动后端接口
3. 尽量保持现有渲染效果
4. 从公开页服务端产物中彻底移除：
   - `jsdom`
   - `isomorphic-dompurify`
   - `html-encoding-sniffer`
   - `@exodus/bytes`

---

## 6.2 文件改动

### 6.2.1 `F:\yuediter\src\services\generate-block-html.ts`

#### 旧实现

- `import { generateHTML } from "@tiptap/core"`
- 手写 `ensureJsdom()`
- `require("jsdom")`

#### 新实现

- `import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string"`
- 删除整个 `ensureJsdom()` 链路
- 保留：
  - block tree flatten
  - legacy `payload.html` 兼容
  - 基于 `serializationExtensions` 的渲染方式

#### 设计含义

这一步把“JSON → HTML”从：

- 浏览器 / 虚拟 DOM 导向实现

切到了：

- Tiptap 官方静态渲染实现

---

### 6.2.2 `F:\yuediter\app\doc\[slug]\page.tsx`

#### 旧实现

- `import DOMPurify from "isomorphic-dompurify"`

使用：

```ts
const html = DOMPurify.sanitize(highlighted, {
  ADD_TAGS: ["code", "pre", "span"],
  ADD_ATTR: ["class", "data-language", "data-block-id", "style"],
})
```

#### 新实现

- 改为 `sanitize-html`

并显式配置允许：

- `img`
- `span`
- `pre`
- `code`
- `table`
- `thead`
- `tbody`
- `tr`
- `th`
- `td`

以及允许属性：

- `class`
- `style`
- `data-*`
- `blockId`
- `clientId`
- 表格单元格 `colspan/rowspan`
- 链接与图片常见属性

#### 设计含义

保留“服务端清洗 HTML”的安全边界，但不再依赖 `jsdom`。

---

### 6.2.3 依赖变更

`F:\yuediter\package.json`

新增：

- `@tiptap/static-renderer`
- `sanitize-html`
- `@types/sanitize-html`

移除：

- `isomorphic-dompurify`

---

### 6.2.4 新增回归测试

文件：

- `F:\yuediter\src\services\__tests__\doc-page-ssr-rendering.test.ts`

测试覆盖：

1. 公开页服务端页面不再直接引入 `isomorphic-dompurify`
2. `renderBlockTreeToHtml()` 对以下结构仍能输出可用 HTML：
   - `paragraph`
   - `bulletList`
   - `highlightBlock`

---

## 7. 为什么说“尽量保持原渲染效果”

这次不是“重写公开页渲染”，而是“替换底层渲染链”。

为了尽量保持效果一致，保留了以下既有设计：

1. 仍然复用 `serializationExtensions`
2. 仍然复用 `highlightCodeBlocks(...)`
3. 仍然保留 `editor.css`
4. 仍然以 block payload 为输入，不改内容模型

因此公开页的：

- 段落
- 标题
- 列表
- 表格
- 高亮块
- 文字样式

理论上都应尽量与原先一致。

### 已知一点

测试中会看到 Tiptap 警告：

- `Duplicate extension names found: ['link', 'underline']`

这是原本 `serializationExtensions` 中就存在的历史问题，并不是本次替换引入的错误。

它目前不会阻塞：

- 测试
- 构建
- 公开页 SSR

后续可以单独再做一次清理。

---

## 8. 验证过程

本次改造不是只改代码，没有验证。

### 8.1 单测验证

执行：

```bash
pnpm vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts
```

结果：

- 2 个测试全部通过

### 8.2 构建验证

执行：

```bash
pnpm build
```

结果：

- 构建通过

### 8.3 服务端产物依赖验证

检查：

- `.next/server/app/doc/[slug]/page.js.nft.json`

确认其中不再包含：

- `jsdom`
- `isomorphic-dompurify`
- `html-encoding-sniffer`
- `@exodus/bytes`

这意味着导致 Vercel 500 的关键依赖链已被切断。

---

## 9. 当前方案的优点

1. **不动后端**
2. **保留 SSR**
3. **不引入数据库缓存复杂度**
4. **尽量保持原渲染效果**
5. **向未来 serverless 兼容方向靠拢**

---

## 10. 当前方案的局限

1. 公开页仍然是“请求时前端 SSR 现算 HTML”
2. 同一文档重复请求时仍会重复渲染
3. 代码高亮仍在这条链里，理论上仍有服务端 CPU 成本
4. 没有利用现有后端 `/content` 的分片 HTML 输出能力

也因此，未来仍然存在进一步演进空间。

---

## 11. 后续可选演进方向

### 11.1 后端 `/content` 内联返回 HTML

思路：

- 在后端内容接口返回 tree 之后，顺手生成当前片段 html
- Next.js SSR 只消费结果

优点：

- 前端 SSR 更轻
- 更适合后端已有分片/懒加载能力

### 11.2 发布态缓存 HTML

方向包括：

- 全文 HTML 缓存
- 块级 HTML 缓存
- 片段级 HTML 缓存

其中块级/片段级更贴近现有 block tree 架构，但复杂度也更高。

### 11.3 代码块进一步客户端化

如果后续需要进一步降低 SSR CPU 成本，可考虑：

- 服务端只输出基础 `<pre><code>`
- 客户端再做高亮增强

---

## 12. 本次结论

本次改造的最终结论是：

> 在不动后端的前提下，把公开页前端 SSR 渲染链切到 **Tiptap 官方静态渲染路线 + server-safe 的 HTML sanitize**，是当前阶段成本最低、收益最高的修复方式。

它既解决了：

- `jsdom` 运行时依赖问题
- Vercel / serverless SSR 风险

又保留了：

- 公开页 SSR
- 当前 UI / 样式体系
- 当前内容模型

这是一条适合当前阶段的“最小但正确”的演进路径。


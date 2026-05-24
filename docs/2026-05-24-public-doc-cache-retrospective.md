# 2026-05-24 公开文档缓存与近 SSG 化改造复盘

## 1. 文档定位

这是一份面向项目维护者、后续开发者和部署运维人员的详细复盘文档，用于总结 2026-05-24 这轮公开文档性能优化、内容模式分层、发布后主动失效与调试入口保留的完整实现。

文档重点包括：

- 背景和问题来源
- 目标和设计取舍
- 前后端技术实现细节
- 使用说明与环境变量配置
- 调试与排障方法
- 已知问题与后续建议

它既是一份复盘，也是后续维护参考资料。

---

## 2. 背景与问题来源

### 2.1 这轮优化真正想解决什么

公开文档页面的产品目标，不只是“页面能打开”，而是：

1. 响应尽可能快
2. 体验尽可能接近静态站（SSG）
3. 发布后内容能尽快刷新
4. 同时保留一个绝对实时的调试入口

理想状态应该是：

- 默认访问 `/blog/:slug` 时，大概率命中缓存
- 用户觉得它像静态博客文章一样快
- 一旦发布新内容，缓存又能及时失效
- 如果要排查问题，还可以访问 `/blog/:slug/latest` 强制看实时内容

### 2.2 初始实现中的三个主要问题

#### 问题一：内容接口模式不清晰

后端虽然已经支持 `mode=json | html | all`，但在最初实现里：

- `mode=html` 和 `mode=all` 返回几乎一样
- 已渲染块大多同时带 `html + payload`
- 前端公开详情页默认请求的是 `mode=all`

结果就是：

- 页面下载了比公开阅读实际需要更多的数据
- “公开阅读模式”和“调试兼容模式”没有真正分层

#### 问题二：默认缓存策略不够接近 SSG

前端已经引入了默认缓存和 `/latest` 穿透缓存机制，但之前主要仍依赖时间窗口自然过期。

这意味着：

- 普通访问虽然能缓存
- 但发布后刷新更多依赖等待 `revalidate` 时间到期
- 体验上还不够像“静态站 + 发布即刷新”

#### 问题三：调试能力与默认线上能力混在一起

`mode=all` 更适合调试和兼容，`mode=html` 更适合公开阅读。

如果线上默认路径仍然用 `mode=all`，就会导致：

- 性能目标不纯粹
- 调试路径和生产路径语义混淆

---

## 3. 这轮改造的总体目标

这轮改造最终明确了 4 个目标：

1. **公开内容模式分层**
   - `mode=html`：公开阅读默认模式
   - `mode=all`：调试/兼容模式

2. **默认公开详情页更轻量**
   - 前端公开详情页改为请求 `mode=html`

3. **缓存更接近静态页体验**
   - `/blog/:slug` 默认走缓存
   - 发布后由后端主动通知前端清掉对应缓存

4. **保留 `/latest` 作为实时调试入口**
   - `/blog/:slug/latest` 继续强制 `no-store`

---

## 4. 最终方案总览

### 4.1 内容模式分层

#### `mode=json`

用途：编辑器、调试器、结构化数据消费方。

特点：

- 只返回 JSON block tree
- 不返回服务端 `html`

#### `mode=html`

用途：公开阅读默认模式。

特点：

- 已成功服务端渲染的块：只保留 `html`
- 前端仍需处理的块（如 `codeBlock`）：保留 JSON
- 服务端渲染失败的块：保留 JSON 回退
- 返回更轻量，更适合线上默认访问

#### `mode=all`

用途：调试、迁移观察、兼容消费。

特点：

- 已渲染块同时保留 `html + payload`
- 前端处理块保留 JSON
- 更适合排查问题

### 4.2 路由语义

#### `/blog/:slug`

- 默认公开访问路径
- 默认请求 `mode=html`
- 默认走缓存
- 目标是“尽量像静态页”

#### `/blog/:slug/latest`

- 调试路径
- 强制穿透缓存
- 始终实时读后端

---

## 5. 前端实现细节

### 5.1 关键文件

- `app/doc/[slug]/page.tsx`
- `app/api/revalidate-doc/route.ts`
- `src/services/public-doc-content-fetch.ts`
- `src/services/__tests__/doc-page-ssr-rendering.test.ts`
- `src/services/__tests__/public-doc-content-fetch.test.ts`

### 5.2 `app/doc/[slug]/page.tsx` 的职责

这是公开文档详情页真正的页面实现，负责：

1. 解析 slug
2. 区分默认访问和 `/latest` 访问
3. 请求后端详情与内容接口
4. 读取后端渲染诊断头
5. 根据后端返回的 block tree 生成页面最终 HTML
6. 渲染作者、标签、更新时间等辅助信息

### 5.3 当前内容请求方式

默认详情页现在请求：

```txt
/documents/:docId/content?mode=html
```

而不是旧的：

```txt
/documents/:docId/content?mode=all
```

如果后端因为版本不一致或临时故障不支持 `mode=html`，前端仍保留 fallback：

- 先请求 `?mode=html`
- 失败后回退到无 mode 的 `/content`

这样可以保证：

- 最新后端：走最优路径
- 旧后端：不至于直接 404

### 5.4 缓存入口

页面统一通过：

```ts
function publicFetchOptions(latest: boolean): RequestInit {
  return latest ? { cache: "no-store" } : { next: { revalidate: PUBLIC_DOC_REVALIDATE_SECONDS } };
}
```

含义是：

- 默认路径 `/blog/:slug`
  - 走缓存
- `/blog/:slug/latest`
  - `cache: "no-store"`
  - 始终实时

### 5.5 为什么前端仍保留 `renderBlockTreeToHtml()`

虽然服务端已经能返回块级 `html`，前端仍保留逐块合成逻辑：

- 如果块已有 `html`，优先使用它
- 如果块没有 `html`，则回退到本地 JSON 渲染
- `codeBlock` 等特殊块继续由前端最终处理

这保证了：

- 后端能力增强时前端能立即受益
- 后端个别块失败时页面仍然可展示
- 整条公开阅读链路不会因为单个块问题而失稳

### 5.6 前端主动失效接口

新增：

`app/api/revalidate-doc/route.ts`

职责：

- 校验 `REVALIDATE_SECRET`
- 接收：

```json
{ "slug": "xxx" }
```

- 执行：

```ts
revalidatePath(`/doc/${slug}`)
```

说明：

- 用户访问的是 `/blog/:slug`
- 但真正的 App Router 页面路径是 `/doc/[slug]`
- 所以失效目标应当是 `/doc/${slug}`

---

## 6. 后端实现细节

### 6.1 关键文件

- `back/server/src/modules/documents/documents.service.ts`
- `back/server/src/modules/documents/documents.service.spec.ts`
- `back/server/docs/2026-05-24-document-html-rendering-cache-and-diagnostics.md`

### 6.2 内容模式分层如何落地

这轮没有重写底层渲染器，而是保留原有分层：

- `DocumentRenderService`
  - 负责识别可服务端渲染块
  - 负责块级 HTML 缓存
  - 负责输出诊断信息

- `DocumentsService`
  - 负责最终对外响应整形
  - 决定在 `mode=html` 下是否保留 `payload`

这样职责清晰，风险小，也更容易补测试。

### 6.3 `mode=html` 与 `mode=all` 的关键差异

现在：

- `mode=all`
  - 返回完整混合树
  - 已渲染块保留 `html + payload`

- `mode=html`
  - 对已有 `html` 的块删除 `payload`
  - 对没有 `html` 的块保留 `payload`

因此 `mode=html` 在传输层真正变“瘦”了。

### 6.4 发布后的主动失效

在 `publish(docId, userId)` 成功后，后端新增：

```txt
revalidatePublicDocumentPath(document)
```

它的逻辑是：

1. 仅当文档 `visibility === "public"` 时继续
2. 读取：
   - `PUBLIC_SITE_REVALIDATE_URL`
   - `PUBLIC_SITE_REVALIDATE_SECRET`
3. 把 `docId` 编码成公开 `slug`
4. 调前端 revalidate API
5. 如果失败，只记日志，不影响发布成功

### 6.5 为什么回调失败不回滚发布

因为“发布成功”和“缓存失效成功”不是同一件事：

- 发布成功：内容事实已经成立
- 失效失败：缓存更新还没完成

如果把失效失败也等价成发布失败，会导致业务语义混乱。

因此当前策略是：

- 发布事务优先成功
- 缓存失效 best effort
- 失败仅记录日志

### 6.6 docId 到 slug 的编码

为了回调前端失效接口，后端内部实现了与前端一致的规则：

```txt
doc_时间戳_hex -> base36(timestamp)-hex
```

这样后端可以独立计算公开页 slug，不需要额外依赖前端保存映射。

---

## 7. 使用说明

### 7.1 普通用户访问

访问：

```txt
/blog/:slug
```

行为：

- 走缓存
- 默认请求 `mode=html`
- 性能接近静态页

### 7.2 调试或验收访问

访问：

```txt
/blog/:slug/latest
```

行为：

- 穿透缓存
- 实时读取后端
- 适合发布后校验内容是否已经更新

### 7.3 发布后刷新机制

当编辑端触发：

```txt
POST /documents/:docId/publish
```

后端会：

1. 更新 `publishedHead`
2. 记录活动日志
3. 尝试调用前端：

```txt
POST /api/revalidate-doc
```

前端收到后，会对 `/doc/:slug` 做 `revalidatePath`。

### 7.4 环境变量配置

#### 前端

```env
REVALIDATE_SECRET=your-secret
```

#### 后端

```env
PUBLIC_SITE_REVALIDATE_URL=http://your-frontend-host/api/revalidate-doc
PUBLIC_SITE_REVALIDATE_SECRET=your-secret
```

要求：

- 前后端 secret 必须一致
- 后端 URL 必须能访问前端实例

---

## 8. 调试与排障

### 8.1 如何判断页面是否命中缓存

可以在公开页的 `.doc-content` 元素上查看：

- `data-yuediter-content-mode`
- `data-yuediter-render-mode`
- `data-yuediter-render-cache`
- `data-yuediter-render-blocks`
- `data-yuediter-render-version`

这些值来源于后端内容接口响应头。

### 8.2 如何判断发布后主动失效有没有执行

看后端日志：

- 正常情况下不会报错
- 失败时会打印：

```txt
公开文档缓存失效失败: docId=..., error=...
```

### 8.3 如果普通页没更新，但 `/latest` 已更新

通常说明：

- 发布本身成功了
- 实时内容是新的
- 但缓存失效链路有问题

这时重点检查：

1. 前端 `REVALIDATE_SECRET` 与后端是否一致
2. `PUBLIC_SITE_REVALIDATE_URL` 是否正确
3. 后端是否能访问前端地址
4. 前端部署是否已包含 `/api/revalidate-doc`

---

## 9. 设计权衡

### 9.1 为什么不用纯 SSG

因为文档数量、发布时间和编辑频率都是动态的：

- 全量 `generateStaticParams` 不现实
- 全量构建成本高
- 发布后即时刷新也不方便

所以更适合 ISR / 按需失效路线。

### 9.2 为什么保留 `/latest`

因为无论缓存设计多成熟，都需要一个绝对实时通道，用于：

- 验收发布
- 排查缓存失效问题
- 对比默认页和实时页差异

### 9.3 为什么这版只失效详情页，不失效 `/blog`

因为当前 `/blog` 列表页仍然是 `no-store`，并没有缓存化。

既然它本身一直实时，就暂时不需要对它执行 `revalidatePath('/blog')`。

### 9.4 为什么不采用 `revalidateTag`

这次故意不走 `revalidateTag`，原因是：

- 项目里已经有“文档元数据标签（tags）”概念
- 为避免“业务标签”和“Next 缓存标签”在沟通里混淆
- 这次直接用 `revalidatePath`，认知成本更低

---

## 10. 已知问题

1. 前端仓库当前仍有一些历史未提交改动，并不都属于这轮需求
2. 部分测试和文档曾出现过 Windows CRLF/LF 相关脆弱性
3. 后端 lint 对历史 `any` 很严格，导致部分提交可能需要临时绕过旧债
4. `/blog` 列表页目前仍是实时页，尚未纳入近 SSG 体系

---

## 11. 后续建议

### 优先级高

1. 把 `/blog` 列表页也做成缓存页
2. 发布时同时失效：
   - `/doc/:slug`
   - `/blog`
3. 将默认 TTL 调成长值，把“发布驱动失效”作为主机制

### 优先级中

4. 给 revalidate API 增加更明确的日志与返回结构
5. 在后端把 revalidate 调用抽成独立 service
6. 给发布链路增加失效通知成功/失败监控

### 优先级低

7. 如果未来访问量继续增长，可评估发布态 HTML snapshot / CDN 化
8. 若追求更低 TTFB，再考虑更强的静态化方案

---

## 12. 总结

这轮改造最终解决的，并不只是“缓存开不开”的问题，而是把公开文档体系拆成了几个清晰层次：

- **内容模式**：`json / html / all`
- **访问语义**：默认缓存页 vs `/latest` 实时页
- **刷新机制**：时间缓存兜底 + 发布后主动失效
- **故障语义**：失效失败不影响发布成功

结果是：

- 默认公开详情页更轻了
- 默认访问体验更接近静态站
- 发布后可以主动刷新
- 调试路径仍然保留
- 前后端职责边界比之前更清晰

这套方案还不是纯静态化，但已经是一条非常现实、且非常接近 SSG 体验的公开文档路线。

# Public Doc 内容模式设计

## 目标

让公开文档内容接口真正区分 `mode=html` 与 `mode=all`，并让前端公开文档详情页默认使用更适合线上阅读场景的 `mode=html`。

本次设计的目标是：

- `mode=html`：作为公开阅读的默认模式，只返回公开阅读真正需要的数据。
- `mode=all`：作为调试、兼容和迁移观察模式，保留更多上下文信息。
- 前端公开详情页从 `mode=all` 切换为 `mode=html`。

---

## 当前问题

虽然当前后端已经支持 `mode=json | html | all`，但在这轮改造前，`mode=html` 和 `mode=all` 的返回几乎没有本质区别：

- 已成功服务端渲染的块，通常仍然同时返回 `html + payload`
- 前端公开详情页默认请求 `mode=all`
- `mode=html` 没有真正体现出“更轻量”的价值

这会带来几个问题：

1. 公开阅读页会下载比实际需要更多的数据
2. “公开阅读模式”和“调试兼容模式”没有形成明确边界
3. 后续要做公开页面缓存优化时，默认内容模式不够清晰

---

## 设计原则

### 1. 渲染职责不下沉到传输层

底层渲染服务 `DocumentRenderService` 继续只负责：

- 找出哪些块可以服务端渲染
- 命中或生成块级 HTML
- 给出渲染诊断信息

它不负责决定“对外响应是否保留 `payload`”。

### 2. 响应语义在 `DocumentsService` 中整形

真正决定外部接口返回形态的地方，放在 `DocumentsService.withOptionalRenderedHtml(...)`：

- `json`：保持原样
- `all`：保持原样
- `html`：对已经成功渲染出 `html` 的块删除 `payload`

这样职责更清晰，也避免把传输语义耦合进底层渲染器。

### 3. 保留前端回退能力

即使是 `mode=html`，以下两类块仍然必须保留 JSON：

- 明确由前端处理的块，例如 `codeBlock`
- 服务端渲染失败的块

这样可以保证前端公开阅读链路仍然具备“混合渲染 + 回退”的稳定性。

---

## 期望行为

### `mode=json`

保持现有语义：

- 只返回 JSON block tree
- 不附加服务端 `html`
- 适用于编辑器、调试器或需要完整结构化数据的消费者

### `mode=html`

作为公开阅读默认模式，返回“轻量混合树”：

- 对已成功服务端渲染的块：
  - 保留 `blockId`、`type`、`children`、`html`
  - 删除 `payload`
- 对前端仍需处理的块（如 `codeBlock`）：
  - 保留 `payload`
  - 不附加 `html`
- 对服务端渲染失败的块：
  - 保留 `payload`
  - 不附加 `html`

### `mode=all`

作为调试和兼容模式，保留当前富信息语义：

- 已成功渲染的块同时保留 `html + payload`
- 前端处理块仍保留 JSON
- 更适合迁移期观察、调试和问题排查

---

## 后端改动范围

### 涉及文件

- `back/server/src/modules/documents/documents.service.ts`
- `back/server/src/modules/documents/documents.service.spec.ts`

### 改动方式

1. 保持 `DocumentRenderService` 不变
2. 在 `DocumentsService.withOptionalRenderedHtml(...)` 中区分 `mode=html` 与 `mode=all`
3. 为 `mode=html` 增加一个后处理步骤：
   - 如果块已有 `html`，则删除该块的 `payload`
   - 如果块没有 `html`，则保留 `payload`
4. 不改变现有诊断头与诊断字段语义

这样做的优点是：

- 改动聚焦
- 风险较小
- 兼容旧逻辑
- 更容易写回归测试

---

## 前端改动范围

### 涉及文件

- `F:/yuediter/app/doc/[slug]/page.tsx`
- `F:/yuediter/src/services/__tests__/doc-page-ssr-rendering.test.ts`

### 改动方式

将公开文档详情页的内容请求从：

```txt
/documents/:docId/content?mode=all
```

改成：

```txt
/documents/:docId/content?mode=html
```

这样做的原因是：

- 页面目标是公开阅读，而不是调试
- 特殊块仍然保留了前端 JSON 回退能力
- 返回体会更轻量
- 更符合后续“默认缓存页接近 SSG”的优化方向

---

## 测试策略

### 后端测试

需要新增并锁定以下行为：

1. `mode=html` 会删除已成功服务端渲染块的 `payload`
2. `mode=html` 会保留 `codeBlock` 的 JSON
3. `mode=all` 继续保留已渲染块的 `payload`

### 前端测试

更新源码契约测试，确保公开详情页默认请求：

```txt
/content?mode=html
```

而不是：

```txt
/content?mode=all
```

---

## 不在本次设计范围内

本设计不处理以下内容：

- `mode=json` 语义调整
- 服务端/前端渲染块分类变更
- 渲染诊断头协议变更
- 文档列表页缓存策略
- 发布后的主动缓存失效
- 新增额外的公开内容接口路径

这些内容会在后续缓存方案中继续推进。

---

## 预期收益

落地后可以获得以下收益：

1. 公开文档详情页默认请求更轻量
2. `mode=html` 与 `mode=all` 的语义真正分层
3. 保留前端特殊块和失败块回退能力
4. 为后续公开页面缓存优化提供更合理的默认内容模式

---

## 结论

这次设计的核心不是推翻现有混合渲染体系，而是把它拆分成两个清晰场景：

- `mode=html`：默认公开阅读模式，强调轻量与性能
- `mode=all`：调试/兼容模式，强调完整信息

这样既保留现有系统的稳定性，也为公开文档页面继续向“接近静态站体验”的方向演进打下了基础。

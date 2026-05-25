# 编辑器图片功能设计

日期：2026-05-25

## 目标

为当前编辑器前端接入一等公民级别的图片能力，并在后端 `E:\workspace\yuweb\back\server` 新增图片上传模块。

首版需要支持：

- 在编辑器中粘贴图片文件。
- 通过编辑器工具栏按钮上传图片。
- 将图片元数据和展示参数保存到 Tiptap JSON。
- 选中或聚焦图片后编辑非破坏式展示参数。
- 通过图片四周辅助线和控制点调整图片大小。
- 使用成熟图片预览库查看图片。
- 为私有编辑态和公开发布文档提供图片读取能力。

首版不生成裁剪或旋转后的派生图片文件。旋转、裁剪、链接、对齐、描述、宽高等参数全部保存为图片节点属性。

## 当前上下文

前端是 Next.js 应用，编辑器基于 Tiptap 和 Ant Design。编辑器代码主要位于 `src/components/markdown-editor`，工具栏位于 `src/components/markdown-editor/Toolbar`，Tiptap 序列化扩展位于 `src/services/tiptap-extensions.ts`。

后端是 NestJS 应用，按 `src/modules` 做模块划分。当前已有 `assets` 模块，可以通过 `Asset` 实体和本地上传目录保存通用文件。但该模块允许所有文件类型，语义偏通用资产，因此图片能力应该新增独立 `images` 模块，对外提供图片专用接口，同时在内部复用已有存储约定。

## 推荐方案

使用专用 Tiptap 块节点 `imageBlock`，后端新增 `images` 模块。

`imageBlock` 让编辑器可以稳定控制图片选中态、缩放控制点、hover 工具条、裁剪展示、链接包裹和预览联动。`images` 模块让后端图片校验、尺寸读取、公开读取路径和响应结构保持清晰，不把图片逻辑继续堆进通用资产接口。

## 图片节点结构

编辑器将图片展示元数据保存到 JSON：

```ts
{
  type: "imageBlock",
  attrs: {
    imageId: string;
    src: string;
    filename: string;
    mimeType: string;
    size: number;
    naturalWidth: number | null;
    naturalHeight: number | null;
    width: number | null;
    height: number | null;
    alt: string;
    align: "left" | "center" | "right";
    rotate: 0 | 90 | 180 | 270;
    crop: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    linkHref: string;
    linkTarget: "_self" | "_blank";
  }
}
```

`width` 和 `height` 表示编辑器内容中的展示尺寸。`naturalWidth` 和 `naturalHeight` 来自上传后的原图尺寸。`crop` 使用 0 到 100 的百分比坐标，`x`、`y`、`width`、`height` 都按百分比保存，避免 JSON 与后续图片元数据修正强绑定。编辑器、序列化和公开渲染必须使用同一套百分比语义。

## 编辑器交互

新增 `ImageBlockView`，作为块级 React NodeView 渲染图片。

当图片被 hover 或选中时，在图片顶部外侧显示一排紧凑的 Ant Design 工具按钮。这个工具条只属于当前图片节点，不接入现有编辑器浮动工具栏，也不放进全局顶部工具栏。

工具条行为：

- 鼠标进入图片或工具条时显示。
- 图片处于选中或聚焦状态时常驻。
- 鼠标离开图片和工具条后延迟 120-180ms 隐藏。
- 从图片移动到工具条时不能闪烁，需要做 hover 防抖。
- 使用 Ant Design 的 `Button`、`Tooltip`、`Dropdown`、`Popover`、`Input`、`InputNumber`、`Select` 等组件。

工具条首版包含：

- 替换/上传图片。
- 裁剪。
- 宽高调整。
- 链接。
- 描述。
- 对齐。
- 样式/参数。
- 查看图片。
- 删除。
- 更多菜单，用于复制等低频操作。

选中态行为：

- 图片选中后显示蓝色描边和四角/四边控制点。
- 拖动角控制点默认等比缩放。
- 精确宽高调整放到工具条的宽高 Popover 中。
- 删除只删除当前 `imageBlock` 节点，不删除已上传的图片文件记录。
- 复制会复制当前节点 JSON，并复用同一个 `imageId`。

图片预览：

- 使用成熟图片预览库，不手写 lightbox。
- 需要支持上一张/下一张、放大/缩小、全屏、关闭。
- 预览图片列表从当前编辑器文档中的 `imageBlock` 节点收集。

## 插入与粘贴流程

工具栏上传流程：

1. 用户点击现有编辑器工具栏中的图片按钮。
2. 前端打开文件选择器，只接受图片 MIME 类型。
3. 前端将 `workspaceId + file` 上传到 `POST /api/v1/images/upload`。
4. 上传成功后，在当前选区插入一个 `imageBlock`。

粘贴流程：

1. 粘贴处理器先检查 `ClipboardEvent.clipboardData.items` 中是否包含图片文件。
2. 如果存在图片文件，阻止默认粘贴行为。
3. 每个图片文件都走同一个图片上传服务。
4. 每个上传成功的文件插入一个 `imageBlock`。

首版不自动转存粘贴 HTML 中的远程图片。这样可以避免 SSRF 和后台抓取风险。后续如果需要，可以单独做一个明确的“转存远程图片”命令，并在后端加入域名白名单、大小限制和超时限制。

## 前端服务

新增图片服务，例如 `src/services/images.ts`，用于 multipart 上传。现有 JSON `api-client` 不适合直接处理 `FormData`，因为它默认设置 `Content-Type: application/json`。

multipart 请求 helper 需要：

- 附带 `Authorization: Bearer <token>`。
- 不手动设置 `Content-Type`，让浏览器自动附加 multipart boundary。
- 复用现有 token 刷新策略，或者把 `api-client` 的底层请求能力抽出共享。
- 返回类型化的图片上传响应。

当前编辑器上下文已经有 `workspaceId`。上传时应从当前文档/编辑页上下文取得 `workspaceId`，并以窄接口传给编辑器图片上传命令，避免图片节点直接依赖整个文档上下文。

## 后端 API

新增 `ImagesModule`，目录为 `src/modules/images`。

首版接口：

```txt
POST /api/v1/images/upload
GET  /api/v1/images/:imageId/file
GET  /api/v1/public/images/:imageId/file
```

`POST /images/upload`：

- 需要登录认证。
- 接收 `multipart/form-data`，字段为 `workspaceId` 和 `file`。
- 校验用户是否有该工作空间访问权限。
- 只允许图片 MIME 类型。
- 如果配置了 `IMAGE_MAX_FILE_SIZE`，使用该限制；否则沿用 `MAX_FILE_SIZE`。
- 使用现有上传目录约定保存本地文件。
- 可以复用 `Asset` 表保存图片记录，也可以在保持兼容的前提下设计图片专用实体。
- 返回 `imageId`、`url`、`publicUrl`、文件名、MIME 类型、大小、宽度、高度、创建时间。

`GET /images/:imageId/file`：

- 需要登录认证。
- 根据图片或资产所属工作空间校验访问权限。
- 以内联方式返回图片文件流。

`GET /public/images/:imageId/file`：

- 公开访问策略沿用现有公开文档内容链路的前提。
- 当前需求是依赖已有源站地址校验，不引入签名 URL。
- 以内联方式返回 active 状态的图片文件流。

实现时可以复用现有 `Asset` 表，将图片上传保存为 active 资产，并记录图片 MIME 类型和尺寸。对外 API 仍使用稳定的 `imageId` 语义，即使内部映射到 `assetId`。

## 渲染与序列化

前端扩展：

- 在 `MarkdownEditor.tsx` 中注册 `imageBlock`。
- 在 `src/services/tiptap-extensions.ts` 中加入 `imageBlock` 序列化支持。
- 在同步身份节点类型中加入 `imageBlock`，确保它拥有 `clientId` 和服务端块身份。
- 在 Tiptap 节点类型到 block 类型转换中加入 `imageBlock`。

后端序列化：

- 在 `src/modules/documents/services/tiptap-serialization.extensions.ts` 中加入匹配的 `imageBlock` 支持。
- 渲染为安全 HTML，例如：

```html
<figure data-image-block data-align="center">
  <a href="..." target="_blank" rel="noopener noreferrer">
    <img src="..." alt="..." width="..." height="..." />
  </a>
</figure>
```

裁剪和旋转通过受限包装容器与安全 CSS 展示。后端 sanitizer 必须只允许图片节点需要的标签、属性和 CSS。公开渲染时，已发布文档中的图片应该输出公开图片 URL。

## 安全

后端上传校验：

- 拒绝非图片 MIME 类型。
- 不能只信任文件扩展名。
- 保留大小限制。
- 清理存储文件名。
- 首版不抓取远程粘贴图片 URL。

HTML 渲染：

- 清理 `href`、`target`、`rel`。
- 链接 scheme 只允许 `http`、`https`、`mailto`、`tel`。
- 禁止 `javascript:` 和 `data:` 链接。
- 限制图片布局、裁剪、旋转所需 CSS 属性。
- `alt`、标题、描述等文本通过正常渲染流程转义。

首版只允许 PNG、JPEG、WebP、GIF。SVG 暂不支持，因为安全地处理 SVG 需要单独加固，且首版图片编辑流程不依赖 SVG。

## 测试

前端测试：

- `imageBlock` 能解析和渲染预期 JSON 属性。
- 工具栏上传成功后能插入 `imageBlock`。
- 粘贴图片文件时，先上传图片，再进入 HTML/Markdown 粘贴逻辑。
- 图片属性命令只更新当前选中的图片节点。
- 序列化 HTML 包含 alt、尺寸、对齐、链接打开方式、裁剪和旋转信息。

后端测试：

- 上传接口拒绝非图片文件。
- 上传接口要求工作空间权限。
- 上传接口返回图片元数据和可用尺寸。
- 私有文件接口校验工作空间访问权限。
- 公开文件接口能通过公开路由返回 active 图片文件。
- 文档 HTML 渲染允许图片块输出，同时剥离不安全属性和样式。

手动验证：

- 从工具栏上传图片。
- 从剪贴板粘贴截图。
- 使用控制点调整图片大小。
- 编辑宽高、旋转、裁剪、链接、描述和对齐。
- 复制和删除图片节点。
- 使用预览查看上一张/下一张、放大/缩小、全屏和关闭。
- 保存、重新加载并发布包含图片的文档。

## 暂缓范围

- 服务端生成裁剪或旋转后的新图片文件。
- 缩略图生成。
- 图片引用计数和垃圾回收。
- 远程图片转存。
- 公开图片签名 URL。
- 高级图片库管理。


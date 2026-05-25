# 编辑器图片功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为编辑器实现图片上传、粘贴、图片块编辑、预览和后端图片上传/读取闭环。

**Architecture:** 前端新增 `imageBlock` Tiptap 节点、React NodeView、图片上传服务和图片粘贴处理；后端新增 `ImagesModule`，复用 `Asset` 实体和本地上传目录保存图片。图片裁剪、旋转、尺寸、链接、描述、对齐全部保存到 JSON 节点属性，不生成派生图片。

**Tech Stack:** Next.js、React、Tiptap、Ant Design、Vitest、NestJS、TypeORM、Jest、Multer。

---

### Task 1: 后端图片尺寸解析与图片模块

**Files:**
- Create: `E:\workspace\yuweb\back\server\src\modules\images\image-metadata.util.ts`
- Create: `E:\workspace\yuweb\back\server\src\modules\images\image-metadata.util.spec.ts`
- Create: `E:\workspace\yuweb\back\server\src\modules\images\images.service.ts`
- Create: `E:\workspace\yuweb\back\server\src\modules\images\images.controller.ts`
- Create: `E:\workspace\yuweb\back\server\src\modules\images\images.module.ts`
- Modify: `E:\workspace\yuweb\back\server\src\app.module.ts`

- [ ] **Step 1: Write failing tests for image metadata**

Create tests that prove PNG, GIF, WebP, and JPEG buffers return dimensions, and text/plain is rejected by service-level MIME validation.

- [ ] **Step 2: Run backend metadata tests and verify they fail**

Run: `pnpm test -- image-metadata.util.spec.ts`

- [ ] **Step 3: Implement `readImageMetadata`**

Implement minimal binary parsers for PNG IHDR, GIF logical screen descriptor, WebP VP8X/VP8/VP8L dimensions, and JPEG SOF markers.

- [ ] **Step 4: Add images service/controller/module**

Implement `POST /images/upload`, `GET /images/:imageId/file`, and `GET /public/images/:imageId/file`. Reuse `Asset` persistence, workspace access checks, upload directory config, and streamable file response.

- [ ] **Step 5: Register module**

Import `ImagesModule` in `src/app.module.ts`.

- [ ] **Step 6: Run backend tests**

Run: `pnpm test -- image-metadata.util.spec.ts`

### Task 2: 前端图片类型、上传服务和 Tiptap 扩展

**Files:**
- Create: `src/services/images.ts`
- Create: `src/components/markdown-editor/extensions/imageBlock.ts`
- Create: `src/components/markdown-editor/extensions/imageBlock.test.ts`
- Modify: `src/components/markdown-editor/MarkdownEditor.tsx`
- Modify: `src/services/tiptap-extensions.ts`
- Modify: `src/services/tiptap-converter.ts`
- Modify: `src/services/sync/identity.ts`

- [ ] **Step 1: Write failing imageBlock extension tests**

Test default attrs, command insertion, and HTML rendering attributes.

- [ ] **Step 2: Run frontend test and verify it fails**

Run: `pnpm test:unit -- src/components/markdown-editor/extensions/imageBlock.test.ts`

- [ ] **Step 3: Implement image upload service**

Add multipart upload with bearer token and typed response.

- [ ] **Step 4: Implement `imageBlock` extension**

Add node schema, commands `insertImageBlock` and `updateImageBlockAttrs`, parse/render HTML, and defaults.

- [ ] **Step 5: Wire schema into editor and serialization**

Register extension in editor, serialization extension list, sync identity type list, and Tiptap-to-block converter.

- [ ] **Step 6: Run frontend imageBlock tests**

Run: `pnpm test:unit -- src/components/markdown-editor/extensions/imageBlock.test.ts`

### Task 3: 前端图片 NodeView、hover 工具条、上传按钮和粘贴

**Files:**
- Create: `src/components/markdown-editor/ImageBlockView.tsx`
- Create: `src/components/markdown-editor/ImageBlockView.css`
- Modify: `src/components/markdown-editor/MarkdownEditor.tsx`
- Modify: `src/components/markdown-editor/EditorContext.tsx`
- Modify: `src/components/markdown-editor/Toolbar/DesktopToolbar.tsx`
- Modify: `src/components/markdown-editor/Toolbar/MobileToolbar.tsx`
- Modify: `src/components/markdown-editor/Toolbar/useToolbarActions.ts`
- Modify: `src/components/markdown-editor/extensions/pasteHandler.ts`

- [ ] **Step 1: Extend editor context**

Expose `workspaceId` to editor internals and pass it from `EditorPage` into `MarkdownEditor`.

- [ ] **Step 2: Implement ImageBlockView**

Render image with top-outside hover toolbar, 120-180ms hide debounce, Ant Design controls, selected outline, resize handles, link/alt/width/height/align/rotate editing, delete/copy, and Ant Design image preview.

- [ ] **Step 3: Add toolbar upload button**

Desktop toolbar gets an image upload button. Mobile toolbar gets image upload in the drawer.

- [ ] **Step 4: Add paste upload path**

Before HTML/Markdown paste logic, detect clipboard image files, upload them, and insert `imageBlock` nodes.

- [ ] **Step 5: Run focused frontend tests**

Run: `pnpm test:unit -- src/components/markdown-editor/extensions/pasteHandler.test.ts src/components/markdown-editor/extensions/imageBlock.test.ts`

### Task 4: 后端 document renderer support and verification

**Files:**
- Modify: `E:\workspace\yuweb\back\server\src\modules\documents\services\tiptap-serialization.extensions.ts`
- Modify: `E:\workspace\yuweb\back\server\src\modules\documents\services\document-html-renderer.service.ts`
- Modify: `E:\workspace\yuweb\back\server\src\modules\documents\services\document-html-renderer.service.spec.ts`

- [ ] **Step 1: Add renderer tests**

Assert `imageBlock` renders safe figure/img HTML and sanitizer strips unsafe image/link attributes.

- [ ] **Step 2: Run renderer tests and verify they fail**

Run: `pnpm test -- document-html-renderer.service.spec.ts`

- [ ] **Step 3: Add backend `imageBlock` serialization**

Add matching node extension for static renderer.

- [ ] **Step 4: Extend sanitizer**

Allow `figure`, image attrs, safe link attrs, and constrained transform/object-position style needed for non-destructive display.

- [ ] **Step 5: Run backend renderer tests**

Run: `pnpm test -- document-html-renderer.service.spec.ts`

### Task 5: Full verification

**Files:**
- No new files unless verification exposes defects.

- [ ] **Step 1: Run frontend verification**

Run: `pnpm test:unit`

- [ ] **Step 2: Run frontend build or lint**

Run: `pnpm build`

- [ ] **Step 3: Run backend verification**

Run in `E:\workspace\yuweb\back\server`: `pnpm test`

- [ ] **Step 4: Run backend build**

Run in `E:\workspace\yuweb\back\server`: `pnpm build`


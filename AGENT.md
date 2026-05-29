# AGENT.md - 内容基础设施开发指南

## 项目定位

**yuediter** 不仅仅是 CMS，而是一个**内容基础设施**平台，分为两大核心系统：

| 系统 | 定位 | 路由 |
|------|------|------|
| **内容编辑器** | 内容生产、编辑、协作 | `/dash/*` |
| **内容展区** | 内容展示、发布、消费 | `/blog/*`, `/doc/*` |

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16.x |
| UI 库 | React | 19.x |
| 类型系统 | TypeScript | 5.9.x |
| 编辑器 | Tiptap (ProseMirror) | 3.x |
| 组件库 | Ant Design | 6.x |
| 测试框架 | Vitest | 3.x |
| 包管理器 | pnpm | 10.x |

---

## 源码地图

### 一、内容编辑器系统 (Content Editor)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        内容编辑器系统                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│  │  路由层     │    │  状态管理层  │    │  编辑器核心  │              │
│  │  app/dash/  │───▶│  contexts/  │───▶│  components/ │              │
│  └─────────────┘    └─────────────┘    │  markdown-  │              │
│                                        │  editor/    │              │
│                                        └─────────────┘              │
│                                              │                      │
│                                              ▼                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│  │  服务层     │◀───│  同步引擎   │◀───│  数据层     │              │
│  │  services/  │    │  sync/      │    │  api-client │              │
│  └─────────────┘    └─────────────┘    └─────────────┘              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 1.1 路由层 (`app/dash/`)

```
app/dash/
├── page.tsx                    # 仪表盘首页 - 文档列表
└── edit/
    └── [slug]/
        └── page.tsx            # 文档编辑页 - 核心编辑界面
```

**入口组件**: `src/components/EditorPage.tsx`
- 编辑器页面主组件
- 集成认证、文档加载、自动保存、同步等功能

#### 1.2 编辑器核心 (`src/components/markdown-editor/`)

```
markdown-editor/
├── MarkdownEditor.tsx          # 编辑器主组件 (571行)
├── EditorContext.tsx            # 编辑器上下文
├── editorIdentity.ts           # 块身份标识
│
├── Toolbar/                    # 工具栏系统
│   ├── index.tsx               # 工具栏入口
│   ├── DesktopToolbar.tsx      # 桌面工具栏
│   ├── MobileToolbar.tsx       # 移动端工具栏
│   ├── toolbarState.ts         # 工具栏状态管理
│   ├── useToolbarActions.ts    # 工具栏操作
│   ├── LinkPickerPopup.tsx     # 链接选择器
│   ├── TablePicker.tsx         # 表格选择器
│   └── SplitDropdown.tsx       # 分割下拉菜单
│
├── BlockToolbar/               # 块级工具栏
│   ├── BlockHandle.tsx         # 块拖拽手柄
│   ├── BlockMenu.tsx           # 块菜单
│   ├── blockMenuItems.tsx      # 菜单项配置
│   └── blockTarget.ts          # 块目标定位
│
├── extensions/                 # Tiptap 扩展
│   ├── blockIdAttribute.ts     # 块ID属性
│   ├── fontSize.ts             # 字号扩展
│   ├── headingAnchor.ts        # 标题锚点
│   ├── highlightBlock.ts       # 高亮块
│   ├── imageBlock.ts           # 图片块
│   ├── indent.ts               # 缩进
│   ├── lineHeight.ts           # 行高
│   ├── markdownShortcuts.ts    # Markdown快捷输入
│   ├── orderedListStyle.ts     # 有序列表样式
│   ├── pasteHandler.ts         # 粘贴处理
│   └── tableIndexColumn.ts     # 表格索引列
│
├── code/                       # 代码块系统
│   ├── codeHighlight.ts        # 代码高亮 (Shiki)
│   ├── shikiCodeBlock.ts       # Shiki代码块扩展
│   └── codeBlockOptions.ts     # 代码块配置
│
├── table/                      # 表格系统
│   └── ...                     # 表格相关组件
│
├── TableOfContents/            # 目录系统
│   └── headingId.ts            # 标题ID生成
│
├── styles/                     # 编辑器样式
│   └── editor.css              # 编辑器核心样式
│
├── ImageBlockView.tsx          # 图片块视图
├── HighlightBlockView.tsx      # 高亮块视图
├── TaskItemView.tsx            # 任务项视图
├── TableInteractions.tsx       # 表格交互
└── scrollContainer.ts          # 滚动容器
```

**核心功能**:
- 基于 Tiptap/ProseMirror 的富文本编辑
- 支持 10+ 种内容块类型
- 实时协作同步
- Markdown 快捷输入
- 代码高亮 (Shiki)
- 图片上传和管理
- 表格编辑
- 目录导航

#### 1.3 状态管理层 (`src/contexts/`)

```
contexts/
├── DocumentContext.tsx          # 文档上下文 (323行)
│   ├── 文档列表管理
│   ├── 当前文档状态
│   ├── 保存状态追踪
│   ├── 版本管理
│   └── 工作区切换
│
└── AuthContext.tsx              # 认证上下文
    ├── 用户登录状态
    ├── Token 管理
    └── 权限控制
```

#### 1.4 自定义 Hooks (`src/hooks/`)

```
hooks/
├── useAutoSave.ts              # 自动保存
├── useDocumentSync.ts          # 文档同步 (222行)
│   ├── 增量同步
│   ├── 冲突解决
│   ├── 批量操作
│   └── 快照管理
└── useMediaQuery.ts            # 媒体查询
```

#### 1.5 服务层 (`src/services/`)

```
services/
├── document.ts                 # 文档服务 (757行) ⭐ 核心
│   ├── 文档 CRUD
│   ├── 内容加载/保存
│   ├── 版本控制
│   ├── 草稿管理
│   └── 发布功能
│
├── sync/                       # 同步引擎 ⭐ 核心
│   ├── engine.ts               # 同步引擎核心 (367行)
│   │   ├── 文档规范化
│   │   ├── 块差异计算
│   │   ├── 冲突解决
│   │   └── 创建确认
│   ├── api.ts                  # 同步 API
│   ├── batching.ts             # 批量操作
│   ├── reducer.ts              # 状态 reducer
│   ├── snapshot.ts             # 快照管理
│   ├── identity.ts             # 块身份标识
│   ├── order.ts                # 排序算法
│   ├── hash.ts                 # 哈希计算
│   └── types.ts                # 类型定义
│
├── tiptap-converter.ts         # Tiptap 转换器 (128行)
│   ├── Tiptap JSON ↔ Block 转换
│   └── 旧格式兼容
│
├── tiptap-extensions.ts        # Tiptap 扩展配置
├── generate-block-html.ts      # Block → HTML 渲染 (100行)
├── version-html.ts             # 版本 HTML 生成 (177行)
│
├── settings.ts                 # 设置服务 (322行)
│   ├── 用户设置
│   ├── 工作区设置
│   └── 优先级管理
│
├── workspace.ts                # 工作区服务
├── tags.ts                     # 标签服务
├── search.ts                   # 搜索服务 (151行)
├── images.ts                   # 图片服务
├── auth.ts                     # 认证服务
├── api-client.ts               # API 客户端
├── block-cache.ts              # 块缓存
├── save-policy.ts              # 保存策略
├── gc.ts                       # 垃圾回收
└── document-export.ts          # 文档导出
```

---

### 二、内容展区系统 (Content Exhibition)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         内容展区系统                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│  │  列表页     │    │  详情页     │    │  展示组件   │              │
│  │  app/blog/  │    │  app/doc/   │    │  components/│              │
│  └─────────────┘    └─────────────┘    └─────────────┘              │
│        │                  │                   │                      │
│        ▼                  ▼                   ▼                      │
│  ┌─────────────────────────────────────────────────────┐            │
│  │              服务层 (SSR/SSG)                        │            │
│  │  public-doc-snapshot.ts │ generate-block-html.ts    │            │
│  │  public-doc-content-fetch.ts │ version-html.ts      │            │
│  └─────────────────────────────────────────────────────┘            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2.1 路由层

```
app/
├── blog/
│   ├── page.tsx                # 文档列表页 (SSR)
│   └── PublicPageClient.tsx    # 列表客户端组件
│
├── doc/
│   └── [slug]/
│       ├── page.tsx            # 文档详情页 (SSR) ⭐ 核心
│       ├── style.css           # 文档样式
│       └── not-found.tsx       # 404 页面
│
└── public/
    └── ...                     # 其他公开页面
```

#### 2.2 展示组件 (`src/components/`)

```
components/
├── DocPageLayout.tsx           # 文档页面布局 (126行)
│   ├── 响应式布局
│   ├── 侧边栏控制
│   └── 设置加载
│
├── PublicDocHeader.tsx         # 公开文档头部 (119行)
│   ├── 返回导航
│   ├── 目录切换
│   └── 滚动隐藏
│
├── PublicDocTOC.tsx            # 公开文档目录 (229行)
│   ├── 标题提取
│   ├── 滚动监听
│   ├── 折叠展开
│   └── 活跃状态
│
├── PublicHeadingAnchorEnhancer.tsx  # 标题锚点增强
├── PublicDocHeader.css         # 头部样式
├── PublicDocTOC.css            # 目录样式
│
├── DeferredCodeBlockRenderer.tsx    # 延迟代码块渲染
├── DeferredDocImagePreview.tsx      # 延迟图片预览
├── ClientCodeBlockRenderer.tsx      # 客户端代码块渲染
├── DocImagePreview.tsx              # 文档图片预览
│
├── VersionDiffModal.tsx        # 版本差异对比
├── DocumentHeader.tsx          # 文档头部 (编辑器用)
├── DocumentSidebar/            # 文档侧边栏
├── DocumentListModal.tsx       # 文档列表弹窗
├── DocumentSearchModal.tsx     # 文档搜索弹窗
├── DocumentInfoModal.tsx       # 文档信息弹窗
├── CreateDocumentModal.tsx     # 创建文档弹窗
├── SetupModal.tsx              # 设置弹窗
├── WorkspaceSettingsModal.tsx  # 工作区设置
├── TagManagementModal.tsx      # 标签管理
├── GcDebugModal.tsx            # GC调试弹窗
└── ThemeSwitcher.tsx           # 主题切换器
```

#### 2.3 展示层服务

```
services/
├── public-doc-snapshot.ts      # 公开文档快照 (256行) ⭐ 核心
│   ├── SSR 数据获取
│   ├── 缓存策略 (unstable_cache)
│   ├── 内容渲染
│   └── 元数据提取
│
├── public-doc-content-fetch.ts # 公开文档内容获取
├── public-doc-revalidation.ts  # 公开文档重新验证
│
├── generate-block-html.ts      # Block → HTML 渲染 (100行)
│   ├── Tiptap 静态渲染
│   ├── 代码块占位符
│   └── 图片 URL 重写
│
└── version-html.ts             # 版本 HTML 生成 (177行)
    ├── 版本树 → HTML
    ├── 分块 HTML 生成
    └── 差异对比支持
```

---

### 三、共享基础设施

#### 3.1 API 客户端 (`src/services/api-client.ts`)

```
api-client.ts
├── 请求拦截 (Token 注入)
├── 响应拦截 (错误处理)
├── Token 刷新
└── 请求方法封装
    ├── apiGet
    ├── apiPost
    ├── apiPatch
    ├── apiDelete
    └── apiPostForm
```

#### 3.2 工具库 (`src/lib/`)

```
lib/
├── doc-slug.ts                 # 文档 slug 编解码
└── highlight.ts                # 代码高亮工具
```

#### 3.3 主题系统 (`src/theme/`)

```
theme/
├── themes.ts                   # 主题定义
├── ThemeContext.tsx             # 主题上下文
└── index.ts                    # 主题导出
```

#### 3.4 样式系统 (`src/styles/`)

```
styles/
├── tokens.css                  # 设计令牌
└── themes/
    ├── light.css               # 亮色主题
    └── dark.css                # 暗色主题
```

---

### 四、数据流架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                          数据流架构                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐   │
│  │   编辑器    │         │   同步引擎   │         │   服务器    │   │
│  │  (Tiptap)   │────────▶│  (sync/)    │────────▶│   (API)     │   │
│  └─────────────┘         └─────────────┘         └─────────────┘   │
│        │                       │                       │            │
│        ▼                       ▼                       ▼            │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐   │
│  │  JSON 格式  │         │  增量同步   │         │  Block 存储 │   │
│  │  (Tiptap)   │         │  冲突解决   │         │  (Tree)     │   │
│  └─────────────┘         └─────────────┘         └─────────────┘   │
│        │                                               │            │
│        │         ┌─────────────────────────┐           │            │
│        └────────▶│    tiptap-converter.ts  │◀──────────┘            │
│                  │    Tiptap ↔ Block 转换  │                        │
│                  └─────────────────────────┘                        │
│                              │                                      │
│                              ▼                                      │
│                  ┌─────────────────────────┐                        │
│                  │   generate-block-html   │                        │
│                  │   Block → HTML 渲染     │                        │
│                  └─────────────────────────┘                        │
│                              │                                      │
│                              ▼                                      │
│                  ┌─────────────────────────┐                        │
│                  │      内容展区展示        │                        │
│                  │   (SSR/静态生成)         │                        │
│                  └─────────────────────────┘                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 五、核心数据模型

#### 5.1 文档模型

```typescript
interface Document {
  docId: string;
  workspaceId: string;
  title: string;
  icon?: string;
  cover?: string;
  visibility: string;        // "public" | "private"
  status: string;            // "draft" | "published"
  rootBlockId: string;
  head: number;              // 当前版本号
  publishedHead?: number;    // 已发布版本号
  tags?: string[];
  category?: string;
  createdAt: string;
  updatedAt: string;
}
```

#### 5.2 块模型

```typescript
interface Block {
  blockId: string;
  docId: string;
  type: string;              // "paragraph" | "heading" | "codeBlock" | ...
  payload: Record<string, unknown>;  // Tiptap JSON 节点
  parentId?: string;
  sortKey: string;           // 排序键
  indent: number;
  collapsed: boolean;
  children?: Block[];
}
```

#### 5.3 编辑器内容模型

```typescript
interface TiptapDoc {
  type: "doc";
  content: TiptapNode[];
}

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}
```

---

### 六、路由架构

```
/                               # 首页重定向
├── /dash                       # 仪表盘 (需要认证)
│   └── /edit/[slug]            # 文档编辑页
│
├── /blog                       # 公开文档列表 (SSR)
│   └── /blog/[slug]            # 公开文档详情 (SSR)
│       └── /blog/[slug]/latest # 最新版本预览
│
├── /doc/[slug]                 # 文档详情 (SSR, 另一入口)
│
└── /api/
    └── /revalidate-doc         # 文档重新验证 API
```

---

### 七、常用命令

```bash
# 开发服务器 (端口 3001)
pnpm dev

# 构建生产版本
pnpm build

# 启动生产服务器 (端口 3001)
pnpm start

# 代码检查
pnpm lint

# 运行单元测试
pnpm test:unit
```

---

### 八、AGENT 开发必须遵守的规范

> **重要**: 以下规范必须严格遵守，违反将导致代码被拒绝合并。

#### 8.1 提交格式规范 (必须遵守)

**格式**: `type(scope): description`

**type 类型**:
| type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(editor): 添加表格功能` |
| `fix` | Bug 修复 | `fix(editor): 修复滚动失准` |
| `refactor` | 重构 | `refactor(sync): 优化同步逻辑` |
| `style` | 样式/格式 | `style(editor): 调整工具栏样式` |
| `test` | 测试 | `test(document): 添加单元测试` |
| `docs` | 文档 | `docs: 更新 AGENT.md` |
| `chore` | 构建/工具 | `chore: 更新依赖版本` |

**scope 范围**:
| scope | 说明 |
|-------|------|
| `editor` | 编辑器相关 |
| `sync` | 同步引擎相关 |
| `doc` | 文档服务相关 |
| `ui` | UI 组件相关 |
| `api` | API 相关 |
| `config` | 配置相关 |

**示例**:
```bash
git commit -m "feat(editor): 在工具栏中新增代码清理工具"
git commit -m "fix(editor): 修复表格相关构建类型错误"
git commit -m "refactor(sync): 优化块差异计算算法"
```

#### 8.2 代码质量检查 (必须遵守)

**提交前必须执行**:
```bash
# 1. 代码检查 (必须通过)
pnpm lint

# 2. 单元测试 (必须通过)
pnpm test:unit

# 3. 构建检查 (建议)
pnpm build
```

**禁止提交**:
- 包含 `console.log` 调试代码 (生产环境)
- 包含 `TODO` 或 `FIXME` 注释 (需先解决)
- 包含硬编码的密钥或敏感信息
- 包含未使用的导入或变量

#### 8.3 代码风格规范 (必须遵守)

**TypeScript**:
- 使用严格模式 (`strict: true`)
- 禁止使用 `any` 类型 (使用 `unknown` 或具体类型)
- 所有函数必须有返回类型注解
- 使用 `interface` 定义对象类型，`type` 定义联合类型

**React**:
- 使用函数式组件 + Hooks
- 组件文件使用 `.tsx` 扩展名
- 组件名使用 PascalCase
- 自定义 Hook 以 `use` 开头

**服务层**:
- 使用 async/await 处理异步
- 错误处理使用 try/catch
- API 调用封装在 `services/` 目录

#### 8.4 文件组织规范 (必须遵守)

**目录结构**:
```
src/
├── components/          # React 组件
│   └── markdown-editor/ # 编辑器组件
├── contexts/            # React Context
├── hooks/               # 自定义 Hooks
├── lib/                 # 工具函数
├── services/            # 业务逻辑服务
│   ├── sync/            # 同步引擎
│   └── __tests__/       # 测试文件
├── styles/              # 样式文件
└── theme/               # 主题配置
```

**文件命名**:
- 组件: `PascalCase.tsx` (如 `MarkdownEditor.tsx`)
- 服务: `camelCase.ts` (如 `document.ts`)
- 测试: `*.test.ts` 或 `*.test.tsx`
- 样式: `*.css` (与组件同名)

#### 8.5 测试规范 (必须遵守)

**测试覆盖**:
- 新功能必须包含单元测试
- Bug 修复必须包含回归测试
- 测试文件与源文件同级或在 `__tests__/` 目录

**测试命名**:
```typescript
describe('文档服务', () => {
  it('应该正确加载文档内容', () => {
    // 测试逻辑
  });
  
  it('应该处理文档不存在的情况', () => {
    // 测试逻辑
  });
});
```

**运行测试**:
```bash
# 运行所有测试
pnpm test:unit

# 运行特定测试文件
pnpm test:unit src/services/document.test.ts
```

#### 8.6 性能规范 (必须遵守)

**前端性能**:
- 组件使用 `React.memo` 或 `useMemo` 优化
- 避免在渲染函数中创建新对象/函数
- 大型列表使用虚拟滚动
- 图片使用懒加载

**API 性能**:
- 使用批量操作减少请求次数
- 实现请求缓存和去重
- 使用增量同步减少数据传输

#### 8.7 安全规范 (必须遵守)

**输入验证**:
- 所有用户输入必须验证和清理
- 使用 `sanitize-html` 清理 HTML 内容
- 防止 XSS 和注入攻击

**认证授权**:
- Token 存储在安全位置
- 敏感操作需要重新验证
- 实现权限检查

#### 8.8 文档规范 (建议遵守)

**代码注释**:
- 复杂逻辑必须添加注释
- 公共 API 必须添加 JSDoc 注释
- 注释使用中文

**README 更新**:
- 新功能需要更新 README
- API 变更需要更新文档
- 配置变更需要更新说明

---

### 九、关键依赖说明

| 依赖 | 用途 |
|------|------|
| **Tiptap** | 富文本编辑器框架，基于 ProseMirror |
| **Ant Design** | UI 组件库 |
| **Shiki** | 代码语法高亮 |
| **sanitize-html** | HTML 清理，防止 XSS |
| **Turndown** | HTML 转 Markdown |
| **marked** | Markdown 解析 |
| **htmldiff-js** | HTML 差异对比 |

---

### 十、环境变量

```env
NEXT_PUBLIC_API_BASE=    # API 基础 URL
NEXT_PUBLIC_DOC_PATH=    # 文档公开路径 (默认: /blog)
```

---

### 十一、架构特点

1. **内容基础设施定位**
   - 不仅仅是 CMS，而是完整的内容生产-消费链路
   - 支持多种内容类型和块级编辑
   - 提供版本控制和协作能力

2. **双系统架构**
   - 编辑器系统: 内容生产、编辑、协作
   - 展区系统: 内容展示、发布、消费
   - 通过同步引擎连接

3. **增量同步引擎**
   - 块级粒度的增量同步
   - 冲突自动解决
   - 批量操作优化

4. **SSR/SSG 支持**
   - 公开页面使用 SSR
   - 支持静态生成和 ISR
   - 优化 SEO 和性能

5. **响应式设计**
   - 桌面端和移动端适配
   - 自适应布局
   - 触摸交互支持

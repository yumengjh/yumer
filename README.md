# yuediter — 不止是 CMS

**本地优先的块级文档编辑器 + 发布平台**

yuediter 是一个基于 TipTap 的 Markdown 超集富文本编辑器，具备完整的后端服务（NestJS + PostgreSQL）。它不只是一个内容管理系统——它是一个**本地优先、块级增量同步、自带版本控制**的文档工作平台。

## 核心特性

### 1. 块级 Markdown 编辑器

基于 TipTap 构建，支持 Markdown 超集语法。每个段落、标题、代码块、图片都是独立的块（Block），可以拖拽排序、独立操作。

- 拖拽排序 + 快捷键调整（Alt+↑↓）
- 块级工具栏（插入、删除、移动）
- 代码块高亮（Shiki，支持 100+ 语言）
- 图片上传与预览
- 表格编辑
- 任务列表
- 查找替换（支持正则）
- 浮动工具栏 + 桌面/移动端自适应

### 2. 本地优先同步引擎

不是传统的"整篇文档保存"。同步引擎以**块级增量操作**为核心：

- **离线编辑**：断网也能写，本地 IndexedDB 持久化
- **增量 flush**：后台自动将变更同步到服务端，不阻塞编辑
- **冲突自动解决**：基于 identity chain（blockId + clientId + createId）的操作幂等性
- **自动保存 → 草稿**：不进入正式版本历史
- **手动保存 → 正式版本**：用户主动触发才创建版本

```
编辑 → 本地 Operation → 排序键分配 → 批量 flush → 服务端确认 → 快照
```

### 3. 版本控制

不是 Git 式的快照，而是面向文档的版本管理：

- **草稿/版本分离**：自动保存是草稿，手动保存才创建正式版本
- **版本对比**：HTML diff 可视化，支持逐块对比
- **版本回滚**：一键恢复到任意历史版本
- **块级快照**：本地 IndexedDB 存储，支持离线对比
- **diff 探索器**：JSON 结构差异导出

### 4. 公开文档发布

文档可以发布为公开页面，具备完整的 SSR/ISR 能力：

- **服务端渲染**（SSR）：首屏即完整 HTML，SEO 友好
- **增量静态再生成**（ISR）：按需更新，不重建整个站点
- **缓存标签失效**：基于 Next.js 的 `revalidateTag` 精准失效
- **快照缓存**：发布内容快照化，避免数据库实时查询
- **公开目录结构**：侧边栏目录 + 锚点导航

### 5. 工作空间 & 权限

- 多文档管理（列表、搜索、标签筛选）
- 工作空间级权限控制（JWT + Guard）
- 文档标签系统
- 收藏夹
- 活动日志
- 审计追踪

### 6. 知识图谱（graphify）

项目集成了 [graphify](https://github.com/safishamsi/graphify) 知识图谱工具，将 355 个文件的代码库转化为可导航的知识网络：

- **1,672 节点 · 2,998 边 · 151 社区**
- **75.7x token 压缩**：Agent 查图谱代替读源码
- 三种输出：`graph.html`（交互式可视化）、`graph.json`（GraphRAG-ready）、`GRAPH_REPORT.md`（审计报告）

**常用命令：**

```bash
# 查询图谱（BFS 广度搜索）
/graphify query "同步引擎怎么工作"

# 查询图谱（DFS 深度追踪）
/graphify query "sortKey 如何从分配到确认" --dfs

# 两个概念之间的最短路径
/graphify path "TiptapDoc" "SyncEngine"

# 解释某个节点的所有连接
/graphify explain "deriveSyncEntries"

# 增量更新（只重新提取改过的文件）
/graphify --update

# 全量重建
/graphify .
```

**新 Agent 工作流：** 先查图谱获取全局视图，再有针对性地读具体文件。避免无头苍蝇式地翻代码。

**图谱输出位置：** `graphify-out/`

```
graphify-out/
├── graph.html          # 交互式图谱，浏览器打开
├── graph.json          # 结构化图数据
├── GRAPH_REPORT.md     # 审计报告
└── cost.json           # token 消耗记录
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 15 + React + TypeScript |
| 编辑器 | TipTap (ProseMirror) + Shiki |
| UI | Ant Design + 自定义组件 |
| 后端 | NestJS + TypeORM + PostgreSQL |
| 认证 | JWT + bcryptjs |
| 同步 | 自研块级增量同步引擎 |
| 知识图谱 | graphify (Python) |
| 测试 | Vitest |

---

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 访问
# 编辑器：http://localhost:3000
# 文档：  http://localhost:3000/doc/[slug]
# 公开页：http://localhost:3000/public
```

后端服务配置见 `server-docs/SETUP.md`。

---

## 项目结构

```
yuediter/
├── app/                    # Next.js App Router 页面
│   ├── api/                # API 路由
│   ├── dash/               # 仪表盘
│   ├── doc/                # 文档编辑页
│   └── public/             # 公开文档页
├── src/
│   ├── components/         # React 组件
│   │   ├── markdown-editor/  # TipTap 编辑器核心
│   │   │   ├── BlockToolbar/   # 块级工具栏
│   │   │   ├── Toolbar/        # 浮动/桌面工具栏
│   │   │   ├── code/           # 代码块渲染
│   │   │   ├── extensions/     # TipTap 扩展
│   │   │   └── table/          # 表格功能
│   │   └── __tests__/        # 组件测试
│   ├── contexts/           # React Context
│   ├── hooks/              # 自定义 Hooks
│   ├── services/           # 业务服务层
│   │   ├── sync/             # 同步引擎
│   │   │   ├── engine.ts       # 同步引擎核心
│   │   │   ├── identity.ts     # 块身份链
│   │   │   ├── batching.ts     # 批量发送
│   │   │   ├── reducer.ts      # 状态归约
│   │   │   └── snapshot.ts     # 快照管理
│   │   └── __tests__/        # 服务测试
│   ├── theme/              # 主题系统
│   └── types/              # TypeScript 类型
├── docs/                   # 开发文档 & 回顾
├── server-docs/            # 后端 API 文档
├── graphify-out/           # 知识图谱输出
└── public/                 # 静态资源
```

---

## 关键概念

| 概念 | 说明 |
|------|------|
| **Block** | 文档的基本单元（段落、标题、代码块、图片等） |
| **TiptapDoc** | TipTap 编辑器的文档模型（ProseMirror JSON） |
| **SyncEntry** | 同步引擎的操作条目（create/update/delete/move） |
| **sortKey** | 块的排序键，分配-确认-修复三阶段生命周期 |
| **identity chain** | blockId → clientId → createId 的身份链，保证操作幂等 |
| **Operation** | 块级增量操作，同步引擎的最小单位 |
| **Draft** | 自动保存的草稿，不进入正式版本历史 |
| **Version** | 手动创建的正式版本，可对比、回滚 |
| **Snapshot** | 发布内容的快照化缓存 |

---

## 开发文档

- **后端 API**：`server-docs/` — 安装、API 设计、安全、版本控制
- **设计文档**：`docs/` — 同步引擎、块工具栏、编辑器迁移等设计决策
- **回顾文档**：`docs/` — 每个重要功能的实施回顾
- **知识图谱**：`graphify-out/GRAPH_REPORT.md` — 代码库全局视图

---

## License

Private project.

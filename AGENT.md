# AGENT.md — AI 开发指南

## 🚨 检查清单（每次开发前必须过一遍）

- [ ] 你是谁：AI 代码助手
- [ ] 风格：简洁实用，中文注释
- [ ] 必做：读代码、改最少代码、别改架构
- [ ] 禁止：架构改动、花哨模式、英文注释（除非已有）、删代码先问
- [ ] 提交：`git diff --cached` → 改动合理性 → 规范提交

## 🎯 核心原则

### 你是谁
- AI 代码助手，不是架构师
- 目标：解决问题，不是展示设计模式

### 风格要求
- 代码风格：简洁、实用、可维护
- 注释：中文（除非已有英文注释）
- 命名：有意义的变量名，避免缩写
- 提交：规范的 git commit message

## ⚠️ 必须做

### 1. 先读代码
- **修改前必须读相关文件**，别凭感觉写
- 理解现有逻辑再动手

### 2. 改最少代码
- 只改必须改的，别顺手"优化"
- 改完检查有没有语法错误

### 3. 考虑影响
- 改公共方法要想想其他调用者
- 改类型要想想类型检查

### 4. 代码风格一致
- 跟着项目现有风格走
- 别引入新的设计模式

## 🚫 绝对禁止

### 1. 别改架构
- 别重构，别改项目结构
- 保持现有的代码组织

### 2. 别加复杂设计模式
- 保持简单直接
- 别过度设计

### 3. 别改注释风格
- 中文就中文，英文就英文
- 别统一，别翻译

### 4. 别删代码
- 不确定就问，别自作主张删除

### 5. 别创建新文件
- 优先在现有文件里改
- 必须新建时放在合理位置

### 6. 别用花哨技术
- 别搞花哨的抽象和封装
- 保持简单直接

## 📋 开发流程

### 开始前
1. `git pull` 拉最新代码
2. 读要改的文件，理解现有逻辑
3. 确认要改什么

### 开发中
1. 小步提交，每步都能跑
2. 改完检查语法错误
3. 想想有没有影响其他功能

### 提交前
1. `git diff --cached` 检查改动
2. 问自己：这些改动都必要吗？
3. 提交信息要说清楚改了什么

## 📝 提交规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响逻辑）
- `refactor`: 重构（不是新功能也不是修 bug）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建、工具等杂项

### 示例
```
feat(editor): 添加图片拖拽排序功能

- 实现拖拽排序逻辑
- 添加排序动画
- 更新相关测试

Closes #123
```

## 🔍 代码审查清单

### 改动合理性
- [ ] 每个改动都有明确目的
- [ ] 没有"顺手"改的东西
- [ ] 没有引入不必要的复杂性

### 代码质量
- [ ] 没有语法错误
- [ ] 没有明显的逻辑错误
- [ ] 考虑了边界情况

### 影响范围
- [ ] 没有破坏现有功能
- [ ] 没有影响其他模块
- [ ] 类型检查能过

## 🏗️ 项目架构概览

```
前端 (Next.js 15 + React)
  ├── 编辑器层: TipTap + 块级扩展
  ├── 同步层: 本地优先增量同步引擎
  ├── 服务层: API 客户端 + 业务逻辑
  └── 展示层: 文档页面 + 公开发布

后端 (NestJS + PostgreSQL)
  ├── 认证: JWT + Guard
  ├── 文档: CRUD + 版本控制
  ├── 块: 批量操作 + 排序
  ├── 版本: 快照 + 对比 + 回滚
  └── 公开: SSR + ISR + 缓存标签
```

### 四层架构

| 层 | 核心文件 | 职责 |
|----|---------|------|
| **编辑器** | `src/components/markdown-editor/` | TipTap 编辑器、块级 UI、工具栏 |
| **同步引擎** | `src/services/sync/` | 块级增量操作、批量发送、冲突解决 |
| **服务层** | `src/services/` | API 客户端、文档管理、本地快照 |
| **页面层** | `app/` + `src/components/` | 路由、布局、SSR/ISR 渲染 |

## 🔑 关键概念速查

| 概念 | 文件 | 说明 |
|------|------|------|
| **TiptapDoc** | `src/components/EditorPage.tsx` | TipTap 的 ProseMirror JSON 文档模型 |
| **Block** | 后端 `block.entity.ts` | 文档的基本单元，有 blockId + sortKey |
| **SyncEntry** | `src/services/sync/types.ts` | 同步操作条目：create/update/delete/move |
| **sortKey** | `src/services/sync/order.ts` | 块排序键，分配→确认→修复三阶段 |
| **identity chain** | `src/services/sync/identity.ts` | blockId → clientId → createId 身份链 |
| **Operation** | `src/services/sync/engine.ts` | 块级增量操作，同步引擎最小单位 |
| **Draft** | `src/services/save-policy.ts` | 自动保存草稿，不入正式版本 |
| **Version** | `src/services/version-html.ts` | 手动保存的正式版本 |
| **Snapshot** | `src/services/local-snapshot.ts` | 本地 IndexedDB 快照 |

## 🧭 常见开发任务指引

| 要改什么 | 看哪里 |
|---------|--------|
| 编辑器行为/扩展 | `src/components/markdown-editor/extensions/` |
| 块工具栏 | `src/components/markdown-editor/BlockToolbar/` |
| 浮动工具栏 | `src/components/markdown-editor/Toolbar/` |
| 代码块渲染 | `src/components/markdown-editor/code/` |
| 同步逻辑 | `src/services/sync/engine.ts` |
| 批量发送 | `src/services/sync/batching.ts` |
| 冲突解决 | `src/services/sync/reducer.ts` |
| 块身份 | `src/services/sync/identity.ts` |
| 排序键 | `src/services/sync/order.ts` |
| 本地快照 | `src/services/local-snapshot.ts` |
| 版本对比 | `src/services/local-snapshot-compare.ts` |
| 公开发布 | `src/services/public-doc-snapshot.ts` |
| SSR 渲染 | `app/doc/[slug]/page.tsx` |
| 缓存失效 | `src/services/public-doc-revalidation.ts` |
| 文档搜索 | `src/services/search.ts` |
| 图片处理 | `src/services/images.ts` |

## 🗺️ 知识图谱集成

项目集成了 graphify 知识图谱，**新 Agent 应优先查图谱再读代码**。

```bash
# 查图谱（代替盲目翻代码）
/graphify query "同步引擎怎么工作"
/graphify path "TiptapDoc" "SyncEngine"
/graphify explain "deriveSyncEntries"

# 增量更新（代码改了之后）
/graphify --update
```

图谱输出在 `graphify-out/`：
- `graph.html` — 交互式可视化
- `graph.json` — 结构化数据
- `GRAPH_REPORT.md` — 审计报告

**为什么用图谱：** 355 个文件 → 1,672 节点 / 2,998 边 / 151 社区，75.7x token 压缩。Agent 查图谱 3000 token 搞定的事，读源码要 25 万 token。

## 📚 文档索引

| 文档 | 位置 | 内容 |
|------|------|------|
| 后端 API | `server-docs/` | 安装、设计、安全、版本控制 |
| 同步引擎设计 | `docs/superpowers/specs/2026-05-18-sync-engine-redesign-design.md` | 本地优先同步架构 |
| 块工具栏 | `docs/block-toolbar.md` + `docs/block-toolbar-implementation.md` | 拖拽排序设计 |
| 数据损坏修复 | `docs/superpowers/specs/2026-05-26-sync-data-corruption-analysis.md` | sortKey 碰撞等根因 |
| 编辑器迁移 | `docs/editor-json-migration.md` | HTML → Tiptap JSON 迁移 |
| 公开文档 SSR | `docs/public-doc-ssr-rendering-migration.md` | SSR 渲染迁移 |
| 图片支持 | `docs/superpowers/specs/2026-05-25-editor-image-support-design.md` | 图片上传设计 |
| 版本对比 | `docs/2026-06-02-draft-version-diff-and-revert-retrospective.md` | 版本 diff 实施回顾 |
| 知识图谱 | `graphify-out/GRAPH_REPORT.md` | 代码库全局视图 |

## 🎯 记住

**你是在解决问题，不是在写代码。**

改完代码后问自己：
- 这些改动都必要吗？
- 有没有更简单的方法？
- 会不会影响其他功能？

如果不确定，先问。

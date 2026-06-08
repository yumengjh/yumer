# 文档生命周期与回收站前端复盘

> 日期：2026-06-08
> 前端仓库：`E:\workspace\editor-demo\app`
> 对应后端仓库：`E:\workspace\yumer-server`
> 主题：回收站独立入口、顶部弹出页、自动删除倒计时、真删除、渲染缓存 GC 控制

## 1. 结论

本轮前端把文档删除体验从“侧边栏直接删除按钮”升级成了完整的回收站工作流。

当前前端已经具备：

- 删除文档时使用“移至回收站”语义；
- 顶部工具栏提供独立回收站入口；
- 回收站使用顶部 Drawer 弹出页面；
- 回收站文档按卡片网格展示，不再一文档占一整行；
- 回收站文档显示剩余自动删除天数；
- 支持恢复；
- 支持真删除；
- 文档管理弹窗内的回收站视图和顶部回收站能力保持一致；
- GC 调试页增加 render cache 状态与 sweep 控制。

这次前端的重点不是“加一个按钮”，而是让用户能理解文档处于哪个生命周期阶段，并给危险操作明确边界。

## 2. Review 结果

提交前做了前端 review，重点检查：

- 删除按钮是否仍暗示直接物理删除；
- 独立回收站入口是否在桌面和移动菜单都可达；
- 顶部 Drawer 是否真实查询后端 `status=deleted`；
- UI 是否显示后端返回的 `trashDaysRemaining`，而不是前端猜测；
- 恢复后是否刷新正常文档列表和回收站列表；
- 真删除后是否刷新状态，避免已删除卡片残留；
- 文档管理弹窗和独立回收站是否存在能力不一致；
- render cache GC 控制是否复用现有 admin token/operatorId 机制；
- 是否误提交已有无关文件。

Review 中发现并修复了一个一致性问题：

- 顶部独立回收站已有“真删除”；
- 文档管理弹窗的回收站视图最初只有“恢复”；
- 已补齐弹窗内“恢复 + 真删除”，避免两个回收站入口能力不一致。

Review 后没有发现阻断提交的前端行为问题。

## 3. 产品设计

### 3.1 删除语义

原先“删除”容易被理解成不可恢复操作。

本轮前端将可恢复删除统一表达为：

```text
移至回收站
```

原因：

- 后端已经实现软删除；
- 用户应该知道文档不是马上消失；
- 恢复入口要和删除语义对应；
- 真删除必须单独命名和二次确认。

### 3.2 独立回收站入口

新增入口放在顶部 Header，而不是只藏在文档管理弹窗里。

原因：

- 回收站是全局文档生命周期入口，不属于某一个文档；
- 用户删除后需要立即找到恢复位置；
- 顶部入口比侧边栏层级更稳定；
- 移动端也需要从更多菜单进入。

组件：

- `src/components/DocumentHeader.tsx`
- `src/components/DocumentTrashDrawer.tsx`
- `src/components/DocumentTrashDrawer.css`

### 3.3 顶部弹出页

回收站使用 `Drawer placement="top"`，高度 `86vh`。

设计原因：

- 回收站是临时任务面板，不应离开当前编辑上下文；
- 顶部抽屉比侧边抽屉更适合展示多列卡片；
- 用户完成恢复/真删除后可以立即回到编辑器；
- 不需要新路由，避免破坏当前文档 URL 状态。

### 3.4 卡片网格而不是整行列表

用户指出“一文档一行有点奇怪、浪费位置”。

本轮把回收站改为卡片网格：

```css
grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
```

卡片内信息层级：

1. 文档 icon + 标题；
2. 原状态和可见性；
3. 自动删除倒计时；
4. 删除时间和原状态；
5. 恢复 / 真删除动作。

这比整行列表更适合回收站场景：

- 文档数量通常中低频；
- 每个条目需要展示生命周期字段；
- 操作按钮不应该挤在长列表右侧；
- 多列布局能显著减少空白。

### 3.5 自动删除倒计时

前端展示：

```text
X 天后自动删除
今天自动删除
自动删除时间未知
```

数据来自后端：

- `trashDaysRemaining`
- `trashExpiresAt`
- `trashRetentionDays`

前端不自己计算保留期。

原因：

- 保留策略属于服务端；
- 后端以后可以按 workspace 或策略调整保留期；
- 前端只负责展示契约，不制造第二套规则；
- 多端展示必须一致。

### 3.6 真删除设计

真删除按钮是危险操作：

- 使用 `danger` 样式；
- 使用 `Popconfirm` 二次确认；
- 文案明确“无法从回收站恢复”；
- 执行时绑定单个文档 loading 状态；
- 成功后刷新回收站和普通文档列表。

接口：

```text
DELETE /documents/:docId/permanent
```

前端服务：

- `permanentlyDeleteDocument()`
- `permanentlyDeleteDoc()`

组件入口：

- 顶部回收站 Drawer；
- 文档管理弹窗的回收站视图。

## 4. 接口设计与状态实践

### 4.1 文档服务层

`src/services/document.ts` 增加：

- `trashRetentionDays`
- `trashExpiresAt`
- `trashDaysRemaining`
- `PermanentlyDeleteDocumentResult`
- `permanentlyDeleteDocument()`

服务层只表达 HTTP 契约，不承担 UI 状态。

### 4.2 DocumentContext

`DocumentContext` 增加：

```ts
permanentlyDeleteDoc: (docId: string) => Promise<void>
```

原因：

- 顶部回收站和文档管理弹窗都需要真删除；
- 真删除后需要统一清理 `documents` state；
- 如果当前文档被真删除，需要统一清空当前文档上下文；
- 避免每个组件自己维护全局状态副作用。

### 4.3 回收站列表加载

两个回收站入口都使用：

```ts
listDocuments({
  workspaceId,
  status: "deleted",
  sortBy: "deletedAt",
  sortOrder: "DESC",
})
```

这里选择 `deletedAt` 排序，而不是 `updatedAt`。

原因：

- 回收站最重要的时间是删除时间；
- 自动删除倒计时也以删除时间为基准；
- 用户通常想先看到最近删除的文档。

### 4.4 恢复后刷新

恢复成功后：

1. 调用 `restoreDoc()`；
2. 调用 `refreshDocs()`；
3. 重新加载回收站；
4. 显示成功消息。

这样避免：

- 普通文档列表没出现恢复文档；
- 回收站里仍残留已恢复卡片；
- 当前文档 state 和列表 state 不一致。

### 4.5 真删除后刷新

真删除成功后：

1. 调用 `permanentlyDeleteDoc()`；
2. 调用 `refreshDocs()`；
3. 重新加载回收站；
4. 如果真删除的是当前文档，context 会清空当前文档。

虽然按正常流程当前文档已移入回收站后不会打开，但 context 仍处理这个边界，避免未来 UI 路径变化后出现悬挂状态。

## 5. 渲染缓存 GC 控制

本轮顺带把后端 render cache GC 控制接进前端 GC 调试页。

服务层新增：

- `getRenderCacheGcStatus()`
- `sweepRenderCachePublishedReachability()`

UI 层新增能力：

- 展示 render cache 当前状态；
- 展示未发布、文档缺失、已删除、发布快照缺失、发布快照不可达、渲染版本过旧、块版本缺失等删除原因；
- 支持 dry-run；
- 支持 sweep；
- 复用 admin token 和 operatorId。

设计原则：

- 渲染缓存是派生数据，不应该和文档生命周期 UI 混在一起；
- 运维控制放在 GC Debug Modal；
- 普通用户只看到文档回收站；
- 管理员才操作 render cache sweep。

## 6. UI 细节

### 6.1 顶部 Drawer

关键样式：

- 背景使用 `var(--color-bg-layout)`；
- 卡片使用 `var(--color-bg-container)`；
- 8px radius，保持工具型 UI；
- 自动删除标签使用 error token，但不是大面积红色；
- 操作按钮右对齐，降低误触。

### 6.2 文档管理弹窗

原本弹窗回收站仍是一行一个文档。

本轮补：

- `doc-list__items--trash-grid`
- `doc-list__item-deadline`
- trash 模式卡片化；
- trash 模式同样显示自动删除剩余时间；
- trash 模式也支持真删除。

### 6.3 移动端

顶部 Drawer CSS 在窄屏下：

```css
grid-template-columns: 1fr;
```

工具栏纵向排列，搜索框占满宽度。

## 7. 本轮测试

已执行：

```powershell
pnpm exec vitest run src/components/__tests__/document-header-trash-drawer.source.test.ts src/components/__tests__/document-trash-drawer.source.test.ts src/components/__tests__/document-list-modal-lifecycle.source.test.ts src/components/__tests__/document-sidebar-trash.source.test.ts src/components/__tests__/gc-debug-modal.source.test.ts src/services/__tests__/document-diff-api.source.test.ts
pnpm exec tsc --noEmit --pretty false
```

结果：

- 6 个 source test 文件通过；
- 11 个测试通过；
- `tsc --noEmit` 通过。

本地开发服务：

- `http://localhost:3001` 已有进程监听；
- 本轮复用已有 dev server，没有重复启动。

## 8. 已知边界

当前还没有实现：

- 回收站按删除人过滤；
- 回收站批量恢复；
- 回收站批量真删除；
- 回收站按剩余天数排序；
- 真删除前输入文档标题确认；
- 浏览器级 E2E 截图验证；
- 自动删除后台任务的运行历史 UI。

当前 UI 已经能支撑手动生命周期操作，但还不是完整的回收站管理后台。

## 9. 实践经验

### 9.1 不要让前端猜服务端策略

自动删除剩余天数必须从后端来。

前端只展示：

```text
trashDaysRemaining
```

这样保留期变化不会造成多端不一致。

### 9.2 危险动作必须独立命名

软删除叫：

```text
移至回收站
```

硬删除叫：

```text
真删除
```

这两个词不能混用。

### 9.3 回收站不是普通列表

回收站文档需要展示：

- 原状态；
- 删除时间；
- 剩余时间；
- 恢复；
- 真删除。

如果仍然用普通一行列表，会浪费横向空间，也难以表达生命周期信息。因此卡片网格更合适。

### 9.4 管理控制和用户回收站分离

渲染缓存 GC 是运维/调试功能，不应该出现在普通回收站里。

本轮把它放在 `GcDebugModal`，符合职责边界：

- 文档回收站：用户生命周期操作；
- GC Debug：管理员清理派生缓存。

## 10. 建议提交范围

本次前端提交建议包含：

- `src/components/DocumentHeader.tsx`
- `src/components/DocumentTrashDrawer.tsx`
- `src/components/DocumentTrashDrawer.css`
- `src/components/DocumentListModal.tsx`
- `src/components/DocumentListModal.css`
- `src/components/DocumentSidebar/index.tsx`
- `src/components/GcDebugModal.tsx`
- `src/components/__tests__/document-header-trash-drawer.source.test.ts`
- `src/components/__tests__/document-trash-drawer.source.test.ts`
- `src/components/__tests__/document-list-modal-lifecycle.source.test.ts`
- `src/components/__tests__/document-sidebar-trash.source.test.ts`
- `src/components/__tests__/gc-debug-modal.source.test.ts`
- `src/contexts/DocumentContext.tsx`
- `src/services/document.ts`
- `src/services/gc.ts`
- `src/services/__tests__/document-diff-api.source.test.ts`
- `docs/superpowers/reviews/2026-06-08-document-lifecycle-ui-retrospective.md`

不建议包含：

- `next-env.d.ts`
- `diff.txt`

原因：

- 它们是工作区已有无关变更或临时文件，不属于本轮回收站/GC UI 交付边界。

## 11. 建议提交说明

建议提交标题：

```text
feat(documents): add trash lifecycle controls
```

建议提交正文：

```text
Add a top-level trash drawer, compact trash card UI, restore and permanent delete controls, and render-cache GC admin controls.

Surface server-provided trash deadline fields so the UI can show auto-delete countdowns without duplicating retention policy.

Docs:
docs/superpowers/reviews/2026-06-08-document-lifecycle-ui-retrospective.md
```

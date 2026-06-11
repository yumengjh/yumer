# 多端实时增量同步前端复盘

日期：2026-06-11
范围：`E:\workspace\editor-demo\app`

## 背景

这次实现的目标是让同一文档在多个标签页或设备中保持低延迟可见。写入仍走现有 `/blocks/batch`，服务端确认后通过 SSE 广播 canonical remote operations，前端只在本地 clean 且 `draftRevision` 连续时自动应用远端增量。

第一版不实现 CRDT / OT，不合并同时编辑。dirty、flushing、revision 不连续或 remote apply 失败时，前端进入冲突状态并重新加载完整内容。

## 本次改动

1. 新增 `src/services/realtime/identity.ts`，生成浏览器实例级 `originClientId` 和标签页级 `originTabId`。
2. 新增 `src/services/realtime/document-events.ts`，用 fetch-based SSE 复用现有 Bearer token 和刷新链路。
3. `/blocks/batch` 请求附带来源字段，提交端可忽略自己发起的 SSE 事件。
4. 新增 `src/services/sync/remote-ops.ts`，支持顶层 block 的 create / update / delete / move 增量应用。
5. `useDocumentSync` 接入 SSE：
   - same-origin event 直接忽略；
   - 本地 `idle`、无 dirty queue、无 inflight batch 且 revision 连续时 apply；
   - 其他状态触发冲突重载。
6. remote 成功同步不再弹成功提示；只有冲突、断续、apply 失败等异常路径提示用户。
7. realtime / remote 事件写入现有 `SyncTraceLog`，便于后续排查。

## 关键约束

- `saved` 只表示本地已对齐当前已知服务端状态；remote apply 成功后只静默更新 UI，不打断用户。
- 第一版 remote apply 只处理顶层 block。嵌套移动或无法定位父节点时 fallback reload。
- SSE 连接状态不作为高频 React state；连接对象和回调通过 ref 保持，避免文档编辑热路径额外重渲染。
- 本地非 clean 时不尝试合并，否则会绕开现有 draftRevision 冲突保护。

## 已验证

- `pnpm.cmd exec vitest run src/services/sync/__tests__/remote-ops.test.ts src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/api.test.ts`
- 本次前端改动文件的 `tsc --noEmit` 筛查无匹配错误。
- 手测：用户反馈多端同步功能正常。

## 已知边界

- 全量前端 `tsc --noEmit` 仍受既有 `src/modules/editor-kit/BlockToolbar/index.tsx(198,30)` 空值错误影响。
- 第一版没有事件补发日志；断线期间漏事件依赖 `previousDraftRevision` 检测并重载。
- remote apply 使用 JSON 层顶级 block 替换，不做 ProseMirror transaction 级粒度合并。

## 后续建议

1. 增加 `useDocumentSync` 层的 hook/source guard，覆盖 same-origin、dirty/flushing、revision discontinuity。
2. 若真实文档里嵌套 block 高频触发 fallback，再扩展嵌套 remote apply。
3. 将 realtime 事件显示到现有 sync debug modal，减少多端问题复现时的日志导出成本。

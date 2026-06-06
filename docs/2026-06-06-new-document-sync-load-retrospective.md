# 2026-06-06 新建文档刷新同步与加载竞态复盘

## 1. 背景

本轮问题发生在同步链路引入 checkpoint、manifest reconcile、空文档恢复能力之后。用户反馈的主流程是：

1. 创建一篇新文档。
2. 刷新页面。
3. 前端持续触发块 create/delete 请求。
4. 再次刷新后现象消失。

在第一轮修复无限同步后，又出现了“创建文档后偶发卡在编辑器骨架屏”的问题。两个问题表面不同，但都来自同一类根因：新文档从“文档元数据已切换”到“正文内容已加载并建立同步基线”之间存在竞态窗口。

## 2. 现象

### 2.1 刷新后无限 create/delete

刷新后，编辑器页面会先恢复当前文档，再异步加载 `/edit-content`。如果同步 hook 在正文真正加载前拿到了占位内容，或者空文档占位段落的身份在不同层各自生成，就会造成前端认为：

- 当前编辑器里有一个新块需要 create。
- 之前同步基线里另一个身份的块已经消失，需要 delete。

结果是 create/delete 在 autosync、ack patch、manifest reconcile 之间来回反馈。

### 2.2 创建后卡骨架屏

创建文档后，`createDoc` 已经会切换 `currentDoc` 并更新路由。但某些入口在 `createDoc` 之后又立刻调用 `onSelect(doc.docId)`。这会让同一篇文档被重复选择：

1. 第一次选择触发正文加载并打开 `loadingDoc`。
2. 第二次选择重置当前文档状态。
3. 旧加载 effect 被 cleanup 取消。
4. 新加载 effect 可能因为加载标记已提前写入而跳过。
5. `loadingDoc` 没有稳定收敛，编辑器一直显示骨架屏。

## 3. 根因链路

### 3.1 同步基线建立过早

`useDocumentSync` 之前直接接收 `tiptapContent`。而 `tiptapContent` 是 React state 的当前内容，不一定代表当前文档的服务端正文已经完成加载。

在新文档刷新场景里，`currentDoc`、`currentDocVersion`、`content` 三者不是原子更新：

- `currentDoc` 可以先恢复。
- `content` 仍可能是空白占位或上一轮状态。
- `loadContent` 稍后才返回真实正文和 sync session。

如果同步 hook 在这个窗口建立 snapshot，后续真实正文到达就会被当成本地编辑差异。

### 3.2 空文档占位段落身份不稳定

`loadDocumentContentV2` 对空文档返回：

```ts
{
  type: "doc",
  content: [{ type: "paragraph" }]
}
```

这个段落没有 `clientId`。但同步层和编辑器层都会补齐身份：

- `advanceSyncSnapshot` 会通过 `normalizeEditorDoc` 补身份。
- `MarkdownEditor` 的事务补丁也会补身份。

如果两边分别生成随机 `clientId`，同一个空段落就会在 diff 中变成两个不同块，从而制造 create/delete。

### 3.3 加载完成标记写入过早

编辑器加载 effect 原本在请求发起前写入：

```ts
loadedDocIdRef.current = docId;
```

这个标记语义上应该是“该文档正文已成功加载”，但实际被用成了“该文档加载已发起”。当同文档重选导致旧请求被取消时，新 effect 会看到该标记并直接 return，导致 loading 状态可能没有后续请求负责关闭。

### 3.4 创建入口重复选择同一文档

侧边栏创建入口原本执行：

```ts
const doc = await createDoc(...);
onSelect(doc.docId);
```

但 `createDoc` 内部已经完成：

- `setCurrentDoc(doc)`
- `setCurrentDocVersion(doc.head)`
- `pushWindowPath(doc.docId)`

后续 `onSelect(doc.docId)` 是重复选择，会放大加载竞态。

## 4. 修复

### 4.1 同步内容加加载门禁

`EditorPage` 新增 `loadedContentDocId`，只有当正文加载完成且属于当前文档时，才把内容交给 `useDocumentSync`：

```ts
const syncContent =
  currentDoc?.docId && loadedContentDocId === currentDoc.docId
    ? tiptapContent
    : null;
```

这样同步 hook 不会用占位内容或旧文档内容建立当前文档的同步基线。

### 4.2 空文档占位内容在服务层补身份

`createBlankTiptapDoc` 改为通过 `ensureDocumentIdentity` 返回身份稳定的空段落：

```ts
return ensureDocumentIdentity({
  type: "doc",
  content: [{ type: "paragraph" }],
}) as TiptapDoc;
```

这样 React content、编辑器实例、同步 snapshot 初始看到的是同一套 `clientId`。

### 4.3 加载完成后再标记已加载

`loadedDocIdRef.current = docId` 从请求发起前移动到 `loadContent(docId)` 成功返回之后。

这让 `loadedDocIdRef` 回到正确语义：只有正文确实加载成功，才跳过后续重复加载。

### 4.4 去掉创建后的二次选择

侧边栏两个创建入口都改为只调用 `createDoc`，不再额外 `onSelect(doc.docId)`。文档切换由 `createDoc` 统一负责。

## 5. 回归测试

本轮增加或调整了以下测试：

- `src/components/__tests__/editor-sync-load-gate.source.test.ts`
  - 要求同步 hook 使用 `syncContent`。
  - 要求 `loadedContentDocId` 在 `loadContent` 返回后才置为当前文档。
- `src/services/__tests__/document-edit-content.test.ts`
  - 覆盖空 tree 与无内容块时返回 identity-stable blank TipTap doc。
- `src/components/__tests__/document-sidebar-create.source.test.ts`
  - 防止侧边栏创建后再次 `onSelect(doc.docId)`。

验证命令：

```bash
pnpm exec tsc --noEmit
pnpm vitest run src/components/__tests__/document-sidebar-create.source.test.ts src/components/__tests__/editor-sync-load-gate.source.test.ts src/components/editorRouteHydration.test.ts src/services/__tests__/document-edit-content.test.ts
pnpm vitest run src/services/sync/__tests__ src/hooks/useDocumentSync.source.test.ts src/components/__tests__/manual-save-base-version.source.test.ts
```

结果：

- TypeScript 检查通过。
- 创建/加载相关定向测试通过。
- 同步相关 91 个测试通过。

## 6. 后续原则

1. `currentDoc` 只能表示当前文档元数据已切换，不能表示正文同步基线已建立。
2. 进入 sync hook 的内容必须显式绑定当前 docId，不能直接使用页面上的任意 `content` state。
3. 空文档也必须有稳定块身份，不能让编辑器层和同步层各自随机生成。
4. `loadedDocIdRef` 这类 ref 的命名和写入时机必须一致；“已加载”不能在“开始加载”时写入。
5. 创建文档的文档切换职责应集中在 `createDoc`，调用方不要再二次 `selectDoc`。

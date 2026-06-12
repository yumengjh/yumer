# 2026-06-12 内容同步 Playwright E2E 回归复盘

> 覆盖工作：Playwright E2E 基础设施、6 条同步高风险场景自动化、测试辅助逻辑修复、idle reconcile 小幅加固、dev/E2E 运行环境修复  
> 涉及仓库：`editor-demo/app`（前端）、`yumer-server`（后端，E2E 依赖真实 API）  
> 人工验收：2026-06-12，真实浏览器手工编辑验证通过

---

## 1. 背景

在 2026-06-11 同步稳定性加固（Phase 1～4）之后，单元测试与源码守卫已覆盖状态机分支，但**真实浏览器下的编辑 → 同步 → 刷新**链路仍缺乏自动化回归。历史上高频出现的故障模式包括：

- 批量粘贴/换行后刷新，块数或正文不一致；
- 全选删除后刷新，已删块复活（resurrected）；
- 弱网或 batch 延迟时，create + delete 竞态导致服务端 draft 残留 orphan 块；
- idle reconcile 在空 manifest 时被 digest 匹配错误跳过。

本轮目标：**搭建 Playwright E2E 回归套件**，覆盖上述高风险场景，并在搭建过程中顺带修复暴露出的 reconcile 边界问题。

---

## 2. 交付物概览

| 类别 | 内容 |
|------|------|
| E2E 框架 | `@playwright/test` 1.60.0、`playwright.config.ts`、`e2e/global-setup.ts` |
| 测试场景 | 6 条 sync E2E（4 个 spec 文件） |
| 辅助层 | API 注册/建文档、编辑器交互、同步等待、弱网延迟、服务端 snapshot 断言 |
| 产品修复 | `useDocumentSync` idle reconcile 空 manifest / orphaned create 加固 |
| 工程修复 | `next.config.ts` Turbopack root、`dev:webpack` 脚本、Playwright 产物 gitignore |
| npm 脚本 | `test:e2e:sync`、`test:e2e:install`、`dev:webpack` 等 |

---

## 3. E2E 架构

### 3.1 目录结构

```text
e2e/
  global-setup.ts           # 探测后端/前端，预热 bundle
  fixtures/
    sync-fixture.ts         # 每测独立 register → workspace → document → 注入 token
  helpers/
    api.ts                  # 注册、建文档、拉 edit-content snapshot
    editor.ts               # ProseMirror 交互、粘贴、全选删除
    sync.ts                 # waitForDraftSynced、manifest reconcile、incident 断言
    network.ts              # delaySyncBatchRequests（弱网模拟）
    server-poll.ts          # 服务端块文本 flatten、残留块检测
  sync/
    01-basic-persistence.spec.ts
    02-bulk-paragraphs.spec.ts
    03-select-all-delete.spec.ts
    04-weak-network.spec.ts
```

### 3.2 运行模型

- **单 worker 串行**：避免多测共用后端时的 workspace/document 竞态。
- **每测独立用户与文档**：`sync-fixture` 通过 API 注册 E2E 用户、创建工作区与空白文档，不污染彼此数据。
- **鉴权方式**：`addInitScript` 注入 `accessToken` / `refreshToken` / `currentWorkspaceId`，绕过 SetupModal 登录 UI。
- **同步 debug**：每测开启 `sync-debug-log-enabled`，失败时可查 trace / batch / incident。
- **webServer**：默认 `pnpm run dev:webpack`（端口 3001）；设 `PLAYWRIGHT_SKIP_WEBSERVER=1` 时可手动起前端。

### 3.3 环境依赖

| 服务 | 默认地址 | 启动方式 |
|------|----------|----------|
| 后端 API | `http://localhost:5200/api/v1` | `yumer-server` 仓库 `pnpm dev` |
| 前端 | `http://localhost:3001` | Playwright 自动起，或 `pnpm run dev:webpack` |

环境变量：

- `PLAYWRIGHT_API_BASE` — 覆盖后端地址
- `PLAYWRIGHT_BASE_URL` — 覆盖前端地址
- `PLAYWRIGHT_CHANNEL=chrome` — 使用本机 Chrome（推荐，避免额外下载 Chromium）
- `PLAYWRIGHT_SKIP_WEBSERVER=1` — 不自动启动前端
- `PLAYWRIGHT_SKIP_PREWARM=1` — 跳过 global-setup 中的 bundle 预热

---

## 4. 测试场景

| 文件 | 场景 | 断言要点 |
|------|------|----------|
| `01-basic-persistence` | 输入文本 → 同步 idle → 刷新 | 编辑器正文与服务端 draft 一致 |
| `02-bulk-paragraphs` | 粘贴 50 段 → 同步 → 刷新 | 块数 ≥ 50，首尾文本存在，无 duplicate create storm |
| `03-select-all-delete` (×2) | 30 段全删后输入新内容；100 段立即全删 | 刷新后仅保留预期内容或空文档 |
| `04-weak-network` (×2) | batch 延迟 400ms 下 create+全删；弱网清空后再输入 | 无 resurrected、无 orphan weak-N 块、无 sync incident |

**最后自动化结果**：6/6 passed（约 5.2 分钟，单 worker）。

---

## 5. 同步逻辑加固（`useDocumentSync.ts`）

E2E 暴露出的 reconcile 边界问题，做了三处小改：

### 5.1 空 manifest 不再因 digest 匹配跳过 reconcile

```typescript
// 仅 manifest 非空时才允许 digest 短路
if (serverDigest && localDigest === serverDigest && manifest.length > 0) {
```

**原因**：全删后本地与服务端 digest 可能同为「空文档」哈希，导致 idle reconcile 被跳过，弱网场景下服务端残留 create 无法清理。

### 5.2 orphaned create delete 后清空 reconcile 缓存

enqueue `orphanedCreateDeletes` 时重置 `lastReconciledManifestKeyRef` 与 `lastServerManifestDigestRef`，确保下一轮 idle 会重新对账。

### 5.3 空 manifest 二次 reconcile（延迟 5s）

首轮 idle reconcile 完成后，若 manifest 仍为空且队列无 pending batch，等待 5 秒后再 reconcile 一次。

**原因**：弱网/分批 ACK 时，首轮 idle 对账后服务端仍可能有延迟到达的 create，需要二次机会清理。

---

## 6. 工程与环境修复

### 6.1 Turbopack workspace root（`next.config.ts`）

monorepo 上层存在 lockfile 时，Turbopack 可能选错 workspace root，导致编辑器页卡在「正在打开编辑器…」。增加：

```typescript
turbopack: { root: path.resolve(__dirname) }
```

### 6.2 `dev:webpack` 脚本

E2E 的 `webServer` 使用 `next dev --webpack`，规避 dev 环境下 Turbopack 与 monorepo 的兼容问题。

### 6.3 Playwright 配置要点

- `workers: 1`、`fullyParallel: false`
- `video: "off"`（避免 Windows 缺 ffmpeg）
- `permissions: ["clipboard-read", "clipboard-write"]`（批量粘贴场景）
- `globalSetup` 探测后端/前端，不可达时 skip 全部 sync 测试并给出明确日志

### 6.4 `.gitignore`

忽略 `test-results/`、`playwright-report/`、`blob-report/`、`playwright/.cache/`。

---

## 7. E2E 搭建过程中发现的问题

### 7.1 测试辅助逻辑（非产品 bug）

| 问题 | 现象 | 修复 |
|------|------|------|
| 粘贴成功误判 | `text.includes("bulk-0")` 匹配到 `bulk-10` 等，粘贴不完整却提前 return | `pasteMultilineBlocks` 改为逐行精确校验 |
| 弱网残留块误判 | `startsWith("weak-")` 把 `weak-recovery-*` 当成 orphan | 改为 `/^weak-\d+/` |
| `insertText` 不触发 TipTap | 输入后编辑器无内容 | 改用 `keyboard.type` |
| `waitForDraftSynced` 过早返回 | 仅看「已加载最新版本」UI 文案 | 结合 UI 稳定 + sync debug batch 成功 |
| 前端未启动 | `ERR_CONNECTION_REFUSED :3001` | global-setup / fixture 给出明确指引 |

### 7.2 运行环境

- 后端未启动 → 6 条全部 skip（`PLAYWRIGHT_BACKEND_UNAVAILABLE=1`）
- 前端启动被中断（exit 4294967295）→ 需手动 `pnpm run dev:webpack` 或去掉 `PLAYWRIGHT_SKIP_WEBSERVER`
- 首次 dev 编译慢 → global-setup 预热 bundle，单测 `waitForEditorReady` 最长 120s

---

## 8. 如何运行

### 8.1 推荐（Playwright 自动起前端）

```powershell
cd E:\workspace\editor-demo\app
# 另开终端：cd E:\workspace\yumer-server && pnpm dev
$env:PLAYWRIGHT_CHANNEL = "chrome"
pnpm test:e2e:sync
```

### 8.2 手动起前端

```powershell
# 终端 1
cd E:\workspace\yumer-server; pnpm dev

# 终端 2
cd E:\workspace\editor-demo\app; pnpm run dev:webpack

# 终端 3
cd E:\workspace\editor-demo\app
$env:PLAYWRIGHT_SKIP_WEBSERVER = "1"
$env:PLAYWRIGHT_CHANNEL = "chrome"
pnpm test:e2e:sync
```

### 8.3 单文件调试

```powershell
pnpm exec playwright test e2e/sync/04-weak-network.spec.ts --headed
pnpm exec playwright test e2e/sync/02-bulk-paragraphs.spec.ts --reporter=line
```

首次运行需安装浏览器：`pnpm test:e2e:install`（或使用本机 Chrome + `PLAYWRIGHT_CHANNEL=chrome`）。

---

## 9. 人工验收

2026-06-12 真实浏览器手工测试：**功能一切正常**。自动化 6/6 与手工体验结论一致。

---

## 10. 尚未覆盖（后续可扩展）

- 多标签页 / 多设备同时编辑
- 拖拽排序（move）专项 E2E
- 图片块、表格块、嵌套列表
- CI 流水线集成（需同时 provision 后端 + 前端）
- 网络完全断连后的恢复与 conflict UI
- `draftRevision` mismatch 自动自愈的浏览器级验证

---

## 11. 变更文件清单（提交参考）

**新增**

- `playwright.config.ts`
- `e2e/**`（global-setup、fixtures、helpers、sync specs）

**修改**

- `package.json` / `pnpm-lock.yaml` — Playwright 依赖与脚本
- `.gitignore` — Playwright 产物
- `next.config.ts` — turbopack.root
- `src/hooks/useDocumentSync.ts` — idle reconcile 加固

**不应提交**

- `e2e-full-run.txt`、`e2e-last-run.txt`（本地测试输出）
- `test-results/`、`playwright-report/`（已在 gitignore）

**可选还原**

- `next-env.d.ts` — Next.js 自动生成，若与本次功能无关可 `git restore`

---

## 12. 结论

本轮在同步稳定性加固之后，补上了**真实浏览器 + 真实 API** 的 E2E 回归层，覆盖持久化、批量粘贴、全选删除、弱网竞态四类高风险场景。搭建过程中修复的 reconcile 边界与测试辅助 bug，使套件本身可作为后续 sync 改动的门禁。人工验收与自动化结果一致，具备提交条件。

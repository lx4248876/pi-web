# 项目骨架地图

## 元信息
- base_ref: fb33f9c
- 更新说明: 增量更新（基于 2026-08 会话列表 SSE 推送刷新 + API key 防脏值校验任务）。

## 目录职责
| 路径 | 一句话职责 |
|------|------------|
| `app/` | Next.js App Router：页面（`page.tsx` 主聊天页、`canvas` 不存在）与 `app/api/**` 服务端路由 |
| `components/` | React UI 组件（聊天、侧边栏、Git 面板、模型配置等） |
| `hooks/` | React hooks（`useAgentSession` 会话主 hook、`useSafeEdit`、`useHashline`、`useTheme`） |
| `lib/` | 后端/运行时逻辑：`rpc-manager.ts`（会话心脏）、`session-reader.ts`、`agent-new-flow.ts` 等 |
| `tests/` | 测试（`.mjs` 原生 + `.ts` 经 jiti） |
| `docs/` | 文档（开发指南、bug 报告、修复讲解页、specs 等） |
| `bin/` | `pi-web` CLI 入口 |
| `patches/` | patch-package 补丁（pi-ai 0.81.1） |
| `debug/` | 调试产物目录（gitignore，不入库） |

## 主入口
- 开发服务器：`npm run dev`（Next.js 端口 3030）
- 测试：`npm test`（`.mjs` 原生 + `.ts` 经 `node --import jiti/register`）
- 类型检查：`node_modules/.bin/tsc --noEmit`
- 安装补丁：`postinstall: patch-package`（应用 `patches/@earendil-works+pi-ai+0.81.1.patch`）
- 主要技能/约定：`AGENTS.md`（每轮加载）

## 关键链路
| 链路名 | 从哪进 | 主要落点 | 一句话 |
|--------|--------|----------|--------|
| 会话执行 | `/api/agent/new`、`/api/agent/[id]` | `lib/rpc-manager.ts`（`startRpcSession`/`AgentSessionWrapper`）→ SSE `[id]/events` → `hooks/useAgentSession.ts` | 经 RPC 包装 pi AgentSession，SSE 推事件到前端 |
| 会话浏览 | `/api/sessions/**`、`/api/sessions/events`（SSE，新增） | `lib/session-reader.ts`、`lib/rpc-manager.ts`（`notifySessionListListeners`→`onRpcSessionEvent`） | 只读 `.jsonl` 不 spawn 活跃 agent；列表现由服务器 SSE 推送即时刷新（后台会话/报错停止也会推） |
| 模型/Auth | `/api/models`、`/api/auth/*`、`/api/test-connection` | pi-ai `ModelRuntime`（0.81.1）、`lib/api-key-guard.ts`（新增） | 凭证/模型经 `ModelRuntime` 编排；api-key 保存先过 `validateApiKeyValue` 防脏值 |
| 调试产物 | 任意调试输出 | `debug/` | 日志/截图/录制统一写 `debug/`（gitignore） |

## 与任务级产物的边界
- 单次需求的文件表、base_ref 细表 → 写在 `docs/specs/<slug>/spec.md` 的 Code Map，不塞进本地图。
- 业务未立住时的业务理解 → `docs/discovery/**`，不塞进本地图。
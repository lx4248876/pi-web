# 项目骨架地图

## 元信息
- base_ref: e26a007
- 更新说明: 全量重扫重写（新增「待答问题」链路：pending-questions API + usePendingSessionIds 徽标；新增 TabBar/SkillMenu/FileIcons/pi-packages；根目录 scratch 已清理至 debug/；机器可读索引见 `docs/project-map.index.json`）。

## 目录职责
| 路径 | 一句话职责 |
|------|------------|
| `app/` | Next.js App Router：主聊天页 `page.tsx`（挂 AppShell）、两个演示页 (`hashline-demo`/`safe-edit-demo`)、`layout.tsx`/`globals.css`，以及 `app/api/**` 全部服务端路由 |
| `components/` | React UI 组件；`app-shell/`（TopBar/SidebarPanel/RightPanel/EmptyState/useResizablePanel）与聊天、Git、config、查看器、TabBar（右栏标签页）、SkillMenu（@技能菜单）、FileIcons（图标集）组件 |
| `hooks/` | React hooks：`useAgentSession`（会话主 hook）、`usePendingSessionIds`（待答徽标轮询）、`useTheme`、`useSafeEdit`、`useHashline`、`useAudio`、`useDragDrop` |
| `lib/` | 纯逻辑/后端助手：`rpc-manager.ts`（会话心脏）、`session-reader.ts`、`pending-dialogs.ts`（未答 question 缓冲）、类型定义、agent 请求/事件/工具组合等 |
| `tests/` | 测试（`.mjs` 原生 + `.ts` 经 jiti） |
| `docs/` | 文档：本图 + `adr/`（架构决策）+ `specs/`（需求 Code Map）+ `change-explainers/`（修复讲解）等 |
| `bin/` | `pi-web` CLI 入口（发布 `bin/pi-web.js`） |
| `patches/` | patch-package 补丁（`@earendil-works/pi-ai` / `pi-coding-agent` 0.81.1） |
| `debug/` | 调试产物目录（gitignore，不入库） |
| `public/` | 静态资源（svg 图标等） |

## 主入口
- 开发服务器：`npm run dev`（Next.js 端口 3030）
- 测试：`npm test`（`.mjs` 原生 + `.ts` 经 `node --import jiti/register`）；单测 `npm run test:one`
- 类型检查：`node_modules/.bin/tsc --noEmit`；Lint：`npm run lint`
- 安装补丁：`postinstall: patch-package`（应用 `patches/`）
- 会话/约定：`AGENTS.md`（每轮加载，含关键机器门禁）

## 关键链路
| 链路名 | 从哪进 | 主要落点 | 一句话 |
|--------|--------|----------|--------|
| 会话执行 | `/api/agent/new`、`/api/agent/[id]`、`[id]/events`(SSE) | `lib/agent-new-flow.ts` → `lib/rpc-manager.ts`(AgentSessionWrapper) → SSE → `hooks/useAgentSession.ts` | 经 RPC 包装 pi AgentSession，SSE 推事件到前端 |
| 会话浏览(只读) | `/api/sessions/**`、`/api/sessions/events`(SSE) | `lib/session-reader.ts`、`lib/normalize.ts`、`lib/rpc-manager.ts`(`notifySessionListListeners`) | 只读 `.jsonl` 不 spawn 活跃 agent；列表即时刷新 |
| 待答问题 | `/api/pending-questions`(4s 轮询) | `lib/rpc-manager.ts`(`getAllPendingDialogs`) → `/api/pending-questions` → `hooks/usePendingSessionIds.ts` → `SessionSidebar` | 有哪些会话挂着未答 question，侧边栏「待答」徽标；刷新后不丢、不跨会话跟随 |
| Git panel | `/api/git-status` | `components/GitPanel.tsx`、`components/app-shell/` | 仓库状态/提交/回滚；`quotePath=false` 解析(AGENTS 门禁) |
| 模型/Auth | `/api/models`、`/api/models-config`、`/api/auth/*`、`/api/test-connection`、`/api/.../test` | pi-ai `ModelRuntime`、`lib/models-config-test-connection.ts`、`lib/model-error.ts`、`lib/api-key-guard.ts` | 凭证/模型编排；api-key 保存先过脏值校验 |
| 文件/产物查看 | `/api/files/**`、`/api/artifacts/**`、`/api/blobs/[hash]` | `components/FileViewer.tsx`、`ArtifactDiffViewer.tsx`、`PremiumDiffViewer.tsx`、`ArtifactStrip.tsx`、`TabBar.tsx`(标签页)、`lib/html-preview-theme.ts` | 读盘/产物并行 diff/预览 |
| 技能/扩展管理 | `/api/skills(**/search,install)`、`/api/packages/**` | `components/SkillsConfig.tsx`、`PackagesConfig.tsx`、`lib/skills-cache.ts`、`lib/pi-packages.ts`、`lib/npx.ts`、`lib/pi-exec.ts`、`lib/subagent-live.ts` | 技能检索/安装、包管理、子代理事件 |
| Hashline 演示 | `app/hashline-demo/page.tsx`、`/api/hashline` | `components/HashlineDemo.tsx`、`hooks/useHashline.ts`、`lib/hashline-client.ts`、`lib/hashline-tool.ts` | 演示 @oh-my-pi/hashline 集成 |
| Safe-edit 演示 | `app/safe-edit-demo/page.tsx`、`/api/safe-edit` | `components/SafeEditDemo.tsx`、`hooks/useSafeEdit.ts`、`lib/safe-edit-guard.ts` | 演示用法/边界校验 |
| CWD/启动恢复 | `app/page.tsx` 初始化、`/api/browse-dirs`、`/api/default-cwd` | `lib/recent-cwds.ts`、`lib/cwd-selection.ts`、`lib/project-session-restore.ts`、`components/app-shell/SidebarPanel.tsx` | 最近 cwd/目录选择/上次会话恢复 |
| 系统操作 | `/api/home`、`/api/open-folder`、`/api/open-terminal`、`/api/ui-state` | `components/app-shell/TopBar.tsx`、`lib/ui-state.ts` | 打开工作区/终端/UI 状态持久化 |

## 关键链路文件详解

### 会话执行
- 入口: `/api/agent/new`、`/api/agent/[id]`、`/api/agent/[id]/events`
- 关键文件:
  - `lib/agent-new-request.ts` · 解析新建会话请求(provider/model/tools/cwd/promptCommand)与校验
  - `lib/agent-new-flow.ts` · 编排新建：生成 sessionId、调 startRpcSession
  - `lib/rpc-manager.ts` · 会话心脏：startRpcSession/AgentSessionWrapper、SSE 事件、pending-questions 权威集合、loop 检测、tool 定义与组合
  - `lib/pi-types.ts` · AgentSessionWrapper 相关类型
  - `lib/tool-composition.ts` · 组合当前可用 tools
  - `lib/question-options.ts` · 解析 question 的选项部分
  - `lib/pending-dialogs.ts` · 前端待投递弹窗缓冲（SSE 未建立时缓存后重放）
  - `lib/agent-client.ts` · 前端 POST `/api/agent/[id]` 的 fetch 封装
  - `lib/event-channel.ts` · 前端 EventSource 建/重连策略 + shouldReconnect
  - `lib/agent-message-merge.ts` · 合并/追加完成的助手消息
  - `lib/types.ts` · 会话/消息/树类型（被 lib 与前端共用）
  - `hooks/useAgentSession.ts` · 前端会话主 hook：状态机、SSE 订阅、命令发送
  - `components/ChatWindow.tsx` · 聊天 UI 容器（含产物关联）
  - `components/ChatInput.tsx` · 输入区（@技能菜单 SkillMenu、多行）

### 会话浏览（只读）
- 入口: `/api/sessions/**`、`/api/sessions/events`(SSE)、`/api/sessions/[id]/context`
- 关键文件:
  - `lib/session-reader.ts` · 读 `.jsonl` 会话文件（尾部窗口状态推导、listAllSessions、状态缓存）
  - `lib/normalize.ts` · 规范化工具调用/消息结构
  - `lib/rpc-manager.ts` · `notifySessionListListeners`/`onRpcSessionEvent` 推列表更新到 SSE
  - `components/SessionSidebar.tsx` · 会话列表面板（含「待答」徽标）

### 待答问题
- 入口: `/api/pending-questions`（GET，4s 轮询）
- 关键文件:
  - `lib/rpc-manager.ts` · `pendingExtensionRequests` 为未答 question 的权威集合，`getAllPendingDialogs()` 汇总
  - `app/api/pending-questions/route.ts` · 返回所有 live 会话的未答弹窗（按会话分组）
  - `hooks/usePendingSessionIds.ts` · 前端轻量轮询，产出有未答问题的会话 id 集合
  - `components/SessionSidebar.tsx` · 消费徽标（点进会话即答）

### Git panel
- 入口: `/api/git-status`（POST action: status/commit/rollback/branch/push 等）
- 关键文件:
  - `app/api/git-status/route.ts` · 执行 git 命令并回结果
  - `components/GitPanel.tsx` · Git 面板 UI（状态树、提交、回滚、冲突解决）

### 模型 / Auth
- 入口: `/api/models`、`/api/models-config`、`/api/models-config/test`、`/api/auth/*`、`/api/test-connection`
- 关键文件:
  - `lib/models-config-test-connection.ts` · 测试模型连接逻辑
  - `lib/model-error.ts` · 模型错误归一化
  - `lib/api-key-guard.ts` · `validateApiKeyValue` 防脏值校验后再保存
  - `components/ModelsConfig.tsx` · 模型配置 UI

### 文件/产物查看
- 入口: `/api/files/**`、`/api/artifacts/[sessionId]`、`/api/blobs/[hash]`
- 关键文件:
  - `app/api/blobs/[hash]/route.ts` · 按 hash 取产物 blob
  - `components/FileViewer.tsx` · 单文件查看
  - `components/ArtifactDiffViewer.tsx` / `PremiumDiffViewer.tsx` · 产物 diff（含图形化 diff）
  - `components/ArtifactStrip.tsx` · 会话产物条
  - `components/TabBar.tsx` · 右栏查看器标签页（文件/产物切换）
  - `lib/html-preview-theme.ts` · 产物 HTML 预览主题

### 技能/扩展/子代理
- 入口: `/api/skills`、`/api/skills/search`、`/api/skills/install`、`/api/packages/**`、`/api/subagents/[id]/events`
- 关键文件:
  - `lib/skills-cache.ts` · 技能列表缓存
  - `lib/pi-packages.ts` · pi 包元数据（解析/筛选/排序）
  - `lib/npx.ts` · npx 调用（检索/安装）
  - `lib/pi-exec.ts` · 执行 pi / npx 命令封装
  - `lib/subagent-live.ts` · 子代理实时事件流
  - `components/SkillsConfig.tsx` / `PackagesConfig.tsx` · 配置 UI
  - `components/SkillMenu.tsx` · @技能快速选择菜单（ChatInput 内）

## 与任务级产物的边界
- 单次需求的文件表、base_ref 细表 → 写在 `docs/specs/<slug>/spec.md`，不塞进本地图。
- 业务未立住时的业务理解 → `docs/discovery/**`，不塞进本地图。
- 修 bug 的讲解页 → `docs/change-explainers/**`，不入地图正文。

## 未覆盖/缺口
- `lib/` 少数工具（`useAudio`/`useDragDrop`/`FileIcons` 细节）只到目录级职责，未逐行展开（非主链路）。
- `app/api/hashline`、`app/api/safe-edit` 为实现只为演示链路，未对内做文件级展开。
- `app/api/packages/*` 各子路由（install/list-installed/remove/translate-desc）未逐一展开（同为技能/扩展链路，逻辑在 `lib/pi-packages.ts`）。
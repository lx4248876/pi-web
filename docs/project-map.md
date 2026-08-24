# 项目骨架地图

## 元信息
- base_ref: 4b9c0c8
- 更新说明: 全量重扫重写（本轮「大文件拆分」重构：SessionSidebar 3623→984 拆出 `components/session-sidebar/`；其余 8 个 >1000 行文件全部拆至子目录；`lib/` 新增 `clipboard.ts`/`agent-session-types.ts`/`rpc-pending-dialogs.ts`/`rpc-session-events.ts`；`hashline-tool.ts` 删除死导出；browse 目录类型上移 `lib/cwd-selection.ts`）。

## 目录职责
| 路径 | 一句话职责 |
|------|------------|
| `app/` | Next.js App Router：主聊天页 `page.tsx`（挂 AppShell）、两个演示页 (`hashline-demo`/`safe-edit-demo`)、`layout.tsx`/`globals.css`，以及 `app/api/**` 全部服务端路由 |
| `components/` | React UI 组件；根目录为各主面板（SessionSidebar/ChatWindow/ChatInput/MessageView/FileViewer/…），**子目录 = 大文件拆分产物**：`session-sidebar/`（8 文件）、`chat-input/`（5+1）、`chat-window/`（ExtensionUIDialog）、`file-viewer/`（4+1）、`message-view/`（blocks）、`models-config/`（8）、`packages-config/`（PackageDetail）；另有 `app-shell/`（TopBar/SidebarPanel/RightPanel/EmptyState/useResizablePanel/useModalRect） |
| `hooks/` | React hooks：`useAgentSession`（会话主 hook）、`usePendingSessionIds`（待答徽标轮询）、`useTheme`、`useSafeEdit`、`useHashline`、`useAudio`、`useDragDrop` |
| `lib/` | 纯逻辑/后端助手：`rpc-manager.ts`（会话心脏，含 AgentSessionWrapper）、`rpc-session-events.ts`（SSE 事件注册）、`rpc-pending-dialogs.ts`（未答弹窗权威扫描）、`agent-session-types.ts`（会话纯类型）、`session-reader.ts`、`pending-dialogs.ts`（前端缓冲）、`recent-cwds.ts`/`cwd-selection.ts`/`project-session-restore.ts`（cwd 链路）、`clipboard.ts`（copyText 去重）、`file-paths.ts`（路径规范化）、`compaction-override.ts`（压缩阈值换算）、`sidebar-width.ts`/`ui-state.ts`（UI 持久化）等 |
| `tests/` | 测试（`.mjs` 原生 + `.ts` 经 jiti）；覆盖会话状态恢复/死锁/待答重建等核心门禁 |
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
| 待答问题 | `/api/pending-questions`(4s 轮询) | `lib/rpc-pending-dialogs.ts`(`getAllPendingDialogs`) → route → `hooks/usePendingSessionIds.ts` → `session-sidebar/rows.tsx` | 哪些会话挂着未答 question，侧边栏「待答」徽标；重启后可重建 |
| Git panel | `/api/git-status` | `components/GitPanel.tsx`、`components/app-shell/` | 仓库状态/提交/回滚；`quotePath=false` 解析(AGENTS 门禁) |
| 模型/Auth | `/api/models`、`/api/models-config`、`/api/auth/*`、`/api/test-connection` | pi-ai `ModelRuntime`、`lib/models-config-test-connection.ts`、`lib/model-error.ts`、`lib/api-key-guard.ts`、`components/models-config/` | 凭证/模型编排；api-key 保存先过脏值校验 |
| 文件/产物查看 | `/api/files/**`、`/api/artifacts/**`、`/api/blobs/[hash]` | `components/file-viewer/`（DiffView/ImageViewer/AudioViewer/useFileWatch）、`ArtifactDiffViewer.tsx`、`PremiumDiffViewer.tsx`、`ArtifactStrip.tsx`、`TabBar.tsx`、`lib/html-preview-theme.ts` | 读盘/产物并行 diff/预览；SSE 实时刷新收敛为 useFileWatch |
| 技能/扩展管理 | `/api/skills(**/search,install)`、`/api/packages/**` | `components/SkillsConfig.tsx`、`PackagesConfig.tsx`+`packages-config/`、`lib/skills-cache.ts`、`lib/pi-packages.ts`、`lib/npx.ts`、`lib/pi-exec.ts`、`lib/subagent-live.ts` | 技能检索/安装、包管理、子代理事件 |
| Hashline 演示 | `app/hashline-demo/page.tsx`、`/api/hashline` | `components/HashlineDemo.tsx`、`hooks/useHashline.ts`、`lib/hashline-client.ts`、`lib/hashline-tool.ts`(仅客户端函数) | 演示 @oh-my-pi/hashline 集成 |
| Safe-edit 演示 | `app/safe-edit-demo/page.tsx`、`/api/safe-edit` | `components/SafeEditDemo.tsx`、`hooks/useSafeEdit.ts`、`lib/safe-edit-guard.ts` | 演示用法/边界校验 |
| CWD/启动恢复 | `app/page.tsx` 初始化、`/api/browse-dirs`、`/api/default-cwd` | `lib/recent-cwds.ts`、`lib/cwd-selection.ts`(含 BrowseDir 类型)、`lib/project-session-restore.ts`、`components/app-shell/SidebarPanel.tsx`、`components/session-sidebar/BrowseDialog.tsx` | 最近 cwd/目录选择/上次会话恢复 |
| 系统操作 | `/api/home`、`/api/open-folder`、`/api/open-terminal`、`/api/ui-state` | `components/app-shell/TopBar.tsx`、`lib/ui-state.ts` | 打开工作区/终端/UI 状态持久化 |

## 关键链路文件详解

### 会话执行
- 入口: `/api/agent/new`、`/api/agent/[id]`、`/api/agent/[id]/events`
- 关键文件:
  - `lib/agent-new-request.ts` · 解析新建会话请求(provider/model/tools/cwd/promptCommand)与校验
  - `lib/agent-new-flow.ts` · 编排新建：生成 sessionId、调 startRpcSession
  - `lib/rpc-manager.ts` · 会话心脏：startRpcSession/AgentSessionWrapper、loop 检测、compact 编排、pending 权威集合
  - `lib/rpc-session-events.ts` · 会话生命周期事件注册/推送(SSE 列表刷新等)
  - `lib/agent-session-types.ts` · 会话相关的纯类型/工具（useAgentSession 复用）
  - `lib/pi-types.ts` · AgentSessionWrapper 相关类型
  - `lib/tool-composition.ts` · 组合当前可用 tools
  - `lib/question-options.ts` · 解析 question 的选项部分
  - `lib/pending-dialogs.ts` · 前端待投递弹窗缓冲（SSE 未建立时缓存后重放）
  - `lib/agent-client.ts` · 前端 POST `/api/agent/[id]` 的 fetch 封装
  - `lib/event-channel.ts` · 前端 EventSource 建/重连策略 + shouldReconnect
  - `lib/agent-message-merge.ts` · 合并/追加完成的助手消息
  - `lib/types.ts` · 会话/消息/树类型（被 lib 与前端共用）
  - `hooks/useAgentSession.ts` · 前端会话主 hook：状态机、SSE 订阅、命令发送
  - `components/ChatWindow.tsx` · 聊天 UI 容器；`components/chat-window/ExtensionUIDialog.tsx` · 扩展 UI 弹窗
  - `components/ChatInput.tsx` · 输入区；`components/chat-input/` · 模型/工具下拉/上下文条/附贴图/统计条等子件

### 会话浏览（只读）
- 入口: `/api/sessions/**`、`/api/sessions/events`(SSE)、`/api/sessions/[id]/context`
- 关键文件:
  - `lib/session-reader.ts` · 读 `.jsonl` 会话文件（尾部窗口状态推导、listAllSessions、状态缓存）
  - `lib/normalize.ts` · 规范化工具调用/消息结构
  - `lib/rpc-manager.ts` · `notifySessionListListeners`/`onRpcSessionEvent` 推列表更新到 SSE
  - `components/SessionSidebar.tsx` · 会话列表面板(容器：状态/排序/持久化)
  - `components/session-sidebar/ProjectList.tsx` · 项目-会话树 + 拖拽排序 + 会话行渲染
  - `components/session-sidebar/rows.tsx` · SessionTreeItem/SessionItem/ArchivedSessionRow/SessionStatusDot
  - `components/session-sidebar/BrowseDialog.tsx` · “Add Project Directory”目录浏览弹窗(自包含)
  - `components/session-sidebar/SessionExplorer.tsx` · 分隔条 + FileExplorer 区
  - `components/session-sidebar/ArchivedDialog.tsx` · 归档会话弹窗
  - `components/session-sidebar/ConfirmHideDialog.tsx` · 关闭项目确认弹窗
  - `components/session-sidebar/utils.ts` · 会话树构建/路径/最近 cwd 纯函数
  - `components/session-sidebar/PiAgentTitle.tsx` · 侧栏标题组件

### 待答问题
- 入口: `/api/pending-questions`（GET，4s 轮询）
- 关键文件:
  - `lib/rpc-pending-dialogs.ts` · 未答弹窗扫描（`getAllPendingDialogs`/`unionPendingDialogs`/`FilePendingScanner`，从 rpc-manager 抽出）
  - `lib/rpc-manager.ts` · `pendingExtensionRequests` 权威集合 + 落文件重建
  - `app/api/pending-questions/route.ts` · 返回所有 live 会话的未答弹窗（按会话分组）
  - `hooks/usePendingSessionIds.ts` · 前端轻量轮询，产出有未答问题的会话 id 集合
  - `components/session-sidebar/rows.tsx` · 会话行待答徽标

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
  - `components/ModelsConfig.tsx` · 模型配置 UI 容器
  - `components/models-config/` · types/form/icons + ProviderDetail/ModelDetail/OAuthDetail/ApiKeyDetail/AddProviderPicker（从 ModelsConfig 拆出）

### 文件/产物查看
- 入口: `/api/files/**`、`/api/artifacts/[sessionId]`、`/api/blobs/[hash]`
- 关键文件:
  - `app/api/blobs/[hash]/route.ts` · 按 hash 取产物 blob
  - `components/FileViewer.tsx` · 文件查看容器
  - `components/file-viewer/DiffView.tsx` · diff 渲染
  - `components/file-viewer/ImageViewer.tsx` / `AudioViewer.tsx` · 媒体查看
  - `components/file-viewer/useFileWatch.ts` · SSE 实时刷新 hook（原 triplicate 逻辑收敛）
  - `components/file-viewer/format.ts` · 大小/时长格式化
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
  - `components/SkillsConfig.tsx` · 技能配置 UI
  - `components/PackagesConfig.tsx` · 包管理 UI + `components/packages-config/PackageDetail.tsx`
  - `components/SkillMenu.tsx` · @技能快速选择菜单（ChatInput 内）

### CWD/启动恢复
- 入口: `app/page.tsx` 初始化、`/api/browse-dirs`、`/api/default-cwd`
- 关键文件:
  - `lib/recent-cwds.ts` · 最近 cwd 持久化/合并
  - `lib/cwd-selection.ts` · 目录校验/选择；含 `BrowseDirEntry/Response` 类型（从 SessionSidebar 上移）
  - `lib/project-session-restore.ts` · 上次会话恢复
  - `components/session-sidebar/BrowseDialog.tsx` · 目录浏览弹窗（fetch `/api/browse-dirs`）
  - `components/app-shell/SidebarPanel.tsx` · 侧栏容器

## 大文件拆分说明（本轮结构变化)
- 9 个 >1000 行源文件 → 7 个 <1000；`lib/rpc-manager.ts`(1632→1445) 与 `hooks/useAgentSession.ts`(1560→1366) 已抽纯部分（事件注册/待答扫描/纯类型），剩余为会话状态机核心，**按 AGENTS.md 铁律不再强拆**（只抽纯函数，不重构状态机逻辑）。
- 新文件一律走「纯搬移 + import 调整」，无逻辑重写；拆出组件的 re-export/消费者见各子目录。

## 与任务级产物的边界
- 单次需求的文件表、base_ref 细表 → 写在 `docs/specs/<slug>/spec.md`，不塞进本地图。
- 业务未立住时的业务理解 → `docs/discovery/**`，不塞进本地图。
- 修 bug 的讲解页 → `docs/change-explainers/**`，不入地图正文。

## 未覆盖/缺口
- `components/` 根部非主链路 UI（ChatMinimap/TodoPanel/ToolPanel/BranchNavigator/AtMentionMenu/FileIcons/FileExplorer 细节）只到目录级职责，未逐文件展开。
- `app/api/hashline`、`app/api/safe-edit` 为实现只为演示链路，未对内做文件级展开。
- `app/api/packages/*` 各子路由（install/list-installed/remove/translate-desc）未逐一展开（同为技能/扩展链路，逻辑在 `lib/pi-packages.ts`）。
- `components/chat-input/` 内部各子件（ModelDropdown/ToolPresetDropdown/ContextUsageBar/AttachedImagesStrip/SessionStatsBar/constants）未逐一列（会话执行链路内子件，可查 `components/chat-input/`）。
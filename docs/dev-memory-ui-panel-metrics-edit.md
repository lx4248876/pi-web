# 开发记忆：文件面板弹窗 / 文件编辑 / 指标统计移位（2026）

> 承接一次针对 **右侧文件/Git 查看面板 → 可拖动弹窗**、**文件查看器支持编辑**、**token/context 统计从顶栏移到输入区** 的改造。记录关键实现事实与易踩坑点，避免后续改动破坏。

## 1. 右侧文件/Git 面板改为可拖动弹窗

位置：`components/app-shell/RightPanel.tsx`（改前是占用布局的右侧栏，带左右 `useResizablePanel` 拖宽）。

- 现在的形态：`position: fixed` 的半透明遮罩 + 居中浮层弹窗（`z-index: 1100`）。
- **宽高与位置都由组件自管理**：标题栏拖动位移、右下角手柄调大小，矩形持久化到 `localStorage` key **`pi-web:file-modal-rect`**（`{x,y,width,height}`），下次打开恢复；每次渲染用 `clampRect()` 夹回视口（窗口缩放也不会跑丢）。
- 关闭：遮罩点击 / 标题栏 ✕ / **Esc**。注意 Esc 有"焦点在 input/textarea 内不关弹窗"的保护（避免文件编辑时误关）。
- `AppShell.tsx` 里旧的 `rightPanel` `useResizablePanel` 已删除（尺寸改由 `RightPanel` 自理），`TopBar` 不再接收 `rightPanelInset` / `sessionStats` / `contextUsage`。
- 底部旧 CSS `.right-panel-container` 已从 `globals.css` 移除（弹窗用全内联样式）。

## 2. 文件查看器支持编辑（读 → 读写）

- 后端：`app/api/files/[...path]/route.ts` 新增 **`POST`** 写文件端点（body `{ content }`），复用与 `GET` 相同的会话 cwd 白名单校验（`getAllowedRoots` + `isPathAllowed`），带 5MB 上限。此前该路由只有只读 `GET`。
- 前端：`components/FileViewer.tsx` 的 `TextFileViewer` 新增 **Edit / Save / Cancel**（状态栏按钮）、可编辑 `<textarea>`；快捷键 **Ctrl/Cmd+S 保存、Esc 退出编辑**。保存走 `POST /api/files/<path>`。`editDirty` 显示未保存 ●。
- 数据刷新仍靠原有 SSE `?type=watch`；SSE 的 `change` 会 `fetchContent(filePath, true)` 并记录 `prevContent` 供 Diff 使用。

## 3. 顶部统计移位到输入区；context 改炫彩霓虹条

- **之前** `sessionStats` / `contextUsage` 由 `ChatWindow` 上抬到 `AppShell`，再下发 `TopBar` 在其右上显示 token/费用/context%。
- **现在**：移除整条顶栏统计与 `AppShell`/`TopBar`/`ChatWindow` 的上抬管道；`ChatWindow` 直接从 `useAgentSession` 拿 `sessionStats`、`contextUsage` 传给 `ChatInput`。
  - `TopBar` 仍导出 `SessionStatsData` / `ContextUsageData` 类型（`ChatInput` 从这里 import）。
  - token 统计（`↑in ↓out 缓存% cost`）渲染在 `ChatInput` 底部工具栏**模型选择器右侧**（`fmtStats` 千位缩写）。
  - context 用量是一条约 4px 高的**炫彩霓虹渐变细线**（青→紫→品红→橙，`components/ChatInput.tsx`），**hover 时在进度条内部展开显示数值** `25% · 31k/128k`，带扫描流光（`@keyframes cyber-scan`，定义在 `app/globals.css`）。
- ⚠️ **contextUsage 数据源只在 agent 运行时可用**：`getContextUsage()` 来自激活会话的内存取用统计，静态加载的完成会话取不到 → 空轨道 + "context —"。`sessionStats` 则是从各 assistant 消息的 `usage` 本地累加，任何会话都能显示。若需静态会话也能算 context%，需要前端从消息 `usage.input` + 模型 `contextWindow`（`/api/models-config` 里有）自行推导——尚未实现。

## 其他易忘点

- 聊天统计、模型选择、context 条都在 `ChatInput` 内；改布局时注意它外层 `paddingRight: 52`（给 ChatMinimap 让位）。
- 弹窗 Esc 与文件编辑 Esc 共用同一 keydown 通道，靠"目标元素是 input/textarea/contenteditable 就不关"区分。
# pi-web 全面 Bug 排查报告

> 排查方式：debug 技能。子代理（debug-recon）因 harness 工具注入失败（代理定义含 Read/Grep/Glob/Bash，但运行时只挂了 contact_supervisor/intercom），**降级为主代理同一上下文自查**，质量要求未降。不修改代码，只排查。

## 问题摘要

- **症状**：对项目整体做一次 bug 扫描（非单一报告 bug）。
- **频率**：分布在不同模块，多为条件触发。
- **已知表层证据**：测试套件 1 挂；dev 日志含 workflow SSE 500 与 React Flow 警告。
- **影响范围**：会话链路 / SSE / 前端 hook / Auth-Models 迁移。

## 逐条发现（按证据等级排序）

### 🔴 已确认

#### B1. `tests/extension-ui-buffer.test.ts` 无法运行（测试基础设施）
**证据**：`node --test` 输出 `Error [ERR_MODULE_NOT_FOUND] Cannot find module 'lib/rpc-manager' imported from tests/extension-ui-buffer.test.ts`。该测试在第 7 行 `import { startRpcSession } from "../lib/rpc-manager"`（直接 import 无扩展名的 TS 源），但项目没有安装 jiti/tsx/ts-node 等 TS loader（`package.json` devDeps 无），`node --test` 走原生 ESM 解析，解析不了 `.ts`。
**影响**：commit `398cd0d` 专门为「extension_ui_request 弹窗缓存回放」加的测试，永远跑不起来 → 该缓存/回放逻辑（`rpc-manager.ts` 的 `emit`/`onEvent`/`eventBuffer`）**没有被任何自动化覆盖**。手动读代码该逻辑是正确的，但没有测试兜底。
**自洽**：✅ 根因（无 TS loader）→ 现象（ERR_MODULE_NOT_FOUND）匹配。

### 🟠 高置信（正在进行的 pi-ai 0.79.1→0.81.1 迁移引入，未提交工作区）

#### B2. `set_model` 回退路径触发**无超时的网络模型刷新**
**证据**：`lib/rpc-manager.ts:830-835`：
```ts
if (!model) { await runtime.refresh(); model = runtime.getModel(provider, modelId); }
```
`ModelRuntime.refresh` 未传 options 时 `allowNetwork = options.allowNetwork ?? this.modelNetworkEnabled`，`modelNetworkEnabled = process.env.PI_OFFLINE === undefined`（默认 **true**）→ `await runtime.refresh()` 对全部 OAuth provider 走网络刷新，且此调用**没有传 signal/超时**。
**新旧对比**：旧代码 `if (typeof registry.refresh === "function") registry.refresh()` 是**不 await 的 fire-and-forget**。迁移后变成 await + 网络 + 无超时。
**影响**：当选中模型不在会话 runtime 的缓存快照时（本地离线、目录被代理拦截、模型目录刷新慢），模型切换请求可能**阻塞或 hang**，`POST /api/agent/[id]` 返回 500 → 前端「Failed to set model」。离线环境（PI_OFFLINE 未设）下风险最大。
**反事实**：若是此根因，应观察到：当模型首次切换且需网络刷新时延明显变慢/超时；`models.json` 里已列出的模型（快照内）切换正常。→ 与代码一致。

#### B3. `handleAgentEvent` 对 `handleSend`/`currentModel` 的**闭包过期**
**证据**：`hooks/useAgentSession.ts`: `handleAgentEvent` 依赖数组为 `[loadSession, onAgentEnd]`，但函数体用到 `handleSend`（在 `message_end` 自动重试分支）与 `currentModel`（`error` 分支）。`handleAgentEventRef.current = handleAgentEvent` 在每次渲染重新赋值，但 `handleAgentEvent` 自身是稳定的（deps 不变）useCallback → ref 持有一份**首渲染闭包**。
**影响**：自动重试 `handleSend("继续")`：
- 用的是首渲染的 `isNew` / `newSessionCwd` / `agentRunning` / `toolPreset`（迁移变量）。若首渲染是新建模式后切换到已有会话，重试会朝错误的 uid 发命令或走错分支。
- `error` 分支的 `currentModel` 也是旧值（错误消息里模型名可能恒为某次旧模型）。
**现象/频率**：偶发，依赖 provider-error 重试路径被触发。

#### B4. `message_end` 自动重试「继续」大概率被 `agentRunning` 拦截
**证据**：`hooks/useAgentSession.ts` `message_end` 里检测到 `Provider finish_reason: error` 后 `setTimeout(()=>handleSend("继续"),1000)`；而 `handleSend` 首行 `if (agentRunning) return;`。`message_end` 触发时 `agentRunning` 仍为 **true**（要到 `agent_end` 才 false）。只有 `agent_end` 恰好在 1s 内到达时重试才生效。
**影响**：这条「provider 错误自动重试」特性**实际基本失效**（时序偶发），表现与 B3 闭包叠加，行为不可预期。
**反事实**：若 root 成立，provider 报错后多数情况看不到真正的自动「继续」重试消息。

### 🟡 候选（需运行时确认）

- **B5 `setWidget` 静默丢弃字符串内容**：`lib/rpc-manager.ts:460-470` `if (content === undefined || Array.isArray(content))` 才 emit——**纯字符串内容被丢弃**。且前端 `handleAgentEvent` 没有任何 `setWidget` 分支（仅 dialog/notify/set_editor_text/setTitle），widget 功能端到端未实现，前端收到也渲染不出来。
- **B6 `bindExtensions` 失败泄漏会话**：`lib/rpc-manager.ts` `startRpcSession` 的异步 IIFE 中 `createAgentSession` 成功后 wrapper 已建、`.start()` 已调用，随后 `bindExtensions(...)` 若抛错 → IIFE reject、锁移除，但 `inner`/`wrapper` **未 destroy、未注册进 registry**：进程级泄漏 + 该 session 文件可能已被打开。
- **B7 新会话 tempKey 毫秒级碰撞**：`lib/agent-new-flow.ts` `tempKey = __new__${Date.now()}`——同一毫秒内并发两个「新建会话」请求会撞同一个锁/键，第二个拿到第一个的 session（错误 cwd、错误返回值）。
- **B8 `get_state` 硬编码计数**：`lib/rpc-manager.ts` `get_state` 返回 `messageCount:0, pendingMessageCount:0`（未实现，可能影响前端展示）。
- **B9 `editor()` 弹窗无超时/信号**：`createExtensionUIContext().editor` 传 `undefined` opts → 前端始终不响应会导致模型永久挂起（其他 dialog 有 timeout）。

### ⚪ 次要
- **B10 `readQuestionRequest`** 对 `normalizeUiOptions(params.options)` 计算两次（纯性能，无害）。
- **B11** `components/GitPanel.tsx` `fetchGitStatus` 计算了 `currentFiles` 但未使用（死代码）。

## 已核实为正确的路径（排除）

- **workflow/canvas 相关报错全部排除**：`pi-web-dev.err.log` 里 `lib/workflow-runtime.ts:102` TypeError、`GET /api/workflows/*/events 500`、`POST /api/workflows 500`、React Flow 警告，均来自被 `git reset` 丢弃的 merge commit `df601a1`（upstream v0.7.17 引入的 workflows 功能）。当前 HEAD(`f5e2e19`) 与 `.next` 里**不存在** `app/api/workflows`、`lib/workflow-runtime.ts`、`/canvas`。日志是陈旧产物。
- **`useAgentSession` 里 `[]` 依赖的 session 加载 effect**：`ChatWindow` 以 `sessionKey` 为 key 每次会话切换/新建都会 **remount**（`AppShell.tsx:393`），故 effect 只跑一次是正确设计，**不是 bug**。
- **extension_ui_request 弹窗缓存/回放逻辑**：`emit`（无监听器时缓存 dialog）与 `onEvent`（新监听器回放 + 最后监听器断开时回收 pending 请求）逻辑正确（但测试跑不了，见 B1）。
- **git-status 解析**：`git -c core.quotePath=false status -s`，`line.slice(0,2)` 取两位前缀、不提前 trim，符合 AGENTS.md。
- **checkedFiles 求交集**：刷状态时按最新 modifiedFiles 重建，残留勾选项会被清除，正确。
- **删除全部会话后保留项目**：删会话后 `if (!hiddenCwds[cwd]) rememberCwd(cwd)`。

## 已确认无问题的检查

| 检查 | 结果 |
|------|------|
| `tsc --noEmit` | ✅ 通过 |
| `node --test` | ✅ 19/20，唯一失败见 B1 |
| 迁移 API 契约 | Regex：`ModelRuntime.create/getProviders/getProvider/listCredentials/login/logout/stream/completeSimple`、`AuthInteraction/AuthEvent/AuthPrompt` 全部在已装的 0.81.1 `.d.ts` 中匹配 |
| `ModelRuntime.create()` 默认不触发网络（`allowModelNetwork` 默认 false） | ✅ |
| API-key/OAuth 登录路径、auth.json 路径（仍 `getAgentDir()/auth.json`） | ✅ |
| fork 后 destroy stale wrapper | ✅ `rpc-manager.ts` fork 分支 `this.destroy()`，符合 AGENTS.md |

## 证据链（Coverage - 主代理自查 6 跳）

| 跳 | 状态 | 证据 |
|----|------|------|
| 1. 入口 | ✅ | `/api/agent/new`→`agent-new-flow.ts`；`/api/agent/[id]`→`startRpcSession`；SSE `/events` |
| 2. 控制流 | ✅ | `rpc-manager.ts` `__piSessions`/`__piStartLocks` lock+registry，`send()` switch |
| 3. 核心逻辑 | ✅ | `AgentSessionWrapper`（emit/onEvent/buffer/loop detect）；`useAgentSession` SSR 事件→state |
| 4. 数据/契约 | ✅ | `pi-types.ts` `AgentSessionLike` 对 0.81.1 `modelRuntime`；Event 类型 |
| 5. 依赖/持久化 | ✅ | pi 0.81.1 `ModelRuntime`；`session-reader`/.jsonl；auth.json |
| 6. 出口/副作用 | ✅ | `[id]/events` SSE、`destroy()`、fork 清理、git-status |

## 复现路径

- **B1**：`cd C:\A-codes\lix\pi-web && node --test tests/extension-ui-buffer.test.ts` → 立即 ERR_MODULE_NOT_FOUND。
- **B2**：离线（不设 PI_OFFLINE）下对一个不在会话 runtime 快照中的模型执行 `set_model` → 观察请求阻塞/超时或 500。
- **B3/B4**：触发 provider error（stopReason=error）+ `Provider finish_reason: error`，观察是否真正发出「继续」重试、目标 session 是否正确。

## 修复建议方向（不写代码，交 run 的 TDD）

- **B1**：给该项目引入一个能跑 TS 测试的 runner（如 `tsx`/`jiti`），或把 `extension-ui-buffer.test.ts` 改为 `.mjs` 并用 `tsc` 转译 + vm（与其它 `.mjs` 测试一致）。跑通后再验证 B-replay 逻辑。
- **B2**：`set_model` 回退改用 `runtime.getAvailable()`/本地快照刷新，或传 `allowNetwork:false` / 带超时 signal，避免无超时网络刷新；必要时对照旧 fire-and-forget 语义。
- **B3**：把 `handleSend`/`currentModel` 补进 `handleAgentEvent` 依赖数组，或用 ref 持有最新回调（如 `handleSendRef.current`）。
- **B4**：自动重试应等 `agent_end`（agentRunning=false）后再发，或改为直接调 `sendAgentCommand` 而非经守卫的 `handleSend`。
- **B5**：`setWidget` 补字符串/任意内容分支并加前端渲染处理，或删掉多余条件。
- **B6**：`startRpcSession` 加 try/catch，`bindExtensions` 失败时 `wrapper.destroy()` + `inner.abort()`。
- **B7**：改用 `crypto.randomUUID()`/随机后缀作为 tempKey。
- **B8-B10**：低优先，按需。

## 移交修复
排查完成。每条约了证据位置；未改任何代码。建议先 B1（打通测试）、B2/B3/B4（会话运行时风险）进入 run 的 TDD 流程；B5-B10 按优先级处理。若需要我针对某一条再补深读或拟失败测试，请说。

---

## 修复状态（2026-08-13）

在隔离分支 `fix/audit-b1-b11` 完成。全程未破坏应用主依赖；修复期间因运行中的 `next start`(30141) 锁住 swc 导致 node_modules 部分包被剪除，已停该进程后 `npm ci --ignore-scripts` 恢复一致，并重新应用 0.81.1 patch（jiti 已登记为 devDependency）。

**已修复（验证通过：tsc + 19 mjs + 1 ts）**
- B1：新增 jiti devDep + `npm test` 脚本（mjs 原生 / ts 用 jiti），`extension-ui-buffer.test.ts` 现可运行且通过（此前的弹窗缓存回放逻辑已 Green，且新增对 agent-new-flow 的 `node:crypto` require stub 配套）。
- B2：`lib/rpc-manager.ts` set_model 回退刷新改为 `await runtime.refresh({ allowNetwork: false })`，消除“无超时联网刷新卡死”；`lib/pi-types.ts` 的 `modelRuntime.refresh` 签名同步为可带 `{ allowNetwork? }`。
- B3+B4：`hooks/useAgentSession.ts` 增加 `handleSendRef`/`currentModelRef` 消除闭包过期；自动重试“继续”经 `handleSendRef.current?.("继续", undefined, { bypassRunning: true })` 绕过 `agentRunning` 守卫，真正可发送。
- B6：`lib/rpc-manager.ts` startRpcSession 对 `bindExtensions` 包 try/catch，失败时 `wrapper.destroy()` + `inner.abort()` 再抛，防孤儿会话泄漏。
- B7：`lib/agent-new-flow.ts` tempKey 改用 `randomUUID()`（防同毫秒并发撞单）。
- B11：`components/GitPanel.tsx` 删除未使用 `currentFiles`。

**排除（非 bug，附依据）**
- B5：`setWidget` 契约类型为 `string[] | undefined`（`core/extensions/types.d.ts`），条件正确；前端不渲染 widget 属功能未实现而非 bug。
- B8：`get_state` 的 `messageCount` 前端不消费。
- B9：`editor()` 无超时系设计（内容编辑需长时间）。
- B10：重复纯计算，无行为差异。

**验证**：`tsc --noEmit` ✔；`npm test` 19+1 全过 ✔；改动文件 lint 未新增问题。

**说明**：子代理 worker/reviewer 因 harness 工具注入失败（同 debug-recon），由主代理实现 + 自查，门禁不降；B2/B3/B4/B6 依赖 session runtime，自动化难以直接冒烟，以 tsc+审查+契约核对兜底（TDD 局限已如实记录）。
# pi-web 全库审查报告（2026-10）

- 审查方式：只读静态深读 + 实测命令（`npm ci` 后基线 `tsc --noEmit` exit 0；pi 1.4.0 类型探针 4 错）
- 工作区影响：第一阶段零改动；证据产物在 `debug/`（gitignore）
- 修复进度见文末「状态」

## 产品画像与适用性裁剪

- 形态：单机本地工具（Node 进程 + Next 16 App Router + React 19），后端 = `app/api/**` Route Handler 进程内包 pi SDK，SSE 推事件；会话文件在 `~/.pi/agent/sessions/`。
- 适用域：本地凭据/模型编排、会话状态与持久化、SSE 通道、插件（扩展/技能/包/子代理）、路径与命令执行面。
- **跳过域**（不适用，避免过度设计）：多租户、支付/计费、SAML/SCIM、serverless 适配、分布式一致性、CSRF token（以回环绑定 + Host/Origin 白名单替代）。

## 一、pi 版本（0.81.1 → 1.4.0）

实测：`node node_modules/typescript/bin/tsc --noEmit`（0.81.1）→ exit 0；映射 pi 1.4.0 类型后同一份源码 → 4 错（`debug/pi14-typecheck.log`）。

| # | 位置 | 变化 | 影响 |
|---|---|---|---|
| U1 | `lib/rpc-manager.ts:1367` | `AgentState.systemPrompt` 只读 | 「Off 预设清空系统提示词」失效 |
| U2 | `lib/pi-types.ts:34-38`、`lib/rpc-manager.ts:1011` | `ModelRuntime.reloadConfig()` 已被删除（0.81.1 `model-runtime.d.ts:76` 有） | 切模型/模型配置刷新 → 运行时 TypeError |
| U3 | `tests/question-tool-trigger.test.ts:57,121` | 工具 ctx 变 `ExtensionToolContext`（+`tools`/`executeTool`） | 测试与 `createCompatUiTools` 签名跟进 |
| U4 | `patches/*0.81.1.patch` | MSYS 补丁上游已修（1.4.0 `dist/utils/paths.js:49-53`）；Gemini thoughtSignature 继承仍缺 | 删一个、重生成一个；patch 名钉死版本 + `patches/` 不在 `files` |

tsc 抓不到但必须验收：`lib/tool-composition.ts:27-42` 的 7 工具白名单会把 `powershell` 与内置扩展（codemode/tool_search/mcp__*）当"扩展工具"自动启用；azure provider 改名（1.0.3）；1.2.0 起"run 启动即 busy"的排队语义；事件面新增 `agent_settled`/`entry_appended`/`session_info_changed` 等。

## 二、结构（Top 风险）

| # | 级别 | 位置 | 风险 |
|---|---|---|---|
| S1 | P0 | `bin/pi-web.js:39-48` vs `docs/adr/0004-security-and-permissions.md:20` | 默认不绑回环却声称只监听 127.0.0.1 → 局域网可达 |
| S2 | P0 | `app/api/git-status/route.ts:123/136/158/173/175/224/256/293/311/324` | `execSync` 字符串拼接（cmd 下 `\"` 非转义）→ 命令注入 |
| S3 | P0 | `app/api/skills/route.ts:29-53`、`git-status/route.ts:338`、`app/api/safe-edit/route.ts:44`、`app/api/hashline/route.ts:24/34/46` | 任意路径读写（无根约束） |
| S4 | P1 | `hooks/useAgentSession.ts:1188` + `app/api/agent/[id]/events/route.ts:25-33` | 打开历史会话即启动常驻 agent，违反"browse-only 不 spawn"铁律 |
| S5 | P1 | `app/api/browse-dirs/route.ts:99-102` | 白名单判断是空 if 块（看似闸门实则放行） |
| S6 | P1 | `app/api/git-status/route.ts:11` 与 `:333` | 同一请求 `req.json()` 两次 → 「按段回滚」必 500，掩盖 S3 |
| S7 | P1 | `lib/rpc-manager.ts:488-492` + `events/route.ts:37-47` | `emit`/`encode` 无 try/catch → 监听器抛错回溯进 SDK 分发、丢帧、泄漏监听 |
| S8 | P1 | `hooks/useAgentSession.ts:341-344,363` | SSE 重连不回补状态，窗口内事件永久丢失 |
| S9 | P2 | 8 文件 10 处 `ModelRuntime.create()`/`new ModelRegistry` | 升级/排障面放大，`app/api/models/route.ts:53` 静默吞错返回空 |
| S10 | P2 | `lib/rpc-manager.ts` 1445 / `hooks/useAgentSession.ts` 1366 / 13 个 >600 行文件；components 46 处裸 fetch | 改一处要跨文件确认闭包与错误风格 |

## 三、插件/扩展子系统

| 子系统 | 完整度 | 缺口 |
|---|---|---|
| 扩展 UI 通道 | 半成品 | `setStatus`/`setWidget` 后端发、前端无 case（`useAgentSession.ts:612-636`）→ 假能力 |
| 弹窗跨重启恢复 | 半成品 | 只认 `question`（`session-reader.ts:635`）；`ctx.ui.*` 直弹重启即丢 |
| 扩展启动守卫 | 半成品 | 仅 `session_start`/`resources_discover` 有 5s 超时（`rpc-manager.ts:145-178`） |
| skills | 可用有洞 | PATCH 任意路径写；安装成功靠输出正则（`skills/install/route.ts:27`） |
| packages | 半成品 | 无安装后复核、无并发锁、运行中会话不加载新扩展（只在 `createAgentSession` 装载） |
| MCP | 零实现 | `@modelcontextprotocol/sdk` 零引用，仅规划文档 |
| subagents | 半成品 | 纯尾读、按下标切片、终态即停、无控制面 |
| hashline | 演示 | 主链路零引用；每次请求新建快照库 → tag 跨请求失效 |
| safe-edit | 演示 | `node_modules/.bin/tsc` + 废弃 `next lint`（`safe-edit-guard.ts:186,208`），失败回滚但 HTTP 仍 `success:true` |

共性：能力声明 > 实现；无并发/幂等；演示链路混进发布包并落在无鉴权写入口（hashline + safe-edit ≈1900 行可下线）。

## 无法确认（诚实声明）

- 是否真能从局域网访问：需实测 `netstat -ano | findstr 30141`（本环境未跑生产预览）。
- 二次 `req.json()` 在 Next 16 Node runtime 下的具体报错文案（静态推断为必失败）。
- `listAllSessions` 的 id 与 `inner.sessionId` 是否恒等（决定 S4/单进程契约的实际表现）。
- Gemini `thoughtSignature` 继承补丁是否仍影响真实会话（需真实 Gemini 调用验证）。
- 扩展 JSONL 悬空 toolCall 的 SDK 容忍度（0.81.1 与 1.4.0 均未实测）。

## 状态（第二轮更新：安全闸门 + pi 升级已落地）

### ✅ 已修复（含验证命令）

- [x] **S1 默认回环绑定** — 新增 `bin/server-args.js`（默认 `127.0.0.1`，`-H` 恒定显式传；`HOSTNAME` 环境变量不再顺带放开监听，改用 `--hostname`/`PI_WEB_HOST` 显式开关）。测试 `tests/server-args.test.mjs`（4 例）。
- [x] **S2 git-status 无 shell 执行** — `app/api/git-status/route.ts` 瘦身为传输层，全部动作迁到 `lib/git-status-exec.ts`，统一 `execFileSync("git", [...])`；分支/提交信息/路径做白名单校验（ref 正则、拒绝 `-` 开头与 `..`、commit sha 校验）。测试 `tests/security-gates.test.ts` 用真实 git 仓库验证 `x; touch PWNED` 不执行、提交信息里的引号与 `&` 按字面入库。
- [x] **S3 写路径收敛** — 新增 `lib/path-guard.ts`（`isInsideRoot`/`assertInsideRoot`）；write-file 限 cwd 内、diff 只读 cwd + pi agent dir、rollback/resolve-conflict 限 cwd 内；`PATCH /api/skills` 改为「只能改当前 cwd 已加载技能清单里的 SKILL.md」（`lib/skills-edit-guard.ts` + realpath 归一化，前端补传 `cwd`）；`/api/safe-edit`、`/api/hashline` 改为**默认关闭**（`lib/demo-api-gate.ts`，需 `PI_WEB_ENABLE_DEMO_APIS=1` 才开，否则 404）。
- [x] **S6 二次 req.json** — body 只解析一次，`write-file` 复用同一份（此前必 500）。
- [x] **S7 事件分发隔离** — `AgentSessionWrapper.emit` 逐个监听器 try/catch + 抛错即摘除；三条 SSE 路由（agent/sessions/subagents）统一走 `lib/sse-writer.ts`（closed 闩锁 + 幂等 cleanup），controller 关闭后不再把异常冒泡进 pi SDK 回调。
- [x] **U1–U4 pi 1.4.0 升级** — `package.json` → `pi-ai`/`pi-coding-agent ^1.4.0`、`typebox ^1.3.27`；`reloadConfig()` → `refresh({allowNetwork:false})`（1.4.0 的 refresh 会重读 models.json 并 `rebuildProviders()`）；移除只读 `state.systemPrompt` 清空 hack；`steer()/followUp()` 返回 `QueuedInputDisposition` 类型跟进；测试 ctx 升级 `ExtensionToolContext`；`powershell` 并入内置工具名单（否则被当扩展工具自动启用）；`patches/` 清空（MSYS 补丁上游已修、Gemini 补丁待真实会话复测）。

**验证（实测）**：`tsc --noEmit` exit 0；`npm test` **98/98** 通过；改动文件 `eslint` 0 错误；dev 冒烟：`/api/skills` 200、`/api/git-status {status}` 200（branch=main）、`write-file ../pwn.txt` 400、`/api/safe-edit` 与 `/api/hashline` 404、`/api/sessions/events` 吐出 `data: {"type":"connected"}`、`/api/pending-questions` 200。

## 真机跑一轮（第三轮：2026-10-28）

**为什么用假模型服务**：本机 `~/.pi/agent/models.json` 有 10 个 provider，但 apiKey 全是 `$ENV` 引用且对应环境变量未设置（`getProviderAuthStatus(...).configured === false`），`auth.json` 为空 → 没有可用凭证。为了既跑通真实链路又不花钱/不碰用户凭证，用本地「假 OpenAI 兼容服务」（`debug/stub-provider.mjs`）+ 临时 agent 目录（`PI_CODING_AGENT_DIR=debug/e2e-agent`）跑：pi SDK → HTTP provider → 流式 → SSE → 会话 `.jsonl` 全是真的，只有模型输出是假的。

| 验证点 | 结果 | 证据 |
|---|---|---|
| 新建会话 + 一轮对话（流式增量） | PASS | `debug/e2e-events.log`：`connected → agent_start → user message_end → text_delta 收/到` |
| `question` 工具 → 弹窗 → 作答 → 续跑 | PASS | `extension_ui_request{method:select,title:"要继续吗？"}`，作答后 `pending` 清空 |
| 待答徽标（文件来源） | PASS | `GET /api/pending-questions` 返回该会话 pending |
| 进程被杀 → 重启 → 弹窗恢复 | PASS | 重启后徽标仍在；重连 SSE 收到 `rehydrate:<toolCallId>`，可作答 |
| 会话详情/列表读取 | PASS | `GET /api/sessions/<id>` 39KB，`tree/info/leafId/context` 正常 |
| 浏览器 UI 层 | **BLOCKED（无浏览器能力）** | `.web-verify/reports/e2e-2026-10-28/report.md` |

### 真机跑出来的真问题（已修）

- **恢复后作答落盘形态错误**：原实现 append 一条 `role:"user"`。实测发给模型的 messages 变成
  `assistant(toolCall) > user > user` —— toolCall 永远没有配对 tool 结果，真实 OpenAI 兼容端点会 400
  （`tool_calls must be followed by tool messages`）。改为落成该 toolCall 的 `toolResult`
  （`rpc-manager.ts` 的 `rehydrateUnansweredQuestion`），修复后实测为 `assistant(toolCall) > tool > user`。
  回归测试 `tests/rehydrate-answer.test.ts`（3 例，修复前 2 红）。

### 被证据否掉的猜测（重要，避免自欺）

- 曾怀疑「1.4.0 的 `ModelRegistry` 必须 `await refresh()` 才能同步读，导致 `/api/models` 空」。
  实测证伪：给一个带字面量 apiKey 的 provider，`ModelRuntime.create()` 之后直接 `getAvailable()` 就有数据；
  之前的空列表纯粹是本机没有可用凭证。探针文件 `lib/model-runtime.ts` 已删除，
  真契约写成 `tests/model-registry-load.test.ts`（2 例）长期看守。

### 仍未验证

- **真实第三方模型**（无凭证，未跑）：真实 provider 的 toolCall id 规则、reasoning 字段、长上下文压缩行为。
- **模型切换**：本机只有一个可用模型，切模型路径未实测。
- **浏览器 UI**（弹窗样式、滚动、徽标动画）：无浏览器能力，未验证。
- 恢复出来的弹窗 `title` 显示为 `"User input"`（live 是 `"要继续吗？"`）——cosmetic 差异，待统一。

## 模型凭据同步（第四轮：2026-10-28）

**「切不了模型」的真实原因**：不是代码缺陷。pi 的 `~/.pi/agent/models.json` 里 10 个 provider 的
`apiKey` 全是 `$DGRID_*` 这类环境变量引用，而服务进程里没有这些变量 → pi 判定「全部未配置」
→ `GET /api/models` 返回 0 个模型 → 界面上没有第二个模型可切。

**同步实现**：新增 `lib/dsh-credentials.ts` + `instrumentation.ts`（Next 启动钩子，Node runtime 跑一次），
把 `~/.dsh/.credentials.yaml` 的 `refs:` 段补进 `process.env`：

- 不写任何文件，密钥只在进程内存；
- 已存在的同名变量永不覆盖；日志只打变量名不清打印密文；
- `PI_WEB_SYNC_DSH_CREDENTIALS=0` 可关闭，`PI_WEB_DSH_HOME` 可换目录；
- 测试 `tests/dsh-credentials.test.ts`（5 例，含「结果里绝不含密文」断言）。

**实测结果**（`npm run dev`，`127.0.0.1:3030`）：同步 13 个变量 → **442 个模型 / 12 个 provider**
（deepseek、dgrid-9add/c9e9/dad4/e9e6/bf0d/ffa8/29b5/dccf/778f、niccom、openrouter）。

### 顺带纠正两个我自己的错判

1. **切模型**：曾以为「本机只有一个可用模型，切不了」——根因是缺凭证（上段）。凭证就位后实测：
   `set_model` 依次切到 `dgrid-dad4/deepseek-flash` → `dgrid-9add/deepseek-v4.1-flash` →
   `niccom/deepseek-v4-flash` → `dgrid-c9e9/deepseek-v4.1-flash` 全部成功，
   且**新回复确实由新 provider 生成**（会话文件里 assistant 消息的 `provider`/`model` 字段随之变化）。
2. **切会话**：我曾报告「打开历史会话 404」——**那是我的测试方法错了**：把 session id
   截断成前 8 位去请求。用完整 id 复测：`/api/sessions/<id>` 全部 200，
   含 490 条消息的历史会话也能正常打开；连续切换 3 个会话无异常。

**本轮验证**：`tsc --noEmit` exit 0；`npm test` **108/108**；新文件 `eslint` 0 问题；
live 服务实测：`GET /` 200、`/api/models` 200（442）、`/api/sessions` 200、
`/api/pending-questions` 200、`/api/auth/all-providers` 200；`netstat` 确认仅绑定 `127.0.0.1:3030`。

## A 定位清理（第五轮：2026-10-28）

用户选 **A（轻量外壳）**：只承诺「聊天 + 历史 + 文件/diff + 模型」。按 `docs/capability-boundaries.md`
的否决清单执行，**整链删除**而不是留着不管。

### 删除清单（实测行数）

| 组 | 删除内容 | 代码行 | 文档行 |
|---|---|---|---|
| hashline | `lib/hashline-tool.ts` 245、`lib/hashline-client.ts` 170、`hooks/useHashline.ts` 175、`components/HashlineDemo.tsx` 304、`app/api/hashline/route.ts` 57、`app/hashline-demo/page.tsx` 9 | 960 | 531（3 篇） |
| safe-edit | `lib/safe-edit-guard.ts` 327、`components/SafeEditDemo.tsx` 471、`hooks/useSafeEdit.ts` 194、`app/api/safe-edit/route.ts` 90、`app/safe-edit-demo/page.tsx` 7 | 1,089 | 234（1 篇） |
| 门禁壳 | `lib/demo-api-gate.ts` 29、`tests/demo-api-gate.test.ts` 26 | 55 | — |
| 依赖 | `@oh-my-pi/hashline`、`@modelcontextprotocol/sdk`（零 import，`@google/genai` 只是 optional peer） | — | — |
| 过期文档 | `docs/integration-roadmap.md`、`docs/oh-my-pi-integration-opportunities.md`（都写 0.76.0） | — | 521 |
| 插件面板（A1） | `/api/packages/install|remove|translate-desc` 三路由 + `pi-packages.ts` 的 remove/翻译/npm-info 部分 + `PackageDetail` 写操作 UI | ~470 | — |

**合计**：删约 **2,574 行代码 + 1,286 行文档**，减 2 个依赖、减 5 个路由、减 2 个孤儿页面。
`app/api` 路由 37 → **32**。

### 同批修掉的真问题

1. **`setStatus`/`setWidget` 死链路补完**（原：后端 emit、前端无 case）。新增
   `lib/extension-panel-state.ts`（纯函数，6 个测试守着「空值=撤掉 key」语义）+
   `ChatWindow` 里的状态条/小组件渲染区。扩展的常驻状态现在真的会显示。
2. **`pi list` 空态被当成一个包**：`/api/packages/list-installed` 曾返回
   `{name:"No packages installed."}`。抽出 `parseInstalledPackages()` 纯函数 + 4 个测试。
3. **既有 lint 错误清零**：25 → **0 error**（`no-explicit-any` 若干、`no-unescaped-entities`、
   React Compiler 的 `preserve-manual-memoization`）。剩余 16 条 warning（unused-vars / exhaustive-deps）保留待议。

### 本轮验证（实测）

- `tsc --noEmit` → exit 0
- `npm test` → **115/115 pass**
- `npx eslint .` → **0 error**（16 warning）
- live（`127.0.0.1:3030`）：
  - 保留接口 200：`/`、`/api/models`、`/api/sessions`、`/api/packages`（50 条/117 页）、
    `/api/packages/list-installed`（0 条，假包已消失）、`/api/skills?cwd=…`（11 条）、`/api/pending-questions`
  - 已删接口全 404：`/api/hashline`、`/api/safe-edit`、`/api/packages/install|remove|translate-desc`
  - 已删页面全 404：`/hashline-demo`、`/safe-edit-demo`
  - 聊天回归：真实模型 `dgrid-dad4/deepseek-flash` 回「正常」，落盘 assistant 消息 model 字段正确

### 未验证

- 扩展状态条/小组件的**界面渲染**没有浏览器实测（harness 无浏览器能力），只验证了纯函数与类型；
  真实扩展触发 `setStatus` 的端到端效果仍待有浏览器的环境确认。
- 插件面板「复制安装命令」的剪贴板行为未实测。

## 仍待修

- [ ] **S4** 事件通道隐式启动 agent（`hooks/useAgentSession.ts:1188` + `events/route.ts`）——**需产品决策**：一旦"打开历史会话不启动 agent"，历史会话里的悬空 question 就不会自动弹（要等用户发消息才恢复）。要么接受延迟弹窗换铁律，要么给只读通道补一套「只读会话的 pending 文件轮询 + 点击恢复」。
- [ ] **S5** `app/api/browse-dirs` 的空 if 闸门（看似校验实则放行）→ 要么真校验，要么删掉误导代码并标注 dev-only。
- [ ] **S8** SSE 断线不回补状态（onopen 应拉一次 `loadSession` + `get_state` 快照）。
- [ ] **S9/S10** 路由层重复 `ModelRuntime.create`（10 处/8 文件）、前端无 API 层（46 处裸 fetch）、13 个 >600 行文件。
- [ ] **插件收敛**：setStatus/setWidget 死链路、包安装后复核+并发锁、hashline 快照跨请求失效、safe-edit 的 `next lint` 已废弃（现已被门禁关掉，不再是暴露面）。
- [ ] **Gemini 补丁决策**：1.4.0 已加跨 provider 签名校验，需真实 Gemini 会话复测后再决定是否重做补丁。
- [ ] **恢复弹窗 title 统一**：`User input` → 用原问题标题。
- [ ] `npm run lint` 全库仍有 25 个**既有**错误（`GitPanel.tsx` 13、`hashline-tool.ts` 4、`open-terminal.ts` 3 等，均非本轮改动引入）。
- [ ] **测试收尾卫生**：`AgentSessionWrapper` 的 idle 定时器会让「断言失败即跳过 destroy()」的测试挂住进程，新测试应统一 try/finally destroy（已在 `tests/rehydrate-answer.test.ts` 落实）。


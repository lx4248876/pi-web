# pi-web 的能力边界（A 定位：轻量外壳）

> 这份文件是**否决清单**：写清 pi-web 明确「不做什么」，避免以后又把半成品能力加回来，
> 让用户误以为有某个能力。

## 定位

pi-web = **pi 的浏览器外壳**。它只负责把 pi 引擎已经有的东西呈现好，不重新发明平台。

只承诺四件事：

1. **聊天**：新建会话、发消息、流式输出、图片附件、中止、提问弹窗（`question`）。
2. **历史**：列表、按项目分组、打开任意会话、分叉/回溯、上下文用量。
3. **文件 / diff / 工作区**：目录浏览、文件读写、git 状态与提交、逐段/整体回滚。
4. **模型 / 凭证**：模型列表、切换模型、思考等级、供应商与 API Key 管理。

## 明确不做（附原因）

| 不做的能力 | 曾有的实现 | 为什么砍 |
|---|---|---|
| **hashline 精确编辑** | `lib/hashline-*`、`hooks/useHashline`、`/api/hashline`、`/hashline-demo` | 每次请求新建快照库 → read 拿到的 tag 到 edit 已失效，设计上跑不通；主链路零引用；且是任意路径读写口。pi 自带 `edit` 工具够用。 |
| **safe-edit 自校验编辑** | `lib/safe-edit-guard`、`hooks/useSafeEdit`、`/api/safe-edit`、`/safe-edit-demo` | 依赖 `node_modules/.bin/tsc`（POSIX 路径）与已废弃的 `next lint`；Windows 上必然失败→自动回滚；失败仍返回 `success:true`。要防改坏，用 git 的 diff + rollback。 |
| **插件安装/卸载** | `/api/packages/install`、`/api/packages/remove`、`/api/packages/translate-desc` | 装完不复核、无并发锁、运行中会话加载不到新扩展 → 「装了没生效」。改为只读展示 + 复制 `pi install` 命令，在终端执行。 |
| **MCP 管理** | `@modelcontextprotocol/sdk` 依赖（零引用） | pi 自己就管 MCP（`pi mcp`、`docs/mcp.md`）。pi-web 声明这个依赖只会让人以为它管 MCP。 |
| **多代理编排** | — | subagent / team / workflow 属于平台能力。pi-web 只提供**只读**的子代理会话追随（`/api/subagents/[id]/events`），不提供启动/停止/编排。 |

## 保留但降级的功能

- **插件市场 / 已安装列表**（`/api/packages`、`/api/packages/list-installed`）：只读。
  安装、卸载、翻译一律去终端；面板给可复制命令，并提供「刷新」重新读 `pi list`。
- **子代理视图**：只读 tail 子代理的 `.jsonl`，绝不启动 agent（`lib/subagent-live.ts` 有测试守着）。

## 边界外的正确做法

| 想做的事 | 该去哪 |
|---|---|
| 装/卸 pi 插件、扩展 | 终端 `pi install` / `pi remove`，然后重启 pi-web 会话 |
| 配置 MCP server | `pi mcp` / pi 的配置文件 |
| 多代理编排 | 用 dsh（平台）或 pi CLI 的 subagent 能力 |
| 需要模型自校验的批量改代码 | 终端跑 `tsc` / 测试；或让 agent 用 `bash` 工具自己跑 |

## 维护约定

1. 新增能力前先问：这是「呈现 pi 已有的东西」，还是「重新发明平台」？后者不做。
2. 任何对外暴露的 UI/接口，必须真实可用；**半成品要么补完、要么删掉**，不允许长期共存。
3. 一切应跨重启保留的状态必须能从会话 `.jsonl` 重建（见 `AGENTS.md` 的铁律）。
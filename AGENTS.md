# Pi Web Agent Notes

## 项目地图 / 先读
- 结构骨架：`docs/project-map.md`（目录职责 + 关键链路文件详解）。
- 机器可读索引：`docs/project-map.index.json`（按 path / chains 定位文件）。
- 需要一键重新生成/刷新：调用 `codemap` 技能（全量重扫重写）。

Keep this file short: it is loaded into every agent turn for this project.

## Commands

- Dev server: `npm run dev` (Next.js on port 3030).
- Type check: `node_modules/.bin/tsc --noEmit`.
- Lint: `npm run lint`.
- Tests: `npm test`（原生 `.mjs` + 经 jiti 的 `.ts`；新增 `.ts` 测试需 `node --import jiti/register --test`）。
- Package manager is **npm**. Do not use `bun install`/`bun.lock` in this repo: the `postinstall: patch-package` step (in `patches/`) only runs under npm, and skipping it silently drops the MSYS-path and other dependency patches.
- Do not run `next build` during normal local agent work. It writes `.next/` output that can confuse hot reload and local path resolution.

## Browser Verification（浏览器/页面验收）

- 所有浏览器/页面验证**一律走 `web-verify` 技能**，由主代理执行；worker/reviewer 子代理只消费报告，不得驱动浏览器验收。
- 本项目**不使用 `agent-browser` CLI / `agent_browser` 工具**作为浏览器底座或验收路径，也不允许静默换用它冒充验收。
- web-verify 默认底座=当前 harness 原生浏览器能力；任何外部适配器只有显式申报并写入报告才可用，否则 `BLOCKED`。

## Debug Artifacts

- 所有调试/验证产物（日志、截图、UI 录制 yml、验证报告等）统一写到根目录 `debug/`（已 gitignore，不入库）。
- 工具运行时目录 `.pi-subagents/ .playwright-cli/ .web-verify/` 为 harness/浏览器/验证工具自动生成，已 gitignore，勿手工清理（工具可能依赖它们）。

## Search Discipline

- Prefer `rg` / `rg --files`.
- Do not search or read generated or dependency-heavy paths unless the task explicitly requires it:
  - `node_modules/`
  - `.next/`
  - `.claude/`
  - `.idea/`
  - `coverage/`
  - `out/`
  - `build/`
  - `package-lock.json`
  - `bun.lock`
  - `tsconfig.tsbuildinfo`
  - `research-report.json`
- Avoid broad `grep`, `find`, `sed`, `cat`, or shell loops that dump source into context. Read the narrow file or symbol needed.

## Windows Paths (Tool Args)

- pi tools (`read`/`grep`/`edit`/`write`/`find`/`ls`, not `bash`) resolve paths via Node's win32 `path.resolve`: a leading `/` means the *current drive root*.
- The Git Bash/MSYS prefix `/c/` is **not** understood by these tools — `/c/A-codes/...` becomes `C:\c\A-codes\...` (ENOENT).
- Always pass pi tools cwd-relative paths (`components/AppShell.tsx`) or explicit `C:/A-codes/...`. Only `bash` commands may use `/c/...` (bash translates it).

## Project Shape

- Next.js App Router lives in `app/`.
- Shared UI components live in `components/`.
- Runtime/session/backend helpers live in `lib/`.
- Tests live in `tests/`.
- Pi session files are outside the repo under `~/.pi/agent/sessions/`.

## Critical Behavior

- Browse-only session viewing must stay read-only: loading historical sessions should read `.jsonl` files directly and must not spawn an active agent.
- Interactive sessions are created through `/api/agent/new` or `/api/agent/[id]` and managed by `lib/rpc-manager.ts`.
- Active session wrappers must remain pinned on `globalThis.__piSessions`; do not replace this with ordinary module-local state.
- Session start concurrency is protected by `globalThis.__piStartLocks`; do not bypass that lock.
- After `AgentSession.fork()` returns, destroy the stale wrapper immediately so parent and child reload cleanly from their own files.
- Forking creates a new session file; in-session branching appends nodes to the same file. Do not merge those two routing models.
- Git status parsing must use `git -c core.quotePath=false status -s`. Do not trim lines before reading the two-character status prefix.
- When refreshing git status, rebuild `checkedFiles` by intersecting it with the current modified file list so stale checked entries cannot survive.

## Session State Persistence（会话状态持久化 · 犯错经验）

教训来自：未答 question 弹窗在进程重启后永久丢失的根因排查。

- **铁律：一切「会话可见且应跨重启保留」的状态，必须能从会话 `.jsonl`（`getEntries()` / 文件尾）重建。** 任何只活在 live wrapper 内存（Map/Set/flag）里、且 `startRpcSession` 打开时未从文件重建的状态，进程一重启就静默消失，等同于永久丢失。排查这种 bug 时逐字段问：*重启后我还能从文件推回它吗？*
- **判断「该不该持久化」**：runtime 启发（loop detection、streaming 边沿、监听器、idle 定时器）与 extension 即时 UI（notify/toast/widget/status/title）属瞬态，天然应随进程丢——不要去持久化它们，那会造出多余状态机。只有「未答信息/用户选择/模型与提示词覆盖」这类会写进历史的内容才需要跨重启保留。
- **以文件为准，不从内存快照重建**：会话文件里的悬空 `question` toolCall（无对应 toolResult）就是「未答问题」这一事实的持久化真身；恢复它要读文件尾，而非依赖任何上一个进程留下的内存态。
- **每个「枚举 live-only 状态对外暴露」的出口都要防**：`getAllPendingDialogs`、侧栏待答徽标、`get_state` 等；会话重新打开（`startRpcSession`）时必须让它们也有文件来源，否则会出现「徽标在 / 数据在文件里、但对不上」。
- **进程被杀写不出 clean 收尾**：kill 前已落盘的悬空 toolCall 才是唯一可靠记录；恢复路径必须读它，不要指望 destroy 清理兜底（本次正是 destroy 没跑才留下悬空）。
- **防重复弹的循环打断**：恢复后用户作答，把答案以 `<question>` 之后追加一条 user 消息的形式落盘（SDK `appendMessage` 子叶落盘并推进 leaf）——既持久化答案，又让该问题不再处于「最后一条」，下次打开自然不再重复弹。
- **已知未覆盖边界**（同类但未修）：仅剩「非 `question` 工具经 `ctx.ui.select/confirm/input/editor` 直接弹、又未落 toolResult 的弹窗」未恢复；单问与批量 `questions[]`（multiple）均已从文件尾恢复。撞到再补，不要当已解决。



- Use the existing Tailwind/global token style in `app/globals.css`.
- Prefer quiet 1px borders, token colors, compact controls, and no decorative shadows unless the surrounding UI already uses them.

## Change Boundaries

- Match existing file style before editing.
- Keep fixes narrow; do not rewrite architecture while solving a local UI or config issue.
- If behavior changes, add or run the smallest relevant verification. For pure instruction/config edits, a text check is enough.

## Coding-Cycle Skill Routing

- When the user requests a code change and this turn is **not** already routed via `spec`/`run`/`discovery`, `read` the **explain-change** skill before editing — it must gate change work in this repo. Invoke it explicitly even if the user didn't mention it.

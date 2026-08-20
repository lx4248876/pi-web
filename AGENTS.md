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

## UI Style

- Use the existing Tailwind/global token style in `app/globals.css`.
- Prefer quiet 1px borders, token colors, compact controls, and no decorative shadows unless the surrounding UI already uses them.

## Change Boundaries

- Match existing file style before editing.
- Keep fixes narrow; do not rewrite architecture while solving a local UI or config issue.
- If behavior changes, add or run the smallest relevant verification. For pure instruction/config edits, a text check is enough.

## Coding-Cycle Skill Routing

- When the user requests a code change and this turn is **not** already routed via `spec`/`run`/`discovery`, `read` the **explain-change** skill before editing — it must gate change work in this repo. Invoke it explicitly even if the user didn't mention it.

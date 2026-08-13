# 开发与调试指南

面向 pi-web 本地开发、运行、测试与调试的权威说明。

## 环境

- **运行时**：Node.js（仓库当前用 Node 24，已启用 type-stripping / ESM）。
- **框架**：Next.js 16 App Router + React 19 + Tailwind v4。
- **pi 版本**：`@earendil-works/pi-ai` / `pi-coding-agent` **0.81.1**（0.79.1→0.81.1 迁移完成：`AuthStorage`/`ModelRegistry.create` 已移除，改用 `ModelRuntime`；`modelRegistry` → `modelRuntime`）。

## 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动 dev server（端口 3030） |
| `npm test` | 全量测试（原生跑 `.mjs` + 经 jiti 跑 `.ts`） |
| `node --import jiti/register --test <file>` | 跑单个 `.ts` 测试 |
| `node_modules/.bin/tsc --noEmit` | 类型检查 |
| `npm run lint` | ESLint |
| `npm start` | Next.js 生产预览（端口 30141；会锁定 `@next/swc` 的 `.node`，阻塞其后的 `npm ci/install`） |

> ⚠️ 正常本地工作时**不要**跑 `next build`：它写入 `.next/`，会干扰热更新与本地路径解析。生产预览 `npm start` 会锁定 `@next/swc`，导致其后想 `npm ci`/`npm install` 时因文件被占而 EPERM——此时需先停掉该进程再安装。

## 调试产物目录约定

所有调试/验证产物（日志、截图、UI 录制 `.yml`、验证报告等）**统一写入根目录 `debug/`**（已 gitignore，不入库）。

```text
debug/
  README.md        # 本目录说明
  your-run.log     # 例如 dev 日志
  ui-recording.yml
  screenshot.png
```

- 由 harness / 浏览器 / 验证工具**自动生成的运行时目录** `.pi-subagents/`、`.playwright-cli/`、`.web-verify/` 也已 gitignore；请勿手工删除（工具可能依赖它们）。
- 后续新增产物请放进 `debug/`，不要散落在仓库根目录。

## 测试体系

- 测试位于 `tests/`，分两类：
  - **`.mjs` 测试**：原生 `node --test` 跑；部分通过 `typescript`+`vm` 隔离读取 `lib/*.ts`（用 `require` 注入 stub）。
  - **`.ts` 测试**（如 `tests/extension-ui-buffer.test.ts`）：需 `node --import jiti/register`（`jiti` 为 devDependency，解析无扩展名 TS ESM import）。
- `npm test` 现为两段式：`node --test "tests/**/*.test.mjs" && node --import jiti/register --test "tests/**/*.test.ts"`。
- 类型检查通过后仍需 `npm test`，二者互不替代。

## 关键工程约束（来自 AGENTS.md）

- 浏览（只读）会话查看必须直接读 `.jsonl`，不得 spawn 活跃 agent。
- 活跃会话 wrapper 必须 pin 在 `globalThis.__piSessions`；并发用 `globalThis.__piStartLocks`；fork 后立即销毁 stale wrapper。
- git status 解析必须 `git -c core.quotePath=false status -s`，读两字符状态前缀前不要 trim 行。
- 刷新 git status 时 `checkedFiles` 需与最新 modified 列表求交集，避免残留过期勾选。

## 文档导航

- 架构/生命周期：`../AGENTS.md`
- 本次 bug 排查与修复记录：`bug-audit-report.md`
- 修复讲解（外行可读，含可折叠代码）：`change-explainers/2026-08-13-bug-fixes.html`
- 文档目录总览：`README.md`
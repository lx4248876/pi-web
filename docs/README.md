# Pi Web 文档目录

## 📚 核心文档

| 文档 | 说明 |
|------|------|
| [../README.md](../README.md) | 项目概述和快速开始 |
| [../AGENTS.md](../AGENTS.md) | 代理工作约定 + 关键实现陷阱 |
| [capability-boundaries.md](capability-boundaries.md) | **能力边界（A 定位：轻量外壳）** —— 明确「不做什么」及原因 |
| [project-map.md](project-map.md) | 项目结构地图（目录职责 + 关键链路）；机器可读索引见 `project-map.index.json` |
| [development.md](development.md) | 开发与调试指南（命令/测试/模型凭据同步/调试产物目录） |

## 🔧 功能文档

| 文档 | 说明 |
|------|------|
| [error-handling.md](error-handling.md) | 聊天错误提示（余额不足/限流/鉴权/网络） |
| [git-panel.md](git-panel.md) | Git 面板设计文档 |
| [sidebar-design.md](sidebar-design.md) | 侧边栏设计文档 |

## 🗂 排查与修复

| 文档 | 说明 |
|------|------|
| [audit-report-2026-10.md](audit-report-2026-10.md) | 生产就绪度审查报告（含逐轮修复状态与验证记录） |
| [bug-audit-report.md](bug-audit-report.md) | 早期全面 bug 排查报告（含修复状态） |
| [change-explainers/](change-explainers/) | 修复讲解页（外行可读，含折叠代码） |

## 🗺️ 规划文档

| 文档 | 说明 |
|------|------|
| [optimization-plan.md](optimization-plan.md) | 优化计划 |

## 📝 文档维护

### 文档规范

1. **统一位置** - 所有文档放在 `docs/` 目录
2. **清晰命名** - 使用小写字母和连字符
3. **完整内容** - 包含概述、使用方法、API 参考
4. **及时更新** - 功能变更时同步更新文档；**功能删除时同步删除文档**（不要让文档广告已不存在的能力）

### 已下线文档

以下文档随对应功能在「A 定位」清理中删除，不要再引用：

| 已删文档 | 原因 |
|----------|------|
| `hashline.md`、`hashline-integration-summary.md`、`hashline-integration-complete.md` | hashline 整链删除（快照库跨请求失效，设计上跑不通） |
| `safe-edit.md` | safe-edit 整链删除（依赖 POSIX `tsc` 路径与已废弃的 `next lint`） |
| `integration-roadmap.md`、`oh-my-pi-integration-opportunities.md` | 内容停留在 pi 0.76.0，已失效 |

能力边界与后续判断见 [capability-boundaries.md](capability-boundaries.md)。
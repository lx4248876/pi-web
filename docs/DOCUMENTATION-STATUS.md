# 文档维护状态

## 📊 当前文档清单

### ✅ 有效文档

| 文档 | 状态 | 说明 |
|------|------|------|
| `README.md`（仓库根） | ✅ 有效 | 项目概述 |
| `AGENTS.md` | ✅ 有效 | 代理工作约定 + 关键实现陷阱 |
| `docs/README.md` | ✅ 有效 | 文档目录和导航 |
| `docs/capability-boundaries.md` | ✅ 有效 | 能力边界 / 否决清单（A 定位） |
| `docs/project-map.md` + `.index.json` | ✅ 有效 | 结构地图（`codemap` 技能可重生成） |
| `docs/development.md` | ✅ 有效 | 开发与调试指南 |
| `docs/audit-report-2026-10.md` | ✅ 有效 | 生产就绪审查 + 修复记录 |
| `docs/bug-audit-report.md` | ✅ 有效 | 早期 bug 排查记录（历史） |
| `docs/error-handling.md` | ✅ 有效 | 聊天错误提示 |
| `docs/git-panel.md` | ✅ 有效 | Git 面板设计 |
| `docs/sidebar-design.md` | ✅ 有效 | 侧边栏设计 |
| `docs/optimization-plan.md` | ✅ 有效 | 优化计划 |
| `docs/change-explainers/*.html` | ✅ 有效 | 修复讲解页（历史归档） |

### 🗑 已删除（随功能下线，勿再引用）

| 已删文档 | 删除原因 |
|----------|----------|
| `docs/hashline.md` | hashline 整链下线 |
| `docs/hashline-integration-summary.md` | 同上 |
| `docs/hashline-integration-complete.md` | 同上 |
| `docs/safe-edit.md` | safe-edit 整链下线 |
| `docs/integration-roadmap.md` | 内容停留在 pi 0.76.0 |
| `docs/oh-my-pi-integration-opportunities.md` | 同上 |

## 📁 文档结构

```
pi-web/
├── AGENTS.md                     # 代理工作约定 + 实现陷阱
├── README.md                     # 项目概述
└── docs/
    ├── README.md                 # 文档目录
    ├── capability-boundaries.md  # 能力边界（不做什么）
    ├── project-map.md            # 结构地图
    ├── project-map.index.json    # 机器可读索引
    ├── development.md            # 开发与调试指南
    ├── audit-report-2026-10.md   # 生产就绪审查 + 修复记录
    ├── bug-audit-report.md       # 早期 bug 排查记录
    ├── error-handling.md         # 聊天错误提示
    ├── git-panel.md              # Git 面板设计
    ├── sidebar-design.md         # 侧边栏设计
    ├── optimization-plan.md      # 优化计划
    ├── change-explainers/        # 修复讲解页
    └── DOCUMENTATION-STATUS.md   # 本文件
```

## 📝 维护规则

1. **功能删除时文档必须同批删除**——文档广告不存在的能力，比没有文档更伤。
2. 新增能力时，先在 `docs/capability-boundaries.md` 里确认它属于「呈现 pi 已有的东西」，再写文档。
3. 结构变动后重跑 `codemap` 刷新 `project-map.md` / `project-map.index.json`。
4. 文档里的路径与命令要能直接复制运行；验证方式写「实测」而不是「应该可以」。

---

**维护状态：✅ 与代码一致（2026-10-28 复核）**
# Spec — 侧边栏 +New 按钮移到项目行 & 目录选择器显示点开头文件夹

- base_ref: `fc0bdff`
- 日期: 2026-07-01
- 状态: 已确认改动计划,待实现
- 调研方式: 未委派子代理(pi 无内建子代理委派),主代理自查

---

## 1. 需求(用户原话)

1. "+New 这个开启新会话的按钮应该放到会话列表里面项目这一行,这样方便操作。"
2. "+ Add Project Directory... 选到 `C:\Users\Administrator` 目录下,所有 . 开头的文件夹看不到。"

## 2. 术语对齐表

| 用户用词                        | 代码符号 / 位置                                                              | 含义                                   |
|-----------------------------|------------------------------------------------------------------------|--------------------------------------|
| +New 按钮(顶部)                 | `SessionSidebar.tsx:605` header 内 `handleNewSession`                   | 在"当前选中项目"里开新会话                       |
| 项目行 / 项目这一行                 | `SessionSidebar.tsx` `projectList.map` 渲染的 "CWD Folder Group Header"   | 每个项目(cwd)的折叠行(含 chevron、项目名、全路径、×隐藏) |
| 开新会话                        | `AppShell.tsx:172` `handleNewSession` → `setNewSessionCwd(cwd)`        | 客户端用临时 id 开一个空会话,后续 pi 回填真实 id       |
| Add Project Directory 目录选择器 | `SessionSidebar.tsx` "Browse Directory Modal" + `GET /api/browse-dirs` | 浏览磁盘目录用于添加项目                         |
| 点开头文件夹看不到                   | `app/api/browse-dirs/route.ts:148` `!d.name.startsWith(".")`           | listDir 把所有 `.` 开头目录过滤掉              |

## 3. 大白话校验记录(主线四留档)

- 对用户提问全部转成行为描述,未甩代码符号。
- "顶部的 +New 还要留吗" → 不甩 `handleNewSession` 闭包;讲"点哪个项目行的 +New 就在哪个项目里开"。
- "一直显示 vs 悬停才显示" → 行为级二选一。
- ".git/.next 这种垃圾目录还要藏吗" → 把 SKIP_DIRS 翻译成"已知垃圾目录"。
- 用户全程用日常语言回答,无术语冲突。无术语需转译之外的遗留项。

## 4. 决策树闭合记录

### 问题1:+New 按钮位置

| 节点               | 问题          | 推荐答案     | 依据                                                                        |
|------------------|-------------|----------|---------------------------------------------------------------------------|
| N1.1 已有能力核查      | 系统是否已能开新会话? | 是,可复用    | 自查(`SessionSidebar.tsx:513` handleNewSession + `AppShell.tsx:172` 接收 cwd) |
| N1.2 放在项目行哪里?    | 项目行右侧,×按钮旁  | 同推荐      | 自查(`SessionSidebar.tsx` project header row,已有 stopPropagation 先例)         |
| N1.3 顶部 +New 处理? | 删除          | 删除,只用每行的 | 用户确认(gate③-Q1)                                                            |
| N1.4 行按钮针对哪个项目开? | 该行 cwd      | 同推荐      | 自查(AppShell.handleNewSession 已按 cwd 参数开,无需改 AppShell)                     |
| N1.5 显示方式?       | 一直显示        | 一直显示     | 用户确认(gate③-Q2)                                                            |

### 问题2:目录选择器点开头文件夹

| 节点                       | 问题                                    | 推荐答案        | 依据                                                            |
|--------------------------|---------------------------------------|-------------|---------------------------------------------------------------|
| N2.1 已有能力核查              | listDir 是否已有"排除名单"机制?                 | 是,SKIP_DIRS | 自查(`browse-dirs/route.ts:139`)                                |
| N2.2 怎么改过滤?              | 去掉一刀切 `!startsWith(".")`,保留 SKIP_DIRS | 同推荐         | 用户确认(gate③-Q3)                                                |
| N2.3 Explorer 文件树要不要一起改? | 不改                                    | 同推荐         | 自查边界(`app/api/files/[...path]/route.ts:255` 是另一功能),用户未要求,显式排除 |

## 5. 漏扫核实记录(主线五留档)

- 漏扫线索清单:用户回答未引入调研/已读代码之外的"新文件/新模块/新行为"。
    - 我主动提到的 "Explorer 也藏点开头文件" 属边界声明,非用户冒出的新线索,无需派代理核实(本技能亦无内建子代理)。
- 三次核实闸(校准②/③/gate5回补)触发时清单均为空,直接放行。
- 结论:无漏扫线索。

## 6. 需求质量清单(gate5,7 维度)

| 维度       | 判定 | 证据/说明                                                                                                                                          |
|----------|----|------------------------------------------------------------------------------------------------------------------------------------------------|
| Q1 术语唯一性 | ✅  | 术语对齐表全覆盖,无重载词                                                                                                                                  |
| Q2 边界与异常 | ✅  | 空项目列表(无行→靠 Add Project 出行)、0 会话项目行(+New 在 header 行仍可用)、长项目名与按钮溢出(flex+ellipsis+flexShrink:0)、点击冒泡(stopPropagation 防折叠/选中)、会话运行中开新会话(与现状一致,无回归) |
| Q3 错误处理  | ✅  | browse-dirs 已有 try/catch 返回 [];+New 无新增失败路径(与现有 header 按钮同等)                                                                                   |
| Q4 非功能   | ✅  | 性能:listDir 仅在显式浏览时同步读目录,非热路径;可访问性:新按钮加 `title`;安全:本地工具,browse-dirs 已有安全注释                                                                      |
| Q5 验收可测  | ✅  | 见第 9 节验收标准,每条可答是/否                                                                                                                             |
| Q6 假设显式化 | ✅  | 见第 7 节假设;Explorer 不改为显式边界                                                                                                                      |
| Q7 方案最小化 | ✅  | 复用 AppShell cwd 管线;仅删 1 行过滤 + 挪 1 个按钮 + 加 1 个按钮;无新组件/表/接口                                                                                      |

## 7. 假设(高风险已当面确认)

- H1(已确认):顶部 +New 删除后,空项目列表场景仍可通过 "+ Add Project Directory" 添加项目,添加后(selectedCwd 变化)项目行出现
  +New。— 依据 `projectList` filter 含 `p.cwd === selectedCwd`。
- H2(边界):`app/api/files/[...path]/route.ts`(Explorer 文件树)的点开头过滤**不改**,本次仅改 browse-dirs。

## 8. Code Map(含 base_ref `fc0bdff`)

入口链路:

- +New(开新会话): `SessionSidebar.tsx` header 按钮 → `handleNewSession` → `onNewSession` prop → `AppShell.tsx:172`
  `handleNewSession` → `setNewSessionCwd(cwd)` → `ChatWindow` 以 `newSessionCwd` 渲染空会话 → pi 回填真实 id。
- Add Project Directory: `SessionSidebar.tsx` "Browse Directory Modal" → `loadBrowseEntries` →
  `GET /api/browse-dirs?path=` → `listDir`(过滤点开头)→ 返回 entries。

关键文件:

- `components/SessionSidebar.tsx` — 侧边栏整体(header +New、项目行、目录选择 modal)
- `app/api/browse-dirs/route.ts` — 目录列表接口(`listDir` 在 ~139-151)
- `components/AppShell.tsx:172` — `handleNewSession(_sessionId, cwd)` 管线(无需改)
- `app/api/files/[...path]/route.ts:255` — Explorer 文件树点开头过滤(不改,边界)

## 9. 改动计划(已与用户确认)

| 文件 / 位置                                           | 动作  | 改什么                                                                                                                       | 为什么(对应决策)             | 风险                            |
|---------------------------------------------------|-----|---------------------------------------------------------------------------------------------------------------------------|-----------------------|-------------------------------|
| `components/SessionSidebar.tsx` ~605-630          | 删除  | 顶部标题栏 +New 按钮(含其 onMouseEnter/Leave);Refresh 按钮保留                                                                         | N1.3 用户确认删除           | 低;header 右侧只剩 Refresh         |
| `components/SessionSidebar.tsx` ~513              | 改造  | `handleNewSession` → 改为 `handleNewSessionFor(cwd: string)`;原闭包版本若不再被引用则删除                                                 | N1.4 按行 cwd 开新会话      | 低                             |
| `components/SessionSidebar.tsx` 项目行右侧(~1100,×按钮旁) | 新增  | +New 按钮,一直显示,`onClick` 内 `e.stopPropagation()` + `handleNewSessionFor(cwd)`,`flexShrink:0`,`title="New session in <cwd>"` | N1.2/N1.5 用户确认位置与一直显示 | 低;必须 stopPropagation 防触发折叠/选中 |
| `app/api/browse-dirs/route.ts:148`                | 删条件 | 去掉 `&& !d.name.startsWith(".")`,保留 `!SKIP_DIRS.has(d.name)`                                                               | N2.2 用户确认只藏垃圾目录       | 低                             |

### 改动边界

| 类型    | 范围                                                                                                            | 规则                                                   |
|-------|---------------------------------------------------------------------------------------------------------------|------------------------------------------------------|
| 允许改   | `SessionSidebar.tsx`(header +New 删除、handleNewSessionFor、项目行加按钮)、`app/api/browse-dirs/route.ts` listDir 过滤     | —                                                    |
| 禁止改   | `app/api/files/[...path]/route.ts`(Explorer)、`AppShell.tsx` `handleNewSession` 签名、Refresh 按钮、×隐藏逻辑、项目行折叠/选中逻辑 | AppShell 已按 cwd 开,无需改;新按钮必须 stopPropagation 不影响折叠/选中 |
| 需停下确认 | 若改 listDir 后发现某些系统点目录(如 Windows AppData 等非项目配置目录)造成困扰,不在本次随意扩展 SKIP_DIRS                                      | 先与用户确认再扩展排除名单                                        |

## 10. 验收标准

- AC1:侧边栏顶部标题栏不再有 +New 按钮(只剩标题和 Refresh)。
- AC2:会话列表里每个项目行的标题(×隐藏按钮旁)有一个一直显示的 +New 按钮。
- AC3:点某项目行的 +New,在该项目 cwd 下开新会话;不触发行折叠、不切换选中态、不开错项目。
- AC4:"+ Add Project Directory" 弹窗进入 `C:\Users\Administrator`,能看到 `.pi`、`.agents` 等点开头目录;`.git`、`.next`、
  `.cache`、`.turbo` 等仍在 SKIP_DIRS 中的目录不显示。
- AC5:侧边栏底部 Explorer 文件树的点开头文件行为不变(仍隐藏)。

## 11. 用户验收剧本

1. `npm run dev`,浏览器打开 (端口 3030)。
2. 问题1:在侧边栏查看 → 顶部无 +New;会话列表每个项目行标题右侧有一直显示的 +New;点 A 项目的 +New → 在 A 项目开新会话;点
   B 项目 +New → 在 B 开。点击不引起项目折叠。
3. 问题2:点 "+ Add Project Directory…" → 路径进到 `C:\Users\Administrator` → 列表里出现 `.pi`、`.agents` 等 → 选中 `.pi`
   点 Add Project 能添加成功;`.git` 类目录不出现在列表。
4. 回归:打开底部 Explorer 文件树,点开头文件仍不显示(行为未变)。

## 12. 测试清单(TDD 红灯)

- 浏览器手测按第 11 节执行(本两项为 UI/接口层小改,手测为主)。
- 可选自动化:`/api/browse-dirs?path=<含点目录的父目录>` 返回 entries 含 `.` 开头目录、不含 SKIP_DIRS 内目录。
- `node_modules/.bin/tsc --noEmit` 通过、`npm run lint` 通过。

## 13. 代码导览策略

- 风险档:中(多文件、用户可见行为,但无公共组件/API/schema/权限/数据改动)。
- 策略:改完一次性短导览(<10 行),说明"删了顶部按钮 / 行按钮位置 / 过滤改了哪行",不阻塞用户。

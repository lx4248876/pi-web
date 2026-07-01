# 需求规格:AppShell 拆分重构(纯减重,零行为变化)

## 问题陈述

`components/AppShell.tsx` 是一个 904 行的单函数组件,塞进了 13 类不相关的职责(session 管理、cwd 切换、左右栏布局/拖拽、顶栏全部按钮、分支导航、system prompt、token/cost/上下文用量、文件标签页、开终端、模型/技能弹窗等)。更关键的反模式是:ChatWindow 通过 4 个回调把"当前会话的状态"上抛给 AppShell 当邮差,AppShell 成了状态垃圾场。代码难读、难改、难测。

## 用户意图

把 AppShell 做一次**结构整理**,让代码职责清晰、好读好改好测。**核心诉求不只是"行数多",更是"子组件数据往上抛给父节点当邮差"这种乱法**。本次只做减重,**不要改任何用户能看到的功能、行为、外观**。拆完用起来、看起来都必须跟现在一模一样。

## 术语对齐表

本轮未发现歧义/重载用词。涉及的名词都是 UI 通用词且语义唯一:

| 用户/常用词 | 代码符号/文件 | 说明 |
|------------|--------------|------|
| AppShell | `components/AppShell.tsx` `AppShell` | 应用主骨架组件 |
| 顶栏 / top bar | `AppShell.tsx` `topBarRef` 所在 div | 顶部 36px 操作条 |
| 左栏 / sidebar | `.sidebar-container`(CSS) | 左侧会话/项目栏 |
| 右栏 / 右面板 | `.right-panel-container`(CSS) | 右侧文件/Git 查看面板 |
| 拖拽调宽 | `createSidebarWidthTracker`(`lib/sidebar-width.ts`) | 左右栏可拖拽改宽度 |

## 大白话校验记录

本需求无复杂数据/状态/权限概念,主要是 UI 结构。记录两处把技术概念翻译成大白话的实例:

| # | 原始技术表述 | 大白话转译(实际抛给用户的措辞) | 用户确认 |
|---|-------------|--------------------------------|---------|
| 1 | "状态上抛反模式 / 父节点当状态垃圾场" | "子组件的数据往上抛给父节点当邮差" → 直接讲"现在系统里这个最顶层的框,什么状态都堆它那儿,大家要通过它转交数据" | ✅ 用户理解认可 |
| 2 | "纯重构零行为变化 vs 顺带治状态流" | "拆到什么程度?A 只减重,行为一丁点都不变;B 顺手把数据上抛也治了,但要动子组件接口,风险高一档" | ✅ 用户选 A |

## 范围

### 做什么(In-Scope)

- 把 `AppShell.tsx` 里的纯渲染块抽成独立文件,放进新目录 `components/app-shell/`
- 把左右两套几乎相同的拖拽调宽逻辑合并成一个 hook(**保留两套真实差异**:左栏拖拽实时改 CSS 变量、右栏改 state)
- 把散落的内联 SVG 图标集中到一个图标文件
- 保持 AppShell 仍拥有所有状态、仍把 props 往下传(顶栏会接 15+ props)

### 不做什么(Out-of-Scope)

- **不改状态流向** —— ChatWindow 的 4 个上抛回调(`onBranchDataChange`/`onSystemPromptChange`/`onSessionStatsChange`/`onContextUsageChange`)原样保留
- **不改任何子组件的对外接口** —— `SessionSidebar`/`ChatWindow`/`FileViewer`/`BranchNavigator`/`GitPanel`/`ModelsConfig`/`SkillsConfig`/`TabBar` 的 props 一个都不改
- **不改任何用户可见行为/外观**
- 不补组件层测试(超出"零变化"范围)
- 不动 `lib/`(纯逻辑层)
- 不动 `app/api/`(后端路由)

## 改动边界(必填,已与用户对齐)

| 边界类型 | 文件/模块/能力 | 规则 | 原因 | 触发动作 |
|---------|----------------|------|------|----------|
| 允许改动 | `components/AppShell.tsx` | 可修改(瘦身,保留对外默认导出 `AppShell`) | 本任务核心 | 正常实现 |
| 允许改动 | `components/app-shell/`(新建目录) | 可新建子组件/hook/图标文件 | 拆分产物 | 正常实现 |
| 禁止改动 | `app/globals.css` 里的 CSS class 名(`sidebar-container`/`right-panel-container`/`sidebar-overlay-backdrop`/`sidebar-resize-handle`/`--sidebar-width`) | 一律不改 | 布局/拖拽行为依赖这些 class | 如需改,停下确认 |
| 禁止改动 | 所有 `localStorage` key(`pi-web:right-panel-width`、sidebar 宽度 key 等) | 一律不改 | 用户已存的宽度偏好不能丢 | 如需改,停下确认 |
| 禁止改动 | `components/` 下除 AppShell 外的所有现有组件、`hooks/`、`lib/`、`app/api/` | 一律不改 | 子组件接口/状态流/逻辑层都不在本范围 | 如需改,停下确认 |
| 禁止改动 | ChatWindow 的 4 个上抛回调签名 | 一律不改 | Q1=A 决策锁定不改状态流 | 如需改,停下确认 |
| 需停下确认 | 任何计划外文件、任何对子组件 props 的改动、任何用户可见行为变化 | —— | 防止顺手扩大范围 | 生成偏差说明,待用户确认 |

### 假设

- 重构后 AppShell.tsx 行数会显著下降,但仍可能是中等大小(它仍管所有状态 + 编排);本次目标不是"压到 N 行",是"职责清晰"
- 项目组件层零测试,重构正确性靠 `tsc` + `lint` + 手动 web-verify 回归保障(用户已在 Q2 确认"严格零变化"下接受这套验证)
- 工作区当前有大量本任务无关的脏改动(`GitPanel.tsx`/`useAgentSession.ts`/`package.json` 等),**本次改动只触及 AppShell.tsx + 新建目录,不与脏改动文件重叠**——见"安全检查点"

> **高风险/会改方向的假设**(已 gate4 当面确认):
>
> - 用户明确要求"严格零行为变化"且"一次性做完"(不分步)——任何中途行为偏差都算偏离

## 功能需求

- [ ] AppShell 拆分后,对外仍是 `components/AppShell.tsx` 的默认导出 `AppShell`,`app/page.tsx` 等调用方零感知
- [ ] 拆出的子块都放进 `components/app-shell/`,职责单一、命名清晰
- [ ] 左右拖拽调宽逻辑合并为一个 hook,且两套真实差异(左栏实时改 CSS 变量、右栏改 state)完整保留
- [ ] 所有 CSS class 名、localStorage key、回调签名不变
- [ ] 重构后 `tsc --noEmit` 通过、`npm run lint` 通过

## 非功能需求

- [ ] 性能:不引入新的运行时开销(不增加无谓的 Provider 嵌套、不在热路径新增闭包)
- [ ] 兼容:`app/page.tsx` 等调用方零改动;Next.js App Router 的客户端组件边界(`"use client"`)正确保持
- [ ] 可维护性:每个子文件职责单一,便于后续单独阅读/修改
- [ ] 安全:不碰任何认证/数据/权限路径(本就不在范围)

## 决策树闭合记录(含核实闸回填的节点)

| # | 决策节点 | 问题摘要 | 最终答案 | 答案依据 | 解锁的下游节点 |
|---|---------|---------|---------|---------|--------------|
| 0 | (强制)已有能力核查 | 系统是否已有 AppShell 拆分/类似的组件拆分先例? | 系统无任何形式的 AppShell 拆分,是单文件单函数;但 `createSidebarWidthTracker`(`lib/sidebar-width.ts:6`)和 `SessionSidebar` 等已是独立可复用件 | 自查(`components/AppShell.tsx` 全 904 行;`lib/sidebar-width.ts:6`) | 必须新建拆分 → #1 |
| 1 | 拆到什么程度 | 只减重,还是顺带治状态上抛,还是大改重写? | **只减重**(A):抽纯渲染块 + 合并重复 hook,状态流向、子组件接口一概不改 | 用户确认(gate3,`Q1=A`) | #2 |
| 2 | 行为约束 | 拆分期间允许顺手改行为吗? | **严格零变化**(A):纯重构,只能用 tsc/lint/dev 手动验证 | 用户确认(gate3,`Q2=A`) | #3(交付节奏) |
| 3 | 交付节奏 | 分步还是一次性? | **一次性做完**(B),中间不分步提交 | 用户确认(gate3,`Q3=B`) | #4 |
| 4 | 新文件放哪 | 平铺到 `components/` 还是建子目录? | **建子目录 `components/app-shell/`** | 用户确认(gate4,`P1=A`) | #5 |
| 5 | 顶栏 props 会很长 | 接受 props 长但结构清晰吗? | **接受**(Q1=A 的必然代价;不动状态流就得往下传) | 用户确认(gate4,`P2=接受`) | 验收标准 |
| 6 | (自查)左右拖拽能否粗暴合并 | 两套逻辑差异大吗? | **不能粗暴合并**:左栏拖拽实时改 CSS 变量 `--sidebar-width`(驱动 `.sidebar-container`),右栏是改 state→width style;手机端禁用判断、localStorage key、生效条件也都不同。合并成一个 hook 必须参数化这些差异 | 自查(`components/AppShell.tsx` 左栏 effect ~118-176、右栏 effect ~56-115;`app/globals.css:244-331`) | 改动计划 |
| 7 | (自查)topBarRef 归属 | 抽顶栏后这个 ref 怎么办? | **留在 AppShell 透传给 TopBar**:它双重用途(ResizeObserver 定位下拉面板 + 给 BranchNavigator 当锚点),不能下放到子组件内部 | 自查(`components/AppShell.tsx:38,87-95,497,612`) | 改动计划 |
| 8 | (gate3 边界压测)行为清单 | 有哪些行为绝不能拆丢? | 8 类必须原样保留:①左右栏拖拽全套手感 ②顶栏下拉面板随宽度重测位置 ③session 选择/新建/删除+`?session=` 网址同步+切换时清空 ④初始 `?session=` 网址恢复的防抖(避生产 Suspense 重载坑) ⑤手机端遮罩层 ⑥文件/Git 标签开关 ⑦主题切换 ⑧开终端。用户确认"没漏" | 用户确认(gate3,`边界=没漏`) | 验收标准 |

## 漏扫核实记录

三轮核实闸(校准②范围收敛前 / 校准③改动计划前 / gate5 回补后)均**无漏扫线索积压**,清单始终为空。

说明:本需求为 UI 结构重构,澄清过程中用户回答(`Q1-3=A,A,B`、`P1-2+边界=A,接受,没漏`)未冒出调研未覆盖的新文件/新行为/新场景。用户确认的 8 类必保行为(#8)全部来自主循环自查读透 AppShell.tsx 全文 + ChatWindow/useAgentSession 上抛契约,无新增线索需核实。**注:本环境无 Agent 工具,无法派 spec-researcher 子代理,降级为主循环自查——证据要求不降,主循环已用 Read 读透 `components/AppShell.tsx` 全 904 行 + `ChatWindow.tsx`/`useAgentSession.ts` 的上抛接口契约。**

## 需求质量清单(gate5 留档)

| # | 质量维度 | 盘问问题 | 覆盖? | 证据 |
|---|---------|---------|-------|------|
| Q1 | 术语唯一性 | 名词都有唯一定义?无重载词? | ✅ | 术语对齐表:AppShell/topBar/sidebar/rightPanel/拖拽调宽 均语义唯一,无歧义 |
| Q2 | 边界与异常 | 边界行为都定义了? | ✅(本任务"边界"=必保行为清单) | 决策树 #6(左右拖拽差异)、#8(8 类必保行为);用户确认"没漏"。注:本任务为纯结构重构无运行时数据边界(空值/并发/幂等不适用) |
| Q3 | 错误处理 | 失败点如何处理? | ✅(不涉及) | 本任务无新失败点;重构不改 try/catch 结构,现有错误处理(`open-terminal` 的 alert、API fetch 的 catch)原样保留 |
| Q4 | 非功能维度 | 性能/安全/兼容/可访问性? | ✅ | 非功能需求节:性能(不增运行时开销)、兼容(调用方零感知)、可维护性、安全(不碰认证数据)。可访问性/国际化本就不在 AppShell 现状,不引入 |
| Q5 | 验收可测 | 每条验收能答是/否?有对应检查? | ✅ | 验收标准 + 用户验收剧本:每条对应 web-verify 手动回归点;tsc/lint 为客观门禁 |
| Q6 | 假设显式化 | 前提列出?高风险假设当面确认? | ✅ | 范围.假设节;高风险假设"严格零变化+一次性"已 gate4 当面确认 |
| Q7 | 方案最小化与改动边界 | 每个新建项有对应需求?复用优先?改动边界清楚? | ✅ | 决策树 #0(复用 `createSidebarWidthTracker`/`SessionSidebar`);改动计划每行对应需求;改动边界节明确允许改/禁止改/需停下确认;Q1=A 锁定最小范围(只减重不治状态流) |

**关键取舍**:选"纯减重"而非"减重+治状态流",是为了把高风险(改子组件接口、动状态流)排除在外,换取"严格零行为变化"的可验证性——在零测试的项目里,零变化是最安全的重构策略。

## 技术上下文

**现有实现**:

- `components/AppShell.tsx`(904 行单函数):13 类职责全堆一个函数
- `lib/sidebar-width.ts:6` `createSidebarWidthTracker(opts)` → 已是独立 hook,返回 `{ next(rawWidth): {changed, width} }`,左右栏都在用,**可直接复用**
- `components/SessionSidebar.tsx` 等:已是独立组件,无需动

**依赖**:

- 无新增依赖(纯结构搬运)

**约束**:

- 必须保持 Next.js App Router 的 `"use client"` 边界(AppShell 是 client component)
- 必须保持 `app/page.tsx` 调用方零感知(默认导出 `AppShell`)

### 关键词扫描证据(代码需求必填)

- 关键词组:`AppShell`(定义/导出/调用)、`topBarRef`、`sidebarWidth`/`rightPanelWidth`、`createSidebarWidthTracker`、`handleSelectSession`/`handleNewSession`/`handleSessionForked`/`handleCwdChange`(session 编排)、`onBranchDataChange`/`onSystemPromptChange`/`onSessionStatsChange`/`onContextUsageChange`(上抛回调)、`sidebar-container`/`right-panel-container`(CSS class)
- 扫描范围:`components/AppShell.tsx` 全文、`components/ChatWindow.tsx`(上抛契约)、`hooks/useAgentSession.ts`(上抛数据来源)、`app/globals.css`(布局 class 依赖)、`app/page.tsx`(调用方)、`lib/sidebar-width.ts`(可复用件)
- 结论:AppShell 是唯一定义点 + 唯一编排点;上抛回调链 AppShell←ChatWindow←useAgentSession 已确认完整;CSS class 依赖确认在 `globals.css:244-331`,不可改名;`app/page.tsx` 是调用方,需保持默认导出

### 影响链路覆盖(代码需求必填)

| 环节 | 文件 | 关键证据 | 结论 |
|------|------|----------|------|
| 入口/调用方 | `app/page.tsx` | 导入 `AppShell` 默认导出 | 存在,需保持默认导出 |
| session 编排 | `components/AppShell.tsx` | `handleSelectSession`/`handleNewSession`/`handleCwdChange`/`handleSessionForked` + `?session=` 网址同步 + 初始恢复防抖 | 存在,必须原样保留 |
| 上抛数据流 | `ChatWindow.tsx:12-23` props + `useAgentSession.ts:110-705` | 4 个 onXxxChange 回调 + contextUsage/systemPrompt 来源 | 存在,本次不改这条链 |
| 布局/拖拽 | `AppShell.tsx` 左右 effect + `app/globals.css:244-331` | 两套拖拽逻辑 + CSS class + CSS 变量 | 存在,合并需参数化差异 |
| 可复用件 | `lib/sidebar-width.ts:6` | `createSidebarWidthTracker` | 存在,直接复用 |
| 子组件接口 | `SessionSidebar`/`ChatWindow`/`FileViewer`/`BranchNavigator`/`GitPanel`/`ModelsConfig`/`SkillsConfig`/`TabBar` | 各自 Props 接口 | 存在,本次一律不改 |

### Code Map

```markdown
## Code Map

> base_ref: 9866e71 (git short hash, 当前 HEAD)
> scanned_at: 需求澄清阶段(2026-06-30)
> 注:工作区有本任务无关的脏改动(GitPanel.tsx/useAgentSession.ts/package.json 等),base_ref 以 HEAD 为准;本任务改动不与脏改动文件重叠

| 文件 | 用途 | 粗粒度关键符号 | 与需求的关系 |
|------|------|---------------|-------------|
| `components/AppShell.tsx` | 应用主骨架(待拆) | `AppShell` 默认导出;`topBarRef`/`appShellRef`;左右拖拽 effect;session 编排 handlers;顶栏/右面板/占位页 JSX | 本任务唯一改动的现有文件 |
| `app/page.tsx` | AppShell 调用方 | 导入 `AppShell` | 需保持默认导出零感知 |
| `components/ChatWindow.tsx` | 聊天主区 | Props 含 4 个 onXxxChange 上抛回调(`:12-23`) | 接口不改 |
| `hooks/useAgentSession.ts` | session 逻辑 hook | `contextUsage`/`systemPrompt` 来源(`:110-705`) | 不改 |
| `lib/sidebar-width.ts` | 拖拽调宽工具 | `createSidebarWidthTracker(opts)`(`:6`) | 直接复用,不改 |
| `app/globals.css` | 布局 CSS | `.sidebar-container`/`.right-panel-container`/`--sidebar-width`(`:244-331`) | class 名不可改 |
| `components/SessionSidebar.tsx` 等 8 个子组件 | AppShell 的子零件 | 各自 Props 接口 | 一律不改 |
```

## 推荐方案

**方案 1(推荐,采用)**:

- 描述:纯减重——抽 TopBar/RightPanel/EmptyState/图标 到 `components/app-shell/`,左右拖拽合并成一个参数化 hook(保留两套差异),AppShell 仍持有所有状态并下传 props
- 优点:风险最低;行为严格零变化;每步可独立 tsc/lint 验证
- 缺点:AppShell 仍管所有状态(债还了一半);TopBar props 较长(15+)
- 风险:拖拽手感差异若参数化不到位会出 bug → 靠决策树 #6 自查 + web-verify 回归兜底

**方案 2(备选,本次不用)**:减重 + 治状态上抛(引入 Context/共享数据层)。用户在 Q1 已明确否决。

## 改动计划(必填,已与用户对齐)

| 文件 | 动作 | 改什么 | 为什么(对应需求/决策) | 风险 |
|------|------|--------|------------------|------|
| `components/app-shell/icons.tsx` | 新建 | 集中 AppShell 里散落的内联 SVG 图标(sidebar toggle/theme/terminal/git/system/file panel 等)为具名导出 | 决策树 #0/#1 减重;图标集中便于维护 | 低:纯搬运,无逻辑 |
| `components/app-shell/useResizablePanel.ts` | 新建 | 合并左右两套拖拽调宽 effect 成一个参数化 hook;参数区分:实时改 CSS 变量 vs 改 state、localStorage key、手机端禁用、生效条件(仅面板打开时) | 决策树 #6(保留两套差异)+ #1 减重 | 中:拖拽手感差异需参数化到位 |
| `components/app-shell/TopBar.tsx` | 新建 | 抽出顶栏(36px 操作条 + 统计显示 + 下拉面板定位);接收 15+ props,`topBarRef` 从 AppShell 透传进来 | 决策树 #7(topBarRef 归属)+ #1/#4 减重入子目录 | 低:纯渲染块搬运 |
| `components/app-shell/RightPanel.tsx` | 新建 | 抽出右面板(文件标签 TabBar + FileViewer 容器 + 文件面板开关按钮) | #1/#4 减重 | 低:纯渲染块搬运 |
| `components/app-shell/SidebarPanel.tsx`(或合并进 AppShell) | 视情况新建 | 抽出左栏容器(SessionSidebar + Models/Skills 按钮 + 遮罩层 + 拖拽手柄);若足够简单也可留在 AppShell | #1/#4 减重 | 低 |
| `components/app-shell/EmptyState.tsx` | 新建 | 抽出"Get Started"占位页 | #1/#4 减重 | 低:纯静态 JSX |
| `components/AppShell.tsx` | 改 | 瘦身:导入并组合上述子块;保留所有状态 + session 编排 handlers + `topBarRef`/`appShellRef`;默认导出 `AppShell` 不变 | 需求1(调用方零感知)+ #1/#2 | 中:接线必须精确 |

**关键取舍**:子块都放 `components/app-shell/` 子目录(决策 #4),而非平铺到 `components/` 根——因为现有 `components/` 已 20 个文件平铺,再塞 5-6 个会更乱;子目录能清楚表达"这些是 AppShell 的内部零件"。

**接线策略**(降低中风险):每抽一个子块,立即 `tsc --noEmit` 验证接线正确,再抽下一个,层层确认——这不算"分步交付给用户",是实现纪律(用户要的"一次性做完"指交付,不指一次性写完不验证)。

## 验收标准

- [ ] `app/page.tsx` 零改动,`AppShell` 仍是 `components/AppShell.tsx` 的默认导出
- [ ] `components/app-shell/` 下有清晰的子文件(图标/hook/TopBar/RightPanel/EmptyState 等)
- [ ] 左右拖拽调宽手感与重构前**完全一致**(左栏实时跟随、右栏改 state、手机端禁用、localStorage 持久化)
- [ ] 顶栏所有按钮(sidebar toggle/theme/terminal/git/branch/system)功能不变
- [ ] session 选择/新建/删除 + `?session=` 网址同步 + 切换时清空分支树/system prompt 行为不变
- [ ] 初始 `?session=` 网址恢复行为不变(含防抖)
- [ ] 手机端遮罩层、文件/Git 标签开关行为不变
- [ ] `tsc --noEmit` 通过
- [ ] `npm run lint` 通过

## 用户验收剧本(必填)

| # | 用户要做什么 | 入口/命令/页面 | 期望看到什么 | 覆盖的验收标准 | 失败时记录什么 |
|---|-------------|----------------|--------------|----------------|----------------|
| 1 | 启动 dev server 打开应用 | `npm run dev` → `http://localhost:3030` | 页面正常加载,左栏/顶栏/聊天区布局与之前一致 | 验收1/2/4 | 控制台报错、布局错位 |
| 2 | 拖动左栏右边框改宽度 | 鼠标拖动 sidebar-resize-handle | 宽度实时跟随鼠标、松手后刷新仍保持(localStorage) | 验收3 | 拖不动/宽度跳变/刷新丢失 |
| 3 | 拖动右面板左边框改宽度 | 先开右面板(右上角按钮),再拖动 | 宽度实时跟随、仅面板打开时可拖、刷新后保持 | 验收3 | 同上 |
| 4 | 切换深浅色主题 | 点顶栏主题按钮 | 主题切换动画/效果与之前一致 | 验收4 | 切换无效 |
| 5 | 选一个历史会话 | 左栏点会话项 | 网址变 `?session=xxx`、聊天区加载该会话 | 验收5 | 网址不同步/会话不加载 |
| 6 | 刷新页面 | F5 | 自动恢复到 `?session=` 指定的会话(不卡死、不重复加载) | 验收6 | 卡死/Suspense 反复重载 |
| 7 | 切换项目目录(cwd) | 左栏切换 cwd | 当前会话清空、分支树/system 清空、回到 `/` | 验收5 | 状态残留 |
| 8 | 开文件标签 + Git 标签 | 顶栏 git 按钮 / 文件树点文件 | 右面板标签页正常切换 | 验收7 | 标签不开关/内容错 |

> 本任务为纯结构重构,用户可见行为**应为零变化**——以上剧本是回归验证,期望全部"和以前一样"。

## 测试清单(必填,TDD 红灯清单)

本任务为**纯结构重构,无行为/逻辑/状态/数据变化**,按 auto-dev 规则 **TDD 可豁免**(豁免原因:无新逻辑分支、无 bug 修复、无状态流转变化;纯渲染块搬运 + 重复逻辑合并)。

豁免 TDD 后的等价可运行验证(替代 Red→Green):

- [ ] `tsc --noEmit` 类型检查通过(接线的客观门禁)
- [ ] `npm run lint` 通过
- [ ] web-verify 手动回归:按"用户验收剧本"8 条逐项确认行为零变化(这是重构正确性的核心证据)

注:`useResizablePanel` hook 合并时,可加一条**等价行为检查**(可选):重构前后,给定相同拖拽输入,左右栏宽度计算结果一致。但项目无组件测试设施,这条以 web-verify 手动拖拽回归(剧本#2/#3)兜底。

## 代码导览策略(必填)

- 导览模式:**省心**(主)+ 越界即停
- 本需求建议模式:省心。原因:纯结构重构无行为变化、用户已确认零变化、且要求一次性做完;频繁打断无价值
- 导览触发点:
  - [x] 仅最终短导览(完成后给一张"文件地图 + 没碰什么 + 以后改哪"的短导览)
  - [ ] 第一片完成后导览(本次一次性做,不分片)
  - [x] 改公共组件/API/schema/权限/数据前必须停下确认 —— 本任务边界禁止碰这些,若撞上立即停
  - [x] 实现与计划冲突或越界时立即停下(如发现某子块必须动 ChatWindow props)
- 导览必须回答:
  1. 用户动作从哪里进入?(仍从 `app/page.tsx` → `AppShell`)
  2. 核心编排在哪?(AppShell 仍持有所有状态 + session handlers)
  3. 数据/状态怎么流?(**不变**——ChatWindow 仍上抛给 AppShell,本次不治)
  4. 这次没碰哪些公共能力?(ChatWindow/SessionSidebar 等子组件接口、CSS class、localStorage key、状态流——一律没碰)
  5. 后续想改类似需求(治状态上泄)先看哪 3 个文件?(`components/AppShell.tsx`、`components/ChatWindow.tsx` 上抛回调、`hooks/useAgentSession.ts` 数据来源)

## 执行评估

- **执行规模**:标准执行(改 1 个现有文件 + 新建 5-6 个文件,有接线集成点)
- **质量门禁**:
  - TDD:**可豁免**(纯结构重构无行为/逻辑/状态变化),等价验证用 tsc/lint/web-verify
  - Review:标准执行默认 reviewer,但**本环境无 Agent 工具**(无 planner/worker/reviewer 子代理)→ **降级为主循环自审**,明说残余风险;自审重点:接线是否精确、拖拽差异是否保留、CSS class/key 是否未改、调用方是否零感知
  - Verification:`tsc --noEmit` + `npm run lint` + web-verify 手动回归 8 条
  - Checkpoint:文件级回退(本任务目标文件 AppShell.tsx + 新目录 components/app-shell/ 与工作区现有脏改动**不重叠**;出问题可 `git checkout components/AppShell.tsx` + 删除新目录廉价回退)
- **建议路由**:主循环执行(降级,因无 Agent 工具)+ 自审 + web-verify 回归
- **环境降级声明**:本会话无 Agent/planner/worker/reviewer 工具,auto-dev 的委派降级为主循环执行,**质量门禁不降**(tsc/lint/web-verify 全跑,自审按 reviewer checklist 执行)

## 移交执行

需求已明确,下一步:

- [x] 进入执行(auto-dev 路由:标准执行,TDD 豁免,主循环执行+自审+web-verify)
- [x] 复用本 spec 的 Code Map(base_ref `9866e71`)、改动计划、改动边界
- [x] 遵守改动边界:只动 AppShell.tsx + 新建 components/app-shell/;子组件接口/CSS class/localStorage key/状态流一律禁改
- [x] 按用户验收剧本 8 条做 web-verify 回归
- [x] 按代码导览策略:省心模式,最终短导览 + 越界即停
- [ ] 仍有问题待用户确认:无

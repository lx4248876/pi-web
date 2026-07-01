# Pi-Web UI Style Guide (UI 风格规范与复用指南)

本篇文档是基于 `pi-web` 全局 UI 设计、高保真组件、主题变量、色彩与动效所提取的**「极简主义、高对比度、无投影（No Shadows）、1px 细边框物理质感、高密度信息流」**的高标准开发者工具 UI 复用指南。

你可以直接利用本规范中的变量和组件原则复用到其他现代 React / Tailwind / Next.js 项目中。

---

## 🏛 1. 设计哲学 (Design Philosophy)

* **极简边框限制 (Minimal 1px Borders)**：整体界面摒弃浓重的投影与多色卡片叠加，完全通过 `1px` 精细的物理边框进行层级划分。
* **暗色模式首等支持 (Dark Mode Native)**：两套色彩均采用低饱和度、高对比度的冷/中性灰色，极大降低长时间编码和阅读字符时的视觉疲劳。
* **高信息密度布局 (High Density)**：默认字号为 `14px`（代码等宽字体 `12.5px` ~ `13px`），利用弹性伸缩抽屉（`Sidebar` 和 `Right Panel`）兼顾紧凑工作区和沉浸式阅读空间。
* **灵敏微动效 (Resonant Micro-animations)**：拒绝低效的漫长过渡。折叠面板、宽高拖拽均使用 `0.2s cubic-bezier` 或是 `0.12s` 极速线性反馈。

---

## 🎨 2. 核心调色盘与 CSS 主题变量 (Color Tokens)

在其他项目的全局 CSS 中定义以下变量。该调色盘精细地区分了背景面板、选中行高亮、气泡背景色、操作警告色等。

```css
@import "tailwindcss";

@theme {
  --color-bg: var(--bg);
  --color-bg-panel: var(--bg-panel);
  --color-bg-hover: var(--bg-hover);
  --color-bg-selected: var(--bg-selected);
  --color-border: var(--border);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-text-dim: var(--text-dim);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-user-bg: var(--user-bg);
  --color-assistant-bg: var(--assistant-bg);
  --color-tool-bg: var(--tool-bg);
  --color-bg-subtle: var(--bg-subtle);
  --font-mono-font: var(--font-mono);
}

:root {
  --bg: #ffffff;                 /* 画布核心背景：纯白 */
  --bg-panel: #f5f5f5;           /* 侧边栏/顶栏/代码头灰色背景 */
  --bg-hover: #eeeeee;           /* 行悬浮亮灰 */
  --bg-selected: #e8e8e8;        /* 选项卡/激活态灰色 */
  --border: #e0e0e0;             /* 全局统一细边框：1px 浅灰色 */
  --text: #1a1a1a;               /* 核心正文字体色 */
  --text-muted: #6b7280;         /* 次要信息/描述字体色 */
  --text-dim: #9ca3af;           /* 极淡占位符/提示音字体色 */
  --accent: #2563eb;             /* 交互高亮/主按钮：经典科技蓝 */
  --accent-hover: #1d4ed8;       /* 交互蓝悬停 */
  --user-bg: #eff6ff;            /* 用户消息气泡：科技浅蓝底 */
  --assistant-bg: #ffffff;       /* 助手卡片：纯白背景 */
  --tool-bg: #f9fafb;            /* 工具执行过程区 */
  --bg-subtle: rgba(0,0,0,0.03);  /* 中性极透遮罩 */
  --font-mono: var(--font-noto-mono), 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
}

html.dark {
  --bg: #1a1a1a;                 /* 暗色核心背景：碳黑 */
  --bg-panel: #242424;           /* 侧边栏/顶栏/代码头灰色背景 */
  --bg-hover: #2e2e2e;           /* 悬浮暗灰 */
  --bg-selected: #383838;        /* 选项卡激活暗灰 */
  --border: #3a3a3a;             /* 细边框暗灰色 */
  --text: #e8e8e8;               /* 核心正文字体色：高亮米白 */
  --text-muted: #9ca3af;         /* 次要信息灰色 */
  --text-dim: #6b7280;           /* 禁用/极淡占位 */
  --accent: #60a5fa;             /* 高亮：淡科技蓝 */
  --accent-hover: #93c5fd;       /* 蓝悬停 */
  --user-bg: #1e293b;            /* 用户消息气泡：深海黛蓝 */
  --assistant-bg: #1a1a1a;       /* 助手卡片 */
  --tool-bg: #1f2937;            /* 工具执行过程深灰区 */
  --bg-subtle: rgba(255,255,255,0.04);
}
```

---

## 📄 3. 排版与基础元素 (Typography & Elements)

开发辅助和 AI 工具最强调阅读的节奏感。Pi UI 对于正文字体、代码和滚动条有严苛的要求：

### 3.1 全局滚动条高仿（微细化）
放弃系统自带厚重的滚动条，仅对交互元素使用 `4px` 极细悬浮灰色。
```css
::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-dim);
}
```

### 3.2 精准 Markdown 密度
```css
.markdown-body {
  font-size: 14px;
  line-height: 1.7; /* 保证高密度排版下的字符可读 */
  color: var(--text);
}
.markdown-body h1, .markdown-body h2 {
  font-weight: 600;
  margin: 10px 0 4px;
  font-size: 1.15em; /* 降低层级标题差异，采用极简卡片式层级 */
}
.markdown-body h1 { font-size: 1.15em; }
.markdown-body h2 { font-size: 1.05em; }
.markdown-body a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
```

---

## 🧩 4. 核心组件复用标准与代码片断 (Component Standards)

### 4.1 顶栏 (Top Navigation Bar) 与 侧边缩放双轨面板
* **高度**：统一为 `36px`，左、中、右对齐。
* **边界**：使用 `border-bottom: 1px solid var(--border)`。
* **缩放动效 CSS**：
  ```css
  .sidebar-container {
    position: relative;
    overflow: hidden;
    transition: width 0.2s ease, min-width 0.2s ease;
  }
  .sidebar-container.sidebar-open {
    width: var(--sidebar-width, 260px);
    border-right: 1px solid var(--border);
  }
  .sidebar-container.sidebar-closed {
    width: 0 !important;
    min-width: 0 !important;
    border-right: none !important;
  }
  ```

* **无噪拖拽控制柄 (Resize Handle)**：
  ```tsx
  <div className="sidebar-resize-handle"
    style={{
      width: '5px',
      cursor: col-resize',
      position: 'relative',
      zIndex: 201,
      transition: 'background 0.15s',
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
  >
    {/* 拖动中心触感刻度线 */}
    <div style={{ width: '2px', height: '24px', borderRadius: '1px', background: 'var(--border)' }} />
  </div>
  ```

### 4.2 现代对话输入框 (Chat Input)
* **输入框容器**：高度随文字自适应（最大限制在 `200px` 内溢出滚动），采用微圆角 `14px`。
* **无阴影风格底托**：
  ```css
  box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10);
  ```
* **状态渲染**：
  * **常态**：`border: 1px solid var(--border)`。
  * **流式运行打断状态 (Steer Mode Active)**：采用橙黄色亮框变道，指示可以立即注入：
    ```css
    border: 1px solid rgba(234, 179, 8, 0.4);
    ```

* **按钮微观样式**：
  ```tsx
  <button style={{
    padding: "7px 14px",
    background: isActive ? "var(--accent)" : "var(--bg-panel)",
    border: "none",
    borderRadius: "8px",
    color: isActive ? "#fff" : "var(--text-dim)",
    fontSize: "13px",
    fontWeight: 600,
    transition: "background 0.15s, box-shadow 0.15s"
  }}>
    Send
  </button>
  ```

### 4.3 渐变折叠代码卡片 (CodeBlock with Fade Overlay)
* **结构层级**：头部展示栏（面板背景、文本和展开收起选项）+ 代码区 + 底部自适应高度渐变。
* **代码区最大折叠限制**：`300px` （超过 45 行智能折叠）。
* **底部半透遮罩**：
  ```css
  background: linear-gradient(to top, var(--bg) 15%, rgba(0,0,0,0) 100%);
  ```

### 4.4 友好极简报错容器 (Error Banner Callouts)
当底层接口和鉴权发生错误时，不要采用过亮、高饱和的深红警告，应使用低饱和透底淡色气泡呼应界面：
```tsx
<div style={{
  marginTop: "4px",
  padding: "10px 12px",
  borderRadius: "8px",
  background: "rgba(239, 68, 68, 0.08)",       /* 8% 非刺眼红低饱和度透底 */
  border: "1px solid rgba(239, 68, 68, 0.35)",  /* 淡红色卡片分界 */
  color: "#ef4444",                            /* 适中色值的醒目红 */
  fontSize: "13px",
  lineHeight: "1.6"
}}>
  {/* 错误子卡片正文 */}
</div>
```

---

## ⚡ 5. 微渲染动画 (Transitions & Animations)

Pi UI 的所有操作多属于小步快速验证，因此系统采用了数个精致流畅缩短过渡阻尼的微动效：

```css
/* 圆形光晕渲染 (Theme Toggle via view transitions) */
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}

/* 按钮点击保存时的物理回弹动效 */
@keyframes saved-pop {
  0%   { transform: scale(1); box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.55); }
  40%  { transform: scale(1.08); box-shadow: 0 0 0 6px rgba(74, 222, 128, 0.25); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
}

/* 加载中的呼吸闪烁动效 */
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* 拖拽上传区域的淡入回响动效 */
@keyframes drop-zone-in {
  from { opacity: 0; transform: scale(0.97); }
  to   { opacity: 1; transform: scale(1); }
}
```

---

## 🚀 6. 复用集成三步走
1. **全局预置**：将本指南的第 2 部分 CSS 样式和 `:root/html.dark` 导入你项目的全局 CSS 文件。
2. **剔除阴影**：在所有布局框、选项卡（Tabs）和菜单弹出层上尽可能避免过重的 `shadow-2xl`，统一靠 `border: 1px solid var(--border)` 营造清晰紧凑的高保真面板感。
3. **控制密度**：保持主体行高控制在合理的高密度下（例如，项目树行高 `22px` 左右），界面更干练。

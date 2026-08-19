"use client";

import { SessionSidebar } from "@/components/SessionSidebar";

type SessionSidebarProps = React.ComponentProps<typeof SessionSidebar>;

interface SidebarPanelProps extends SessionSidebarProps {
  onOpenModels: () => void;
  onOpenSkills: () => void;
  onOpenPackages: () => void;
  skillsDisabled: boolean;
}

/**
 * 左栏内容:SessionSidebar(会话/项目目录树)+ 底部 Models/Skills 按钮组。
 * SessionSidebar 的 props 经 ComponentProps 自动推导后透传,避免重复声明。
 * 从 AppShell 抽出的纯渲染块。
 */
export function SidebarPanel({ onOpenModels, onOpenSkills, onOpenPackages, skillsDisabled, ...sidebarProps }: SidebarPanelProps) {
  return (
    <>
      <SessionSidebar {...sidebarProps} />
      <div style={{ padding: "8px", flexShrink: 0, display: "flex", justifyContent: "space-between", gap: 4 }}>
        {([
          {
            label: "Models",
            onClick: onOpenModels,
            disabled: false,
            icon: (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
              </svg>
            ),
          },
          {
            label: "Skills",
            onClick: onOpenSkills,
            disabled: skillsDisabled,
            icon: (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            ),
          },
          {
            label: "Packages",
            onClick: onOpenPackages,
            disabled: false,
            icon: (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.73z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            ),
          },
        ] as { label: string; onClick: () => void; disabled: boolean; icon: React.ReactNode }[]).map(({ label, onClick, disabled, icon }) => (
          <button
            key={label}
            onClick={onClick}
            disabled={disabled}
            title={label}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              height: 26, padding: 0, background: "none", border: "none",
              borderRadius: 6, color: "var(--text-muted)", cursor: disabled ? "default" : "pointer",
              fontSize: 11, opacity: disabled ? 0.35 : 1,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

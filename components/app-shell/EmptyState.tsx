"use client";

/**
 * 空状态占位页:无选中会话且无 cwd 时显示"Get Started"引导,有 cwd 但无会话时提示从侧栏选会话。
 * 从 AppShell 抽出的纯静态展示块。
 */
export function EmptyState({ hasCwd }: { hasCwd: boolean }) {
  if (hasCwd) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
        Select a session from the sidebar
      </div>
    );
  }
  return (
    <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
        <line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" />
      </svg>
      <div>
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Get Started</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
          <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>Select a project directory from the sidebar<br />
          <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>Add models via the <strong style={{ color: "var(--text)" }}>Models</strong> button at the bottom
        </div>
      </div>
    </div>
  );
}

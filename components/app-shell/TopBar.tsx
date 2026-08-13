"use client";

import {BranchNavigator} from "@/components/BranchNavigator";
import type {SessionTreeNode} from "@/lib/types";

export interface SessionStatsData {
    tokens: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    cost?: number;
}
export interface ContextUsageData {
    percent: number | null;
    contextWindow: number;
    tokens: number | null;
}

interface TopBarProps {
    topBarRef: React.RefObject<HTMLDivElement | null>;
    // sidebar toggle
    sidebarOpen: boolean;
    onToggleSidebar: () => void;
    // theme
    isDark: boolean;
    onToggleTheme: (origin: { x: number; y: number }) => void;
    // terminal
    canOpenTerminal: boolean;
    onOpenTerminal: () => void;
    // git
    showGit: boolean;
    gitActive: boolean;
    onOpenGit: () => void;
    // chat-only tools (branch navigator + system button + stats)
    showChatTools: boolean;
    // branch navigator
    branchTree: SessionTreeNode[];
    branchActiveLeafId: string | null;
    onBranchLeafChange: (leafId: string | null) => void;
    // top panel state
    activeTopPanel: "branches" | "system" | "git" | null;
    onTogglePanel: (panel: "branches" | "system" | "git") => void;
    systemBtnRef: React.RefObject<HTMLButtonElement | null>;
    systemPrompt: string | null;
    topPanelPos: { top: number; left: number; width: number } | null;
    // stats display
    sessionStats: SessionStatsData | null;
    contextUsage: ContextUsageData | null;
    rightPanelInset: boolean;
}

/**
 * 顶部 36px 操作条:sidebar 开关、主题、终端、Git、分支导航、System 下拉、token/费用/上下文统计。
 * topBarRef 从 AppShell 透传(双重用途:ResizeObserver 定位下拉 + 给 BranchNavigator 当锚点)。
 * 从 AppShell 抽出的纯渲染块,所有状态由 AppShell 持有并经 props 下传。
 */
export function TopBar(props: TopBarProps) {
    const {
        topBarRef,
        sidebarOpen,
        onToggleSidebar,
        isDark,
        onToggleTheme,
        canOpenTerminal,
        onOpenTerminal,
        showGit,
        gitActive,
        onOpenGit,
        showChatTools,
        branchTree,
        branchActiveLeafId,
        onBranchLeafChange,
        activeTopPanel,
        onTogglePanel,
        systemBtnRef,
        systemPrompt,
        topPanelPos,
        sessionStats,
        contextUsage,
        rightPanelInset,
    } = props;

    return (
        <div
            ref={topBarRef}
            style={{
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
                borderBottom: "1px solid var(--border)",
                height: 36,
                background: "var(--bg-panel)",
            }}
        >
            <button
                onClick={onToggleSidebar}
                title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                    padding: 0,
                    background: "none",
                    border: "none",
                    borderRight: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "color 0.12s",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-muted)";
                }}
            >
                {sidebarOpen ? (
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <line x1="9" y1="3" x2="9" y2="21"/>
                    </svg>
                ) : (
                    <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                    >
                        <line x1="3" y1="6" x2="21" y2="6"/>
                        <line x1="3" y1="12" x2="21" y2="12"/>
                        <line x1="3" y1="18" x2="21" y2="18"/>
                    </svg>
                )}
            </button>
            <button
                onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    onToggleTheme({
                        x: rect.left + rect.width / 2,
                        y: rect.top + rect.height / 2,
                    });
                }}
                title={isDark ? "Switch to light mode" : "Switch to dark mode"}
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                aria-pressed={isDark}
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                    padding: 0,
                    background: "none",
                    border: "none",
                    borderRight: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "color 0.12s",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-muted)";
                }}
            >
                {isDark ? (
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="12" cy="12" r="5"/>
                        <line x1="12" y1="1" x2="12" y2="3"/>
                        <line x1="12" y1="21" x2="12" y2="23"/>
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                        <line x1="1" y1="12" x2="3" y2="12"/>
                        <line x1="21" y1="12" x2="23" y2="12"/>
                        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                    </svg>
                ) : (
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                    </svg>
                )}
            </button>
            <button
                onClick={onOpenTerminal}
                disabled={!canOpenTerminal}
                title={
                    canOpenTerminal
                        ? "Open in system terminal"
                        : "Please select a project first"
                }
                aria-label="Open terminal"
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                    padding: 0,
                    background: "none",
                    border: "none",
                    borderRight: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    cursor: canOpenTerminal ? "pointer" : "not-allowed",
                    flexShrink: 0,
                    transition: "color 0.12s",
                    opacity: canOpenTerminal ? 1 : 0.45,
                }}
                onMouseEnter={(e) => {
                    if (canOpenTerminal) e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-muted)";
                }}
            >
                <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polyline points="4 17 10 11 4 5"/>
                    <line x1="12" y1="19" x2="20" y2="19"/>
                </svg>
            </button>
            {/* Git button */}
            {showGit && (
                <button
                    onClick={onOpenGit}
                    title={gitActive ? "Hide Git panel" : "Open Git panel"}
                    aria-label={gitActive ? "Hide Git panel" : "Open Git panel"}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 36,
                        height: 36,
                        padding: 0,
                        background: "none",
                        border: "none",
                        borderRight: "1px solid var(--border)",
                        color: gitActive ? "var(--text)" : "var(--text-muted)",
                        flexShrink: 0,
                        transition: "color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--text)";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.color = gitActive
                            ? "var(--text)"
                            : "var(--text-muted)";
                    }}
                >
                    <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="7" cy="10" r="2.5"/>
                        <circle cx="17" cy="10" r="2.5"/>
                        <circle cx="7" cy="18" r="2.5"/>
                        <path d="M7 12.5V15.5"/>
                        <path d="M17 12.5v.5a5 5 0 0 1-5 5h-2"/>
                    </svg>
                </button>
            )}
            {showChatTools && (
                <div style={{display: "flex", alignItems: "stretch", height: "100%"}}>
                    <BranchNavigator
                        tree={branchTree}
                        activeLeafId={branchActiveLeafId}
                        onLeafChange={onBranchLeafChange}
                        inline
                        containerRef={topBarRef}
                        open={activeTopPanel === "branches"}
                        onToggle={() => onTogglePanel("branches")}
                        hasSession
                    />
                    <button
                        ref={systemBtnRef}
                        onClick={() => onTogglePanel("system")}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            height: "100%",
                            padding: "0 12px",
                            background:
                                activeTopPanel === "system" ? "var(--bg-selected)" : "none",
                            border: "none",
                            borderTop:
                                activeTopPanel === "system"
                                    ? "2px solid var(--accent)"
                                    : "2px solid transparent",
                            borderRight: "1px solid var(--border)",
                            cursor: "pointer",
                            color:
                                activeTopPanel === "system"
                                    ? "var(--text)"
                                    : "var(--text-muted)",
                            fontSize: 11,
                            whiteSpace: "nowrap",
                            transition: "color 0.1s, background 0.1s",
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--text)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color =
                                activeTopPanel === "system"
                                    ? "var(--text)"
                                    : "var(--text-muted)";
                        }}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                                color: systemPrompt ? "var(--accent)" : "var(--text-dim)",
                                flexShrink: 0,
                            }}
                        >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="8" y1="13" x2="16" y2="13"/>
                            <line x1="8" y1="13" x2="16" y2="13"/>
                            <line x1="8" y1="17" x2="13" y2="17"/>
                        </svg>
                        <span>System</span>
                    </button>
                </div>
            )}
            {/* Session stats — right-aligned in top bar */}
            {showChatTools &&
                (sessionStats || contextUsage) &&
                (() => {
                    const t = sessionStats?.tokens;
                    const c = sessionStats?.cost ?? 0;
                    const fmt = (n: number) =>
                        n >= 1_000_000
                            ? `${(n / 1_000_000).toFixed(1)}M`
                            : n >= 1000
                                ? `${(n / 1000).toFixed(0)}k`
                                : String(n);
                    const costStr =
                        c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;

                    let ctxColor = "var(--text-muted)";
                    let ctxStr: string | null = null;
                    if (contextUsage?.contextWindow) {
                        const pct = contextUsage.percent;
                        if (pct !== null && pct > 90) ctxColor = "#ef4444";
                        else if (pct !== null && pct > 70)
                            ctxColor = "rgba(234,179,8,0.95)";
                        ctxStr =
                            pct !== null
                                ? `${pct.toFixed(0)}% / ${fmt(contextUsage.contextWindow)}`
                                : `? / ${fmt(contextUsage.contextWindow)}`;
                    }

                    const tooltipParts: string[] = [];
                    if (t) {
                        tooltipParts.push(`in: ${t.input.toLocaleString()}`);
                        tooltipParts.push(`out: ${t.output.toLocaleString()}`);
                        tooltipParts.push(`cache read: ${t.cacheRead.toLocaleString()}`);
                        tooltipParts.push(`cache write: ${t.cacheWrite.toLocaleString()}`);
                        if (c > 0) tooltipParts.push(`cost: $${c.toFixed(4)}`);
                    }
                    if (contextUsage?.contextWindow) {
                        const pct = contextUsage.percent;
                        tooltipParts.push(
                            `context: ${pct !== null ? pct.toFixed(1) + "%" : "unknown"} of ${contextUsage.contextWindow.toLocaleString()} tokens`,
                        );
                    }
                    const tooltip = tooltipParts.join("  |  ");

                    return (
                        <div
                            title={tooltip}
                            style={{
                                marginLeft: "auto",
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                paddingLeft: 12,
                                paddingRight: rightPanelInset ? 12 : 48,
                                height: "100%",
                                fontSize: 11,
                                color: "var(--text-muted)",
                                whiteSpace: "nowrap",
                                cursor: "default",
                                fontVariantNumeric: "tabular-nums",
                            }}
                        >
                            {t && t.input > 0 && (
                                <span style={{display: "flex", alignItems: "center", gap: 4}}>
									<svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 10 10"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
										<line x1="5" y1="8.5" x2="5" y2="1.5"/>
										<polyline points="2 4 5 1.5 8 4"/>
									</svg>
                                    {fmt(t.input)}
								</span>
                            )}
                            {t && t.output > 0 && (
                                <span style={{display: "flex", alignItems: "center", gap: 4}}>
									<svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 10 10"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
										<line x1="5" y1="1.5" x2="5" y2="8.5"/>
										<polyline points="2 6 5 8.5 8 6"/>
									</svg>
                                    {fmt(t.output)}
								</span>
                            )}
                            {t &&
                                t.cacheRead > 0 &&
                                (() => {
                                    // 缓存命中率：会话累计的缓存命中占比（越高越省钱省时），原始 token 数仍在 tooltip 里
                                    const total = t.input + t.cacheRead;
                                    const pct =
                                        total > 0 ? Math.round((t.cacheRead / total) * 100) : 0;
                                    return (
                                        <span
                                            style={{display: "flex", alignItems: "center", gap: 4}}
                                        >
											<svg
                                                width="12"
                                                height="12"
                                                viewBox="0 0 10 10"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
												<path d="M8.5 5a3.5 3.5 0 1 1-1-2.45"/>
												<polyline points="6.5 1.5 8.5 2.5 7.5 4.5"/>
											</svg>
											缓存 {pct}%
										</span>
                                    );
                                })()}
                            {costStr && (
                                <span
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        color: "var(--text)",
                                        fontWeight: 500,
                                    }}
                                >
									{costStr}
								</span>
                            )}
                            {ctxStr && (
                                <span
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        color: ctxColor,
                                    }}
                                >
									<svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 10 10"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
										<path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9"/>
										<line x1="1" y1="9" x2="9" y2="9"/>
									</svg>
                                    {ctxStr}
								</span>
                            )}
                        </div>
                    );
                })()}
            {/* Top panel dropdown — shared, only one active at a time */}
            {activeTopPanel && topPanelPos && (
                <div
                    style={{
                        position: "fixed",
                        top: topPanelPos.top,
                        left: topPanelPos.left,
                        width: topPanelPos.width,
                        zIndex: 500,
                    }}
                >
                    {activeTopPanel === "system" && (
                        <div
                            style={{
                                background: "var(--bg-panel)",
                                borderBottom: "1px solid var(--border)",
                            }}
                        >
                            {systemPrompt ? (
                                <div
                                    style={{
                                        maxHeight: "min(600px, 75vh)",
                                        overflowY: "auto",
                                        padding: "12px 16px",
                                        color: "var(--text-muted)",
                                        fontSize: 12,
                                        lineHeight: 1.6,
                                        whiteSpace: "pre-wrap",
                                        fontFamily: "var(--font-mono)",
                                    }}
                                >
                                    {systemPrompt}
                                </div>
                            ) : systemPrompt === "" ? (
                                <div
                                    style={{
                                        padding: "10px 16px",
                                        fontSize: 12,
                                        color: "var(--text-muted)",
                                        fontStyle: "italic",
                                    }}
                                >
                                    System prompt is empty (tools are disabled)
                                </div>
                            ) : (
                                <div
                                    style={{
                                        padding: "10px 16px",
                                        fontSize: 12,
                                        color: "var(--text-muted)",
                                        fontStyle: "italic",
                                    }}
                                >
                                    Send a message to load the system prompt
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

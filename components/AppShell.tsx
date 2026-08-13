"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatWindow } from "./ChatWindow";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { useResizablePanel } from "./app-shell/useResizablePanel";
import { EmptyState } from "./app-shell/EmptyState";
import { TopBar } from "./app-shell/TopBar";
import { RightPanel } from "./app-shell/RightPanel";
import { SidebarPanel } from "./app-shell/SidebarPanel";
import { useTheme } from "@/hooks/useTheme";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import type { Tab } from "./TabBar";

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDark, toggleTheme } = useTheme();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const sidebarResizeHandleRef = useRef<HTMLDivElement>(null);

  // Left sidebar resize — 实时改 CSS 变量驱动 .sidebar-container,松手才落 state,无 localStorage,始终挂载
  const sidebar = useResizablePanel({
    containerRef: appShellRef,
    handleRef: sidebarResizeHandleRef,
    min: 220, max: 520,
    computeWidth: (clientX, rect) => clientX - rect.left,
    defaultWidth: 260,
    cssVarTargetSelector: ".sidebar-container",
    cssVarName: "--sidebar-width",
  });

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const systemBtnRef = useRef<HTMLButtonElement>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "git" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((panel: "branches" | "system" | "git") => {
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, []);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  // Right panel — file tabs only
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  const handleAtMention = useCallback((relativePath: string) => {
    chatInputRef.current?.insertText("`" + relativePath + "`");
  }, []);

  const [initialSessionId] = useState<string | null>(() => searchParams.get("session"));
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !searchParams.get("session"));
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);

  const handleCwdChange = useCallback((cwd: string | null) => {
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount) or during the initial URL restore.
    if (!cwd || suppressCwdBumpRef.current) return;
    // Close any session that belongs to a different cwd — it no longer
    // matches the selected project directory.
    setSelectedSession((prev) => {
      if (prev && prev.cwd !== cwd) return null;
      return prev;
    });
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [router]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setInitialSessionRestored(true);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
      setTimeout(() => { suppressCwdBumpRef.current = false; }, 0);
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [router]);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((k) => k + 1);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [selectedSession, router]);

  const handleOpenFile = useCallback((filePath: string, fileName: string) => {
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      if (prev.find((t) => t.id === tabId)) return prev;
      return [...prev, { id: tabId, label: fileName, filePath }];
    });
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
  }, []);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) setRightPanelOpen(false);
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [fileTabs]);

  // Open the Git tab in the right panel (extracted from TopBar's git button)
  const handleOpenGit = useCallback(() => {
    const gitTabId = "file:git";
    // Toggle: if git is already the active tab and the panel is open, hide it
    if (activeFileTabId === gitTabId && rightPanelOpen) {
      setRightPanelOpen(false);
      return;
    }
    setFileTabs((prev) => {
      if (prev.find((t) => t.id === gitTabId)) return prev;
      return [...prev, { id: gitTabId, label: "Git", filePath: "git" }];
    });
    setActiveFileTabId(gitTabId);
    setRightPanelOpen(true);
  }, [activeFileTabId, rightPanelOpen]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;

  const currentCwd = selectedSession?.cwd ?? newSessionCwd ?? activeCwd ?? null;

  const handleOpenTerminal = useCallback(async () => {
    if (!currentCwd) return;
    try {
      const res = await fetch("/api/open-terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentCwd }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(`Failed to open terminal: ${data.error}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? (e.message || String(e)) : String(e);
      alert(`Failed to open terminal: ${msg}`);
    }
  }, [currentCwd]);

  return (
    <>
    <div ref={appShellRef} style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}>
      {/* Mobile overlay backdrop */}
      <div
        className="sidebar-overlay-backdrop"
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}`}
        style={{
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
          ["--sidebar-width" as string]: `${sidebar.width}px`,
          transition: sidebar.dragging ? "none" : undefined,
        }}
      >
        <SidebarPanel
          selectedSessionId={selectedSession?.id ?? null}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          initialSessionId={initialSessionId}
          onInitialRestoreDone={handleInitialRestoreDone}
          refreshKey={refreshKey}
          onSessionDeleted={handleSessionDeleted}
          selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
          onCwdChange={handleCwdChange}
          onOpenFile={handleOpenFile}
          explorerRefreshKey={explorerRefreshKey}
          onAtMention={handleAtMention}
          onOpenModels={() => setModelsConfigOpen(true)}
          onOpenSkills={() => setSkillsConfigOpen(true)}
          skillsDisabled={!activeCwd && !selectedSession?.cwd && !newSessionCwd}
        />
      </div>

      {sidebarOpen && (
        <div
          ref={sidebarResizeHandleRef}
          className="sidebar-resize-handle"
          style={{
            flexShrink: 0,
            width: 5,
            cursor: "col-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            transition: sidebar.dragging ? "none" : "background 0.15s",
            position: "relative",
            zIndex: 201,
          }}
          onMouseEnter={(e) => { if (!sidebar.dragging) e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { if (!sidebar.dragging) e.currentTarget.style.background = "transparent"; }}
        >
          <div style={{ width: 2, height: 24, borderRadius: 1, background: "var(--border)" }} />
        </div>
      )}

      {/* Center: chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <TopBar
          topBarRef={topBarRef}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          canOpenTerminal={!!currentCwd}
          onOpenTerminal={handleOpenTerminal}
          showGit={!!currentCwd}
          gitActive={activeFileTabId === "file:git" && rightPanelOpen}
          onOpenGit={handleOpenGit}
          showChatTools={showChat}
          branchTree={branchTree}
          branchActiveLeafId={branchActiveLeafId}
          onBranchLeafChange={handleBranchLeafChange}
          activeTopPanel={activeTopPanel}
          onTogglePanel={toggleTopPanel}
          systemBtnRef={systemBtnRef}
          systemPrompt={systemPrompt}
          topPanelPos={topPanelPos}
        />

        {/* Chat content */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
            />
          ) : showPlaceholder ? (
            <EmptyState hasCwd={!!activeCwd} />
          ) : null}
        </div>
      </div>

      <RightPanel
        open={rightPanelOpen}
        tabs={fileTabs}
        activeTabId={activeFileTabId ?? ""}
        onSelectTab={setActiveFileTabId}
        onCloseTab={handleCloseFileTab}
        onClose={() => setRightPanelOpen(false)}
        activeFilePath={activeFileTab?.filePath ?? null}
        cwd={currentCwd ?? undefined}
      />
    </div>
    {/* File panel toggle — always visible at top-right */}
    <button
      onClick={() => setRightPanelOpen((v) => !v)}
      title={rightPanelOpen ? "Hide file panel" : "Show file panel"}
      style={{
        position: "fixed", top: 0, right: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 36, height: 36, padding: 0,
        background: "var(--bg-panel)", border: "none", borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
        color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer", transition: "color 0.12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)"; }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    </button>
    {modelsConfigOpen && (
      <ModelsConfig
        onClose={() => {
          setModelsConfigOpen(false);
          setModelsRefreshKey((k) => k + 1);
        }}
      />
    )}
    {skillsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
      <SkillsConfig cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!} onClose={() => setSkillsConfigOpen(false)} />
    )}
    </>
  );
}

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatWindow } from "./ChatWindow";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { PackagesConfig } from "./PackagesConfig";
import { useResizablePanel } from "./app-shell/useResizablePanel";
import { EmptyState } from "./app-shell/EmptyState";
import { TopBar } from "./app-shell/TopBar";
import { RightPanel } from "./app-shell/RightPanel";
import { SidebarPanel } from "./app-shell/SidebarPanel";
import { useTheme } from "@/hooks/useTheme";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import type { Tab } from "./TabBar";
import { ArtifactDiffViewer } from "./ArtifactDiffViewer";

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDark, toggleTheme } = useTheme();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const [packagesConfigOpen, setPackagesConfigOpen] = useState(false);
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

  // 产物 diff 全屏浮层:点产物触发,显示 HEAD vs 当前改动
  const [artifactDiff, setArtifactDiff] = useState<{ filePath: string; name: string } | null>(null);

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

  const handleStreamingChange = useCallback((sessionId: string | null) => {
    // Front-end knows which session is actually streaming; show its spinner dot.
    setRunningSessionId(sessionId);
  }, []);

  const handleAgentStart = useCallback(() => {
    // Session began running: refresh the list so its terminal dot clears immediately.
    setRefreshKey((k) => k + 1);
  }, []);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  // Refresh the list when a new session's first assistant message lands on disk.
  // The new session's .jsonl file isn't written until that moment, so this makes
  // it appear in the sidebar immediately instead of waiting for agent_end.
  const handleSessionContent = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "", lastMessage: "" }),
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

  // Toggle the file-viewer panel from the top bar (replaces the old top-right
  // floating button, which ended up hidden behind the modal backdrop).
  const handleOpenFiles = useCallback(() => setRightPanelOpen((v) => !v), []);

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

  // Open a fullscreen diff overlay for a turn's written file (HEAD vs 当前改动)
  const handleOpenDiff = useCallback((filePath: string, _name: string) => {
    setArtifactDiff({ filePath, name: _name });
  }, []);

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
          runningSessionId={runningSessionId}
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
          onOpenPackages={() => setPackagesConfigOpen(true)}
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
            // Match the panel background so the 5px drag strip doesn't show a
            // contrasting gap between the sidebar and the top bar.
            background: "var(--bg-panel)",
            transition: sidebar.dragging ? "none" : "background 0.15s",
            position: "relative",
            // 保持低于 sidebar-container(zIndex:200) 的层叠上下文,避免这条竖线
            // 盖住渲染在侧边栏内部的 "Add Project Directory" 弹窗(zIndex:500)。
            // 二者在空间上不重叠,降低后不影响拖拽手柄本身。
            zIndex: 50,
          }}
          onMouseEnter={(e) => { if (!sidebar.dragging) e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { if (!sidebar.dragging) e.currentTarget.style.background = "var(--bg-panel)"; }}
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
          filesOpen={rightPanelOpen}
          onOpenFiles={handleOpenFiles}
        />

        {/* Chat content */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              onAgentStart={handleAgentStart}
              onAgentEnd={handleAgentEnd}
              onStreamingChange={handleStreamingChange}
              onSessionCreated={handleSessionCreated}
              onSessionContent={handleSessionContent}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onOpenFile={handleOpenFile}
              onOpenDiff={handleOpenDiff}
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
    {packagesConfigOpen && (
      <PackagesConfig onClose={() => setPackagesConfigOpen(false)} />
    )}
    {artifactDiff && (
      <ArtifactDiffViewer
        filePath={artifactDiff.filePath}
        cwd={currentCwd ?? undefined}
        onClose={() => setArtifactDiff(null)}
      />
    )}
    </>
  );
}

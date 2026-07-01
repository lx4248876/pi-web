"use client";

import { FileViewer } from "@/components/FileViewer";
import { TabBar, type Tab } from "@/components/TabBar";

interface RightPanelProps {
  open: boolean;
  dragging: boolean;
  width: number;
  resizeHandleRef: React.RefObject<HTMLDivElement | null>;
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  activeFilePath: string | null;
  cwd?: string;
}

/**
 * 右侧文件/Git 查看面板:拖拽手柄 + 容器(宽度由 CSS class + width style 驱动)+ 文件标签 TabBar + FileViewer。
 * 从 AppShell 抽出的纯渲染块。容器始终挂载,宽度变化靠 CSS class(.right-panel-open/closed)动画。
 */
export function RightPanel(props: RightPanelProps) {
  const { open, dragging, width, resizeHandleRef, tabs, activeTabId, onSelectTab, onCloseTab, activeFilePath, cwd } = props;

  return (
    <>
      {/* Right resize handle */}
      {open && (
        <div
          ref={resizeHandleRef}
          style={{
            width: 5,
            cursor: "col-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            transition: dragging ? "none" : "background 0.15s",
            position: "relative",
            zIndex: 201,
          }}
          onMouseEnter={(e) => { if (!dragging) e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { if (!dragging) e.currentTarget.style.background = "transparent"; }}
        >
          <div style={{ width: 2, height: 24, borderRadius: 1, background: "var(--border)" }} />
        </div>
      )}

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        className={`right-panel-container${open ? " right-panel-open" : " right-panel-closed"}`}
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
          width: open ? `${width}px` : 0,
          minWidth: open ? `${width}px` : 0,
          transition: dragging ? "none" : "width 0.2s ease, min-width 0.2s ease",
        }}
      >
        {/* Right panel tab bar */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36, width: "100%", minWidth: 0 }}>
          <div style={{ flex: 1, overflow: "hidden", width: "100%", minWidth: 0 }}>
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
            />
          </div>
        </div>

        {/* File content */}
        <div style={{ flex: 1, overflow: "hidden", width: "100%", minWidth: 0 }}>
          {activeFilePath ? (
            <FileViewer filePath={activeFilePath} cwd={cwd} />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12, width: "100%", minWidth: 0 }}>
              No file open
            </div>
          )}
        </div>
      </div>
    </>
  );
}

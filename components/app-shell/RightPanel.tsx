"use client";

import { useEffect } from "react";
import { FileViewer } from "@/components/FileViewer";
import { TabBar, type Tab } from "@/components/TabBar";
import { useModalRect } from "./useModalRect";

interface RightPanelProps {
  open: boolean;
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onClose: () => void;
  activeFilePath: string | null;
  cwd?: string;
}

/**
 * 文件/Git 查看弹窗：居中(或恢复记忆位置)浮层。标题栏可拖动位移，右下角手柄可调大小，
 * 位置与大小都记忆到 localStorage（经共享 useModalRect），再次打开时恢复。
 * Esc / 遮罩 / 关闭按钮关闭。
 */
export function RightPanel(props: RightPanelProps) {
  const { open, tabs, activeTabId, onSelectTab, onCloseTab, onClose, activeFilePath, cwd } = props;
  const {
    clampedRect: r,
    handleBarPointerDown,
    handleResizePointerDown,
    onPointerMove,
    onPointerUp,
  } = useModalRect({
    storageKey: "pi-web:file-modal-rect",
    defaultWidth: 1100,
    defaultHeight: 620,
  });

  // Esc 关闭编辑区不关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 焦点在输入框/编辑区内不关闭,避免编辑时 Esc 误关弹窗
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Draggable modal */}
      <div
        style={{
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.width,
          height: r.height,
          maxWidth: "calc(100vw - 2px)",
          maxHeight: "calc(100vh - 2px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {/* Title drag bar */}
        <div
          onPointerDown={handleBarPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          title="Drag to move"
          style={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            height: 32,
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border)",
            borderTopLeftRadius: 9,
            borderTopRightRadius: 9,
            cursor: "move",
            userSelect: "none",
          }}
        >
          {/* Grip icon */}
          <span style={{ display: "flex", alignItems: "center", gap: 1, padding: "0 10px", color: "var(--text-dim)" }}>
            {[0, 1].map((row) => (
              <span key={row} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {[0, 1, 2, 3].map((dot) => (
                  <span key={dot} style={{ width: 3, height: 3, borderRadius: "50%", background: "currentColor", opacity: 0.6 }} />
                ))}
              </span>
            ))}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.02em" }}>
            File&nbsp;viewer
          </span>
          <div style={{ marginLeft: "auto" }} />
          <button
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              padding: 0,
              background: "none",
              border: "none",
              borderLeft: "1px solid var(--border)",
              color: "var(--text-muted)",
              cursor: "pointer",
              transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36, width: "100%", minWidth: 0, padding: 0 }}>
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

        {/* Resize handle — bottom-right */}
        <div
          onPointerDown={(e) => { e.stopPropagation(); handleResizePointerDown(e); }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          title="Drag to resize"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 18,
            height: 18,
            cursor: "nwse-resize",
            background: "linear-gradient(135deg, transparent 50%, var(--text-dim) 50%, var(--text-dim) 60%, transparent 60%)",
            opacity: 0.5,
            borderBottomRightRadius: 9,
            zIndex: 2,
          }}
        />
      </div>
    </div>
  );
}
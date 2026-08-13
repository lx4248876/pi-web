"use client";

import { useEffect, useRef, useState } from "react";
import { FileViewer } from "@/components/FileViewer";
import { TabBar, type Tab } from "@/components/TabBar";

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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const STORAGE_KEY = "pi-web:file-modal-rect";
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 620;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 260;
// 四周留白,保证始终有可抓的边
const EDGE = 12;

/** 把矩形夹进视口内(至少露出可操作部分),并限制最小尺寸。 */
function clampRect(r: Rect): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(r.width, MIN_WIDTH), vw - 2 * EDGE);
  const height = Math.min(Math.max(r.height, MIN_HEIGHT), vh - 2 * EDGE);
  const x = Math.max(EDGE, Math.min(r.x, vw - width - EDGE));
  const y = Math.max(EDGE, Math.min(r.y, vh - height - EDGE));
  return { x, y, width, height };
}

/** 读取记忆的矩形;没有则居中。 */
function loadRect(): Rect {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const p = JSON.parse(saved) as Partial<Rect>;
      return clampRect({ x: p.x ?? 0, y: p.y ?? 0, width: p.width ?? DEFAULT_WIDTH, height: p.height ?? DEFAULT_HEIGHT });
    }
  } catch { /* localStorage unavailable, fall through to centered */ }
  const width = Math.min(DEFAULT_WIDTH, window.innerWidth - 2 * EDGE);
  const height = Math.min(DEFAULT_HEIGHT, window.innerHeight - 2 * EDGE);
  return { x: Math.round((window.innerWidth - width) / 2), y: Math.round((window.innerHeight - height) / 2), width, height };
}

function persistRect(r: Rect) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
  } catch { /* persistence is best-effort */ }
}

/**
 * 文件/Git 查看弹窗:居中(或恢复记忆位置)浮层。标题栏可拖动位移,右下角手柄可调大小,
 * 位置与大小都记忆到 localStorage,再次打开时恢复。Esc / 遮罩 / 关闭按钮关闭。
 */
export function RightPanel(props: RightPanelProps) {
  const { open, tabs, activeTabId, onSelectTab, onCloseTab, onClose, activeFilePath, cwd } = props;
  const [rect, setRect] = useState<Rect>(() => (typeof window === "undefined" ? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT } : loadRect()));
  const dragRef = useRef<{ type: "move" | "resize"; startX: number; startY: number; startRect: Rect } | null>(null);

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

  // 每次渲染夹一次,窗口缩放后也不会跑出视口(不改 state,用计算值渲染)
  const r = clampRect(rect);

  const handleBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { type: "move", startX: e.clientX, startY: e.clientY, startRect: clampRect(rect) };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
  };
  const handleBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.type !== "move") return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // 从固定起点算,绝不累加 —— 鼠标挪多少就精确移动多少
    setRect(clampRect({ ...d.startRect, x: d.startRect.x + dx, y: d.startRect.y + dy }));
  };
  const handleBarPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    persistRect(clampRect(rect));
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type: "resize", startX: e.clientX, startY: e.clientY, startRect: clampRect(rect) };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  };
  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.type !== "resize") return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // 从固定起点算,绝不累加 —— 鼠标挪多少就精确改多少
    setRect(clampRect({ ...d.startRect, width: d.startRect.width + dx, height: d.startRect.height + dy }));
  };
  const handleResizePointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    persistRect(clampRect(rect));
  };

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
          onPointerMove={handleBarPointerMove}
          onPointerUp={handleBarPointerUp}
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
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
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
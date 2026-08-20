"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { diffLines, diffWordsWithSpace } from "diff";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "@/hooks/useTheme";
import { applyPreviewTheme } from "@/lib/html-preview-theme";

/* ═══════════════════════════════════════════════════════════
   Side-by-side Diff Modal with collapse + per-hunk rollback
   ═══════════════════════════════════════════════════════════ */

type DiffSegment =
  | { type: "equal"; oldLine: number; newLine: number; text: string }
  | { type: "del"; oldLine: number; text: string }
  | { type: "add"; newLine: number; text: string }
  | { type: "replace"; oldLine: number; newLine: number; oldText: string; newText: string };

type DiffHunk =
  | { type: "equal"; segments: DiffSegment[]; startIdx: number }
  | { type: "change"; segments: DiffSegment[]; startIdx: number };

function computeDiff(oldText: string, newText: string): DiffSegment[] {
  // jsdiff(已安装依赖)做真正的对齐 diff:未变行两侧同时锚定,只标真正变了的行;
  // 取代旧的 Myers SES 首个解,它常把整段(未变行都算作) delete+add,看不出区别。
  const parts = diffLines(oldText, newText);
  const segments: DiffSegment[] = [];
  let oldLine = 1;
  let newLine = 1;
  const pendingDel: string[] = []; // 等待的删除行(后面紧跟新增块 → 按行配对成 replace)

  const flushDel = () => {
    for (const t of pendingDel) segments.push({ type: "del", oldLine: oldLine++, text: t });
    pendingDel.length = 0;
  };

  for (const part of parts) {
    const lines = part.value === "" ? [] : part.value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    if (part.added && !part.removed) {
      if (pendingDel.length === 0) {
        for (const t of lines) segments.push({ type: "add", newLine: newLine++, text: t });
      } else {
        // 删除块紧接新增块 = 替换:按行两两配对成 replace,余量转纯 del/add
        const paired = Math.min(pendingDel.length, lines.length);
        for (let i = 0; i < paired; i++) {
          segments.push({ type: "replace", oldLine: oldLine++, newLine: newLine++, oldText: pendingDel[i], newText: lines[i] });
        }
        for (let i = paired; i < pendingDel.length; i++) segments.push({ type: "del", oldLine: oldLine++, text: pendingDel[i] });
        for (let i = paired; i < lines.length; i++) segments.push({ type: "add", newLine: newLine++, text: lines[i] });
        pendingDel.length = 0;
      }
    } else if (part.removed && !part.added) {
      pendingDel.push(...lines);
    } else {
      flushDel();
      for (const t of lines) segments.push({ type: "equal", oldLine: oldLine++, newLine: newLine++, text: t });
    }
  }
  flushDel();
  return segments;
}

function groupIntoHunks(segments: DiffSegment[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < segments.length) {
    const isChange = segments[i].type !== "equal";
    const start = i;
    const group: DiffSegment[] = [];
    while (i < segments.length && (segments[i].type !== "equal") === isChange) { group.push(segments[i]); i++; }
    hunks.push({ type: isChange ? "change" : "equal", segments: group, startIdx: start });
  }
  return hunks;
}

const CTX = 3; // context lines shown around collapsed equal hunks

/* ─── SVG icon helpers ─── */

function Chevi({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}>
      <polyline points="3 2 7 5 3 8" />
    </svg>
  );
}

/* ─── Diff Modal ─── */

export function PremiumDiffViewer({
  filePath, diffData, historicalDiffHash, isConflict, isWorkingCopy,
  onClose, onResolveConflict, onRollbackFile, onRollbackHunk, tabs,
}: {
  filePath: string;
  diffData: { oldContent: string; newContent: string };
  historicalDiffHash: string | null;
  isConflict: boolean;
  isWorkingCopy: boolean;
  onClose: () => void;
  onResolveConflict: (filePath: string, mode: "mine" | "theirs") => void;
  onRollbackFile: (filePath: string) => void;
  onRollbackHunk: (filePath: string, oldText: string, newText: string) => void;
  /** 可选的多文件 tab 栏,渲染在头部与列头之间 */
  tabs?: { key: string; label: string; active: boolean; onSelect: () => void }[];
}) {
  const { isDark } = useTheme();
  const isHtml = /\.(html?)$/i.test(filePath.split("?")[0]);
  const isMarkdown = /\.(md|mdx|markdown)$/i.test(filePath.split("?")[0]);
  const [viewMode, setViewMode] = useState<"preview" | "diff">(isHtml || isMarkdown ? "preview" : "diff");
  // 切文件(多 tab)或 intial props 变化时,按当前文件类型重置默认视图
  const [showSource, setShowSource] = useState(false);
  useEffect(() => { setViewMode(isHtml || isMarkdown ? "preview" : "diff"); }, [isHtml, isMarkdown]);
  // 文件类型/文件变化时,预览模式的「渲染版 / 源码」切回默认渲染版
  useEffect(() => { setShowSource(false); }, [isHtml, isMarkdown, filePath]);
  const segments = useMemo(() => computeDiff(diffData.oldContent, diffData.newContent), [diffData.oldContent, diffData.newContent]);
  const hunks = useMemo(() => groupIntoHunks(segments), [segments]);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const [collapsedEqual, setCollapsedEqual] = useState<Set<number>>(new Set());
  const [rollingBackHunk, setRollingBackHunk] = useState<number | null>(null);

  useEffect(() => {
    const eq = new Set<number>();
    hunks.forEach((h, i) => { if (h.type === "equal") eq.add(i); });
    setCollapsedEqual(eq);
  }, [hunks]);

  const handleScroll = useCallback((src: "left" | "right") => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const s = src === "left" ? leftRef.current : rightRef.current;
    const d = src === "left" ? rightRef.current : leftRef.current;
    if (s && d) { d.scrollTop = s.scrollTop; d.scrollLeft = s.scrollLeft; }
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, []);

  const toggleHunk = (hi: number) => {
    setCollapsedEqual((prev) => { const next = new Set(prev); if (next.has(hi)) next.delete(hi); else next.add(hi); return next; });
  };

  const toggleAllCollapsed = () => {
    if (collapsedEqual.size > 0) { setCollapsedEqual(new Set()); }
    else { const eq = new Set<number>(); hunks.forEach((h, i) => { if (h.type === "equal") eq.add(i); }); setCollapsedEqual(eq); }
  };

  /** Extract the old/new text for a changed hunk */
  const getHunkTexts = (hunk: DiffHunk): { oldText: string; newText: string } | null => {
    if (hunk.type === "equal") return null;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (const seg of hunk.segments) {
      if (seg.type === "del") { oldLines.push(seg.text); }
      else if (seg.type === "add") { newLines.push(seg.text); }
      else if (seg.type === "replace") { oldLines.push(seg.oldText); newLines.push(seg.newText); }
    }
    return { oldText: oldLines.join("\n"), newText: newLines.join("\n") };
  };

  /** 替换行渲染:用 jsdiff diffWordsWithSpace 对行内做词级高亮,只看得到真正变了的词 */
  const renderReplaceInline = (seg: Extract<DiffSegment,{type:"replace"}>, side: "left" | "right") => {
    const tokens = diffWordsWithSpace(seg.oldText, seg.newText);
    const pieces = side === "left"
      ? tokens.filter((t) => !t.added).map((t) => ({ text: t.value, changed: !!t.removed }))
      : tokens.filter((t) => !t.removed).map((t) => ({ text: t.value, changed: !!t.added }));
    const color = side === "left" ? "#f87171" : "#4ade80";
    return (
      <span style={{ flex: 1, whiteSpace: "pre", paddingLeft: 4 }}>
        {pieces.length === 0 ? "\u00a0" : pieces.map((p, i) => (
          <span key={i} style={{
            color: p.changed ? color : "var(--text-muted)",
            background: p.changed ? (side === "left" ? "rgba(239,68,68,0.18)" : "rgba(34,197,94,0.18)") : "transparent",
            borderRadius: 2,
          }}>{p.text || "\u00a0"}</span>
        ))}
      </span>
    );
  };

  const lineH = 20;
  const hasChanges = segments.some((s) => s.type !== "equal");
  const scrollStyle: React.CSSProperties = { colorScheme: "dark", scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" };

  const renderSegRow = (seg: DiffSegment, side: "left" | "right", idx: number) => {
    if (seg.type === "equal") {
      const ln = side === "left" ? seg.oldLine : seg.newLine;
      return (
        <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, width: "max-content" }}>
          <span style={{ width: 48, textAlign: "right", paddingRight: 8, color: "var(--text-dim)", fontSize: 10, userSelect: "none", flexShrink: 0 }}>{ln}</span>
          <span style={{ flex: 1, color: "var(--text-muted)", whiteSpace: "pre", paddingLeft: 4 }}>{seg.text || "\u00a0"}</span>
        </div>
      );
    }
    if (seg.type === "del") {
      if (side === "left") {
        return (
          <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, width: "max-content", background: "rgba(239,68,68,0.1)", borderLeft: "3px solid #ef4444" }}>
            <span style={{ width: 48, textAlign: "right", paddingRight: 8, color: "var(--text-dim)", fontSize: 10, userSelect: "none", flexShrink: 0 }}>{seg.oldLine}</span>
            <span style={{ flex: 1, color: "#f87171", whiteSpace: "pre", paddingLeft: 4 }}>{seg.text || "\u00a0"}</span>
          </div>
        );
      }
      // Right side: show empty placeholder with same height
      return <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, background: "rgba(234,234,234,0.03)" }}><span style={{ width: 48, flexShrink: 0 }} /><span style={{ flex: 1 }} /></div>;
    }
    if (seg.type === "add") {
      if (side === "right") {
        return (
          <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, width: "max-content", background: "rgba(34,197,94,0.1)", borderLeft: "3px solid #22c55e" }}>
            <span style={{ width: 48, textAlign: "right", paddingRight: 8, color: "var(--text-dim)", fontSize: 10, userSelect: "none", flexShrink: 0 }}>{seg.newLine}</span>
            <span style={{ flex: 1, color: "#4ade80", whiteSpace: "pre", paddingLeft: 4 }}>{seg.text || "\u00a0"}</span>
          </div>
        );
      }
      return <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, background: "rgba(234,234,234,0.03)" }}><span style={{ width: 48, flexShrink: 0 }} /><span style={{ flex: 1 }} /></div>;
    }
    // replace — 行内词级高亮
    const isLeft = side === "left";
    return (
      <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, width: "max-content", background: "rgba(234,179,8,0.08)", borderLeft: "3px solid #eab308" }}>
        <span style={{ width: 48, textAlign: "right", paddingRight: 8, color: "var(--text-dim)", fontSize: 10, userSelect: "none", flexShrink: 0 }}>{isLeft ? seg.oldLine : seg.newLine}</span>
        {renderReplaceInline(seg, side)}
      </div>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2.5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(1600px, 96vw)", height: "85vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, display: "flex", flexDirection: "column", boxShadow: "0 12px 30px rgba(0,0,0,0.25)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-panel)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{historicalDiffHash ? "Commit Diff" : "Working Copy Diff"}</span>
            <div style={{ display: "flex", background: "var(--bg-hover)", borderRadius: 5, padding: 1, border: "1px solid var(--border)" }}>
                <button onClick={() => setViewMode("preview")} style={{ padding: "2px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer", border: "none", fontWeight: 600, background: viewMode === "preview" ? "var(--accent)" : "transparent", color: viewMode === "preview" ? "#fff" : "var(--text-muted)" }}>Preview</button>
                <button onClick={() => setViewMode("diff")} style={{ padding: "2px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer", border: "none", fontWeight: 600, background: viewMode === "diff" ? "var(--accent)" : "transparent", color: viewMode === "diff" ? "#fff" : "var(--text-muted)" }}>Diff</button>
              </div>
            {historicalDiffHash && <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--accent)", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", padding: "1px 5px", borderRadius: 4 }}>{historicalDiffHash}</span>}
          </div>
          <span style={{ flex: 1, textAlign: "center", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text)" }}>{filePath}</span>
          <div style={{ display: "flex", gap: 6 }}>
            {isWorkingCopy && hasChanges && <button onClick={() => onRollbackFile(filePath)} style={{ padding: "4px 10px", fontSize: 11, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>回滚此文件</button>}
            {hasChanges && <button onClick={toggleAllCollapsed} style={{ padding: "4px 10px", fontSize: 11, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 4, cursor: "pointer" }}>{collapsedEqual.size > 0 ? "展开全部" : "折叠未改动"}</button>}
            {isConflict && <><button onClick={() => onResolveConflict(filePath, "mine")} style={{ padding: "4px 10px", fontSize: 11, background: "#22c55e", fontWeight: "bold", border: "none", color: "#fff", borderRadius: 4, cursor: "pointer" }}>Keep Ours</button><button onClick={() => onResolveConflict(filePath, "theirs")} style={{ padding: "4px 10px", fontSize: 11, background: "var(--accent)", fontWeight: "bold", border: "none", color: "#fff", borderRadius: 4, cursor: "pointer" }}>Keep Theirs</button></>}
            <button onClick={onClose} style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>
        {tabs && tabs.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={t.onSelect}
                style={{
                  padding: "3px 10px", fontSize: 11, fontFamily: "var(--font-mono)", borderRadius: 4, cursor: "pointer",
                  background: t.active ? "var(--accent)" : "var(--bg-hover)",
                  color: t.active ? "#fff" : "var(--text-muted)",
                  border: t.active ? "1px solid var(--accent)" : "1px solid var(--border)",
                  fontWeight: t.active ? 600 : 400,
                }}
                title={t.key}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {/* Preview 模式的「渲染版 / 源码」切换:仅 html/md 需要(非 html/md 预览本来就直接显示源码) */}
        {viewMode === "preview" && (isHtml || isMarkdown) && (
          <div style={{ display: "flex", gap: 6, padding: "8px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0, alignItems: "center" }}>
            <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
              <button
                type="button"
                onClick={() => setShowSource(false)}
                style={{ padding: "3px 10px", fontSize: 11, border: "none", cursor: "pointer", background: !showSource ? "var(--bg-selected)" : "var(--bg-hover)", color: !showSource ? "var(--text)" : "var(--text-muted)", fontWeight: !showSource ? 600 : 400 }}
              >
                预览版
              </button>
              <button
                type="button"
                onClick={() => setShowSource(true)}
                style={{ padding: "3px 10px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer", background: showSource ? "var(--bg-selected)" : "var(--bg-hover)", color: showSource ? "var(--text)" : "var(--text-muted)", fontWeight: showSource ? 600 : 400 }}
              >
                源码
              </button>
            </div>
          </div>
        )}
        {/* Preview mode: html 用预览器渲染、md 渲染成文档,其他类型显示改动后内容源码;选「源码」时 html/md 也显示原文 */}
        {viewMode === "preview" ? (
          showSource ? (
          <div style={{ flex: 1, overflow: "auto", padding: "12px 16px", background: "var(--bg)", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre", ...scrollStyle }}>
            {diffData.newContent || "\u00a0"}
          </div>
          ) : isHtml ? (
          <div style={{ flex: 1, display: "flex", minHeight: 0, padding: 12, background: isDark ? "#0d1117" : "#fff" }}>
            <iframe
              title="HTML preview"
              srcDoc={applyPreviewTheme(diffData.newContent, isDark)}
              style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }}
              sandbox="allow-scripts"
              width="100%"
              height="100%"
            />
          </div>
          ) : isMarkdown ? (
          <div style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
            <div className="markdown-body markdown-file-preview" style={{ maxWidth: 800, margin: "0 auto", padding: "24px 20px" }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{diffData.newContent}</ReactMarkdown>
            </div>
          </div>
          ) : (
          <div style={{ flex: 1, overflow: "auto", padding: "12px 16px", background: "var(--bg)", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre", ...scrollStyle }}>
            {diffData.newContent || "\u00a0"}
          </div>
          )
        ) : (
        <>
        {/* Column headers */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-panel)" }}>
          <div style={{ flex: 1, padding: "4px 12px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)", borderRight: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", opacity: 0.6 }} />{historicalDiffHash ? "Parent" : "HEAD (原版)"}</div>
          <div style={{ flex: 1, padding: "4px 12px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", opacity: 0.6 }} />{historicalDiffHash ? "Commit" : "Working Copy (当前)"}</div>
        </div>
        {/* Split panels */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div ref={leftRef} onScroll={() => handleScroll("left")} style={{ flex: 1, overflow: "auto", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: `${lineH}px`, borderRight: "1px solid var(--border)", ...scrollStyle }}>
            {hunks.map((hunk, hi) => {
              const isChange = hunk.type !== "equal";
              const isCollapsed = hunk.type === "equal" && collapsedEqual.has(hi);
              const hunkTexts = isChange ? getHunkTexts(hunk) : null;
              return (
                <React.Fragment key={hi}>
                  {isCollapsed ? (
                    (() => { const total = hunk.segments.length; if (total <= CTX * 2 + 1) return hunk.segments.map((seg, si) => renderSegRow(seg, "left", si));
                      return <>
                        {hunk.segments.slice(0, CTX).map((seg, si) => renderSegRow(seg, "left", si))}
                        <div onClick={() => toggleHunk(hi)} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: lineH, background: "var(--bg-panel)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", cursor: "pointer", color: "var(--text-dim)", fontSize: 10, userSelect: "none", gap: 4 }} onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-muted)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-dim)"}><Chevi open={false} />{total - CTX * 2} unchanged lines</div>
                        {hunk.segments.slice(-CTX).map((seg, si) => renderSegRow(seg, "left", si))}
                      </>;
                    })()
                  ) : (
                    hunk.segments.map((seg, si) => renderSegRow(seg, "left", si))
                  )}
                  {isChange && isWorkingCopy && hunkTexts && hunkTexts.newText && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 24, background: "rgba(239,68,68,0.04)", borderTop: "1px dashed rgba(239,68,68,0.2)", borderBottom: "1px dashed rgba(239,68,68,0.2)" }}>
                      <button
                        disabled={rollingBackHunk === hi}
                        onClick={async () => { setRollingBackHunk(hi); await onRollbackHunk(filePath, hunkTexts.oldText, hunkTexts.newText); setRollingBackHunk(null); }}
                        style={{ fontSize: 10, padding: "2px 8px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 3, cursor: "pointer", color: "#ef4444", fontWeight: 600 }}
                      >{rollingBackHunk === hi ? "回滚中..." : "回滚此段"}</button>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          <div ref={rightRef} onScroll={() => handleScroll("right")} style={{ flex: 1, overflow: "auto", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: `${lineH}px`, ...scrollStyle }}>
            {hunks.map((hunk, hi) => {
              const isCollapsed = hunk.type === "equal" && collapsedEqual.has(hi);
              const isChange = hunk.type !== "equal";
              const hunkTexts = isChange ? getHunkTexts(hunk) : null;
              // Show spacer to match left side rollback bar - must match same condition as left side
              const showSpacer = isChange && isWorkingCopy && hunkTexts && hunkTexts.newText;
              return (
                <React.Fragment key={hi}>
                  {isCollapsed ? (
                    (() => { const total = hunk.segments.length; if (total <= CTX * 2 + 1) return hunk.segments.map((seg, si) => renderSegRow(seg, "right", si));
                      return <>
                        {hunk.segments.slice(0, CTX).map((seg, si) => renderSegRow(seg, "right", si))}
                        <div onClick={() => toggleHunk(hi)} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: lineH, background: "var(--bg-panel)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", cursor: "pointer", color: "var(--text-dim)", fontSize: 10, userSelect: "none", gap: 4 }} onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-muted)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-dim)"}><Chevi open={false} />{total - CTX * 2} unchanged lines</div>
                        {hunk.segments.slice(-CTX).map((seg, si) => renderSegRow(seg, "right", si))}
                      </>;
                    })()
                  ) : (
                    hunk.segments.map((seg, si) => renderSegRow(seg, "right", si))
                  )}
                  {showSpacer && (
                    <div style={{ height: 24 }} /> /* spacer to match left side rollback bar */
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PremiumDiffViewer } from "./PremiumDiffViewer";

interface ArtifactItem {
  path: string;
  name: string;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/**
 * 产物 diff 视图:按 filePath + cwd 从 /api/git-status diff 取
 * {oldContent,newContent}(HEAD 原版 vs 当前改动),喂给现成的
 * PremiumDiffViewer。新文件(HEAD 无内容)oldContent 为空 → 显示全量新增。
 *
 * 该轮所有产物一次传入(artifacts),顶部渲染多 tab:切换文件时只改 activePath,
 * 重新拉该文件的 diff(整批产物一次加载,tab 内反复切换无需关弹窗)。
 */
/** 加载/出错/文件丢失时的兜底浮层,带可关闭的容器(否则弹窗无法消除) */
function Fallback({
  onClose,
  title,
  children,
}: { onClose: () => void; title: string; children?: ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2.5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ position: "relative", minWidth: "min(480px, 92vw)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "24px 28px", textAlign: "center", boxShadow: "0 12px 30px rgba(0,0,0,0.25)" }}>
        <button onClick={onClose} title="关闭" style={{ position: "absolute", top: 10, right: 12, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14, lineHeight: 1 }}>×</button>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
      </div>
    </div>
  );
}

export function ArtifactDiffViewer({ artifacts, filePath, cwd, onClose }: { artifacts: ArtifactItem[]; filePath: string; cwd?: string; onClose: () => void }) {
  const [activePath, setActivePath] = useState<string>(filePath);
  const [state, setState] = useState<{ loading: boolean; data: { oldContent: string; newContent: string; exists: boolean } | null; error: string | null }>({
    loading: true,
    data: null,
    error: null,
  });

  // 打开新一批产物时,把激活项重置为该轮第一个/传入的 filePath
  useEffect(() => { setActivePath(filePath); }, [filePath]);

  useEffect(() => {
    let cancelled = false;
    // 切 tab 时保留已有数据(渲染旧 diff)以避免整块弹窗闪空;
    // 仅首次加载(尚无数据)才需要占位。
    setState((prev) => ({ loading: true, data: prev.data, error: null }));
    (async () => {
      try {
        const res = await fetch("/api/git-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action: "diff", filePath: activePath }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `diff 失败 (${res.status})`);
        if (!cancelled) setState({ loading: false, data: { oldContent: data.oldContent ?? "", newContent: data.newContent ?? "", exists: data.exists !== false }, error: null });
      } catch (e) {
        if (!cancelled) setState({ loading: false, data: null, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [activePath, cwd]);

  const activeName = artifacts.find((a) => a.path === activePath)?.name ?? baseName(activePath);

  if (state.loading && !state.data) {
    return <Fallback onClose={onClose} title={`加载 ${baseName(activePath)}`}>加载 diff…</Fallback>;
  }
  if (state.error && !state.data) {
    return <Fallback onClose={onClose} title="无法加载 diff"><span>{state.error}</span></Fallback>;
  }
  if (!state.data) {
    return null;
  }
  // 文件既不在 HEAD 也读不到磁盘(被删除/改名/家在磁盘外的临时文件):给明确提示,
  // 而不是渲染成一块空白面板(看起来像 not found)。
  if (!state.data.exists && !state.data.oldContent && !state.data.newContent) {
    return <Fallback onClose={onClose} title={activeName}>文件已不在磁盘中(可能已被删除或改名),无法生成 diff</Fallback>;
  }
  return (
    <PremiumDiffViewer
      filePath={activeName}
      diffData={state.data}
      historicalDiffHash={null}
      isConflict={false}
      isWorkingCopy
      onClose={onClose}
      onResolveConflict={() => {}}
      onRollbackFile={() => {}}
      onRollbackHunk={() => {}}
      tabs={artifacts.map((a) => ({
        key: a.path,
        label: a.name,
        active: a.path === activePath,
        onSelect: () => setActivePath(a.path),
      }))}
    />
  );
}
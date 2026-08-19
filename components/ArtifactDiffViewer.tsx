"use client";

import { useEffect, useState } from "react";
import { PremiumDiffViewer } from "./PremiumDiffViewer";

/**
 * 产物 diff 视图:按 filePath + cwd 从 /api/git-status diff 取
 * {oldContent,newContent}(HEAD 原版 vs 当前改动),喂给现成的
 * PremiumDiffViewer。新文件(HEAD 无内容)oldContent 为空 → 显示全量新增。
 */
export function ArtifactDiffViewer({ filePath, cwd, onClose }: { filePath: string; cwd?: string; onClose: () => void }) {
  const [state, setState] = useState<{ loading: boolean; data: { oldContent: string; newContent: string; exists: boolean } | null; error: string | null }>({
    loading: true,
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    (async () => {
      try {
        const res = await fetch("/api/git-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action: "diff", filePath }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `diff 失败 (${res.status})`);
        if (!cancelled) setState({ loading: false, data: { oldContent: data.oldContent ?? "", newContent: data.newContent ?? "", exists: data.exists !== false }, error: null });
      } catch (e) {
        if (!cancelled) setState({ loading: false, data: null, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [filePath, cwd]);

  if (state.loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
        加载 diff…
      </div>
    );
  }
  if (state.error || !state.data) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12, flexDirection: "column", gap: 6 }}>
        <span>无法加载 diff</span>
        <span style={{ color: "var(--text-muted)" }}>{state.error}</span>
      </div>
    );
  }
  // 文件既不在 HEAD 也读不到磁盘(被删除/改名/家在磁盘外的临时文件):给明确提示,
  // 而不是渲染成一块空白面板(看起来像 not found)。
  if (!state.data.exists && !state.data.oldContent && !state.data.newContent) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
        文件已不在磁盘中(可能已被删除或改名),无法生成 diff
      </div>
    );
  }
  return (
    <PremiumDiffViewer
      filePath={filePath}
      diffData={state.data}
      historicalDiffHash={null}
      isConflict={false}
      isWorkingCopy
      onClose={onClose}
      onResolveConflict={() => {}}
      onRollbackFile={() => {}}
      onRollbackHunk={() => {}}
    />
  );
}
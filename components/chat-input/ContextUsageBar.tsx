"use client";

import { useState } from "react";

export interface ContextUsage {
  contextWindow: number | null;
  tokens: number | null;
  percent: number | null;
}

interface Props {
  contextUsage?: ContextUsage | null;
  fmt: (n: number) => string;
}

// 上下文用量：霓虹渐变细线，hover 展开显示数值
export function ContextUsageBar({ contextUsage, fmt }: Props) {
  const [hover, setHover] = useState(false);
  const windowN = contextUsage?.contextWindow ?? null;
  const tokensN = contextUsage?.tokens ?? null;
  const ctxPct = contextUsage?.percent ?? null;
  const clamped = ctxPct === null ? 0 : Math.max(0, Math.min(100, ctxPct));
  const label =
    ctxPct === null
      ? "context —"
      : `${ctxPct.toFixed(0)}%` + (windowN ? ` · ${fmt(tokensN ?? 0)}/${fmt(windowN)}` : "");
  const title =
    ctxPct === null
      ? "context: unavailable yet"
      : `context ${ctxPct.toFixed(1)}% · ${tokensN != null ? tokensN.toLocaleString() : "?"} / ${windowN != null ? windowN.toLocaleString() : "?"} tokens`;
  // 科技风霓虹渐变:青→紫→品红→橙
  const gradient = "linear-gradient(90deg, #22d3ee, #818cf8 30%, #a855f7 52%, #ec4899 74%, #fb923c)";

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} title={title} style={{ position: "relative", marginTop: 7, cursor: "default" } as React.CSSProperties}>
      <div
        style={{
          position: "relative",
          height: hover ? 22 : 4,
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--bg-hover)",
          border: hover ? "1px solid var(--border)" : "none",
          boxShadow: hover ? "0 0 14px rgba(125,211,252,0.28)" : "none",
          transition: "height .18s ease, box-shadow .18s ease",
        }}
      >
        {/* 已用填充:霓虹渐变 + 微光 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${clamped}%`,
            minWidth: 0,
            background: gradient,
            boxShadow: "0 0 8px rgba(103,232,249,0.35)",
            transition: "width .4s ease",
          }}
        >
          {/* 扫描流光 */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: "55%",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.40), transparent)",
              animation: "cyber-scan 2.6s linear infinite",
            }}
          />
        </div>
        {/* hover 数值直接渲染在进度条内部 */}
        {hover && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.03em",
              color: "#fff",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 2,
              textShadow: "0 1px 3px rgba(0,0,0,0.45)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {label}
          </div>
        )}
      </div>
    </div>
  );
}
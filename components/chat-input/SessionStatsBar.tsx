"use client";

interface SessionStats {
  tokens?: {
    input: number;
    output: number;
    cacheRead: number;
  };
  cost?: number | null;
}

interface Props {
  stats: SessionStats | null | undefined;
  fmt: (n: number) => string;
}

export function SessionStatsBar({ stats, fmt }: Props) {
  if (
    !stats ||
    (stats.tokens?.input ?? 0) <= 0 &&
    (stats.tokens?.output ?? 0) <= 0 &&
    (stats.tokens?.cacheRead ?? 0) <= 0 &&
    (stats.cost ?? 0) <= 0
  ) {
    return null;
  }
  const t = stats.tokens ?? { input: 0, output: 0, cacheRead: 0 };
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8,
        marginLeft: 6, paddingLeft: 6,
        borderLeft: "1px solid var(--border)",
        fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums", flexShrink: 0, overflow: "hidden",
      }}
    >
      {t.input > 0 && (
        <span style={{ display: "flex", alignItems: "center", gap: 3 }} title={`in: ${t.input.toLocaleString()}`}>↑{fmt(t.input)}</span>
      )}
      {t.output > 0 && (
        <span style={{ display: "flex", alignItems: "center", gap: 3 }} title={`out: ${t.output.toLocaleString()}`}>↓{fmt(t.output)}</span>
      )}
      {t.cacheRead > 0 &&
        (() => {
          // 缓存命中率：会话累计缓存命中占比，原始 token 数在 hover 里
          const total = t.input + t.cacheRead;
          const pct = total > 0 ? Math.round((t.cacheRead / total) * 100) : 0;
          return <span style={{ display: "flex", alignItems: "center", gap: 3 }} title={`cache read: ${t.cacheRead.toLocaleString()}`}>缓存 {pct}%</span>;
        })()}
      {(stats.cost ?? 0) > 0 && (
        <span style={{ fontWeight: 500, color: "var(--text)" }}>
          {stats.cost! >= 0.01 ? `$${stats.cost!.toFixed(2)}` : "<$0.01"}
        </span>
      )}
    </div>
  );
}
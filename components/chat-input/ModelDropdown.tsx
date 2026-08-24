"use client";

import type { RefObject } from "react";

export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface Props {
  rect: { top: number; left: number; width: number };
  groups: { provider: string; options: ModelOption[] }[];
  current: { provider: string; modelId: string } | null | undefined;
  onSelect: (provider: string, modelId: string) => void;
  panelRef: RefObject<HTMLDivElement | null>;
}

export function ModelDropdown({ rect, groups, current, onSelect, panelRef }: Props) {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const bottom = viewportHeight - rect.top + 6;
  const maxH = Math.max(120, Math.min(rect.top - 8, viewportHeight * 0.6));

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        bottom,
        left: rect.left,
        zIndex: 500,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
        overflow: "hidden",
        width: "max-content",
        minWidth: rect.width,
        maxHeight: maxH,
        overflowY: "auto",
      }}
    >
      {groups.map((group, gi) => (
        <div key={group.provider}>
          {groups.length > 1 && (
            <div
              style={{
                padding: "6px 12px 4px",
                fontSize: 10,
                fontWeight: 600,
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                borderTop: gi > 0 ? "1px solid var(--border)" : "none",
              }}
            >
              {group.provider}
            </div>
          )}
          {group.options.map((opt) => {
            const isActive = opt.modelId === current?.modelId && opt.provider === current?.provider;
            return (
              <button
                key={`${opt.provider}:${opt.modelId}`}
                onClick={() => {
                  if (!isActive) onSelect(opt.provider, opt.modelId);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "7px 12px",
                  background: isActive ? "var(--bg-selected)" : "none",
                  border: "none",
                  color: isActive ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 12,
                  textAlign: "left",
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "none";
                }}
              >
                {isActive ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="1.5 5 4 7.5 8.5 2.5" />
                  </svg>
                ) : (
                  <span style={{ width: 10, flexShrink: 0 }} />
                )}
                {opt.name}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
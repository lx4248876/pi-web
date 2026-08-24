"use client";

const PRESET_DESC: Record<string, string> = {
  off: "无工具，纯聊天",
  default: "4 项内置工具",
  full: "全部内置工具",
};

// key（off/default/full）→ 后端预设值（none/default/full）
const PRESET_VALUES = { off: "none", default: "default", full: "full" } as const;

type PresetValue = (typeof PRESET_VALUES)[keyof typeof PRESET_VALUES];

interface Props {
  current: PresetValue;
  onSelect: (preset: PresetValue) => void;
}

export function ToolPresetDropdown({ current, onSelect }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "calc(100% + 6px)",
        right: 0,
        zIndex: 100,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
        overflow: "hidden",
        minWidth: 120,
      }}
    >
      {(["off", "default", "full"] as const).map((lvl) => {
        const preset = PRESET_VALUES[lvl];
        const isActive = current === preset;
        return (
          <button
            key={lvl}
            onClick={() => {
              if (!isActive) onSelect(preset);
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
            <span style={{ flex: 1 }}>{lvl}</span>
            <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{PRESET_DESC[lvl]}</span>
          </button>
        );
      })}
    </div>
  );
}
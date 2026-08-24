export const TOOL_PRESETS = ["off", "default", "full"] as const;
export const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = { off: "none", default: "default", full: "full" };

// Token 数简短格式化(e.g. 95000 → 95k, 2400 → 2k, 900 → 900)
export function fmtStats(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
}
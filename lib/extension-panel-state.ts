/**
 * pi 扩展的「常驻状态」通道（`ctx.ui.setStatus` / `ctx.ui.setWidget`）的前端状态折叠。
 *
 * 抽成纯函数是为了能测：hook 里的 SSE 分支不好写断言，而这段逻辑有真实语义容易写错——
 * pi 用**空字符串 / 空数组**表示「扩展撤掉这个 key」，不是「显示一个空状态」。
 * 若把空值原样存下来，界面会留一行空标签永远不掉。
 */

/** 应用一次 `setStatus(key, text)`：text 为空表示撤掉该 key。 */
export function applyExtensionStatus(
  prev: Record<string, string>,
  key: string,
  text: string | undefined,
): Record<string, string> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    if (!(key in prev)) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  }
  if (prev[key] === trimmed) return prev;
  return { ...prev, [key]: trimmed };
}

/** 应用一次 `setWidget(key, lines)`：lines 为空表示撤掉该 key。 */
export function applyExtensionWidget(
  prev: Record<string, string[]>,
  key: string,
  lines: string[] | undefined,
): Record<string, string[]> {
  const kept = (lines ?? []).filter((line) => line.trim() !== "");
  if (kept.length === 0) {
    if (!(key in prev)) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  }
  const current = prev[key];
  if (current && current.length === kept.length && current.every((v, i) => v === kept[i])) {
    return prev;
  }
  return { ...prev, [key]: kept };
}
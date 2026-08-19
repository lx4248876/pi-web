/**
 * HTML 文件预览主题适配：把 web 页面当前明暗主题注入到被预览的 HTML 中，
 * 让没有自带底色/文字色的 HTML 在文件查看器里跟随 web 页面的明暗色切换。
 *
 * 用低优先级选择器(html/body)，文件自身写的样式优先，不被覆盖。
 */
export function applyPreviewTheme(html: string, isDark: boolean): string {
  const colorScheme = isDark ? "dark" : "light";
  const bg = isDark ? "#1a1a1a" : "#ffffff";
  const fg = isDark ? "#e5e7eb" : "#1f2937";
  const style = `<style>html{color-scheme:${colorScheme}}body{background-color:${bg};color:${fg}}</style>`;

  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && typeof headMatch.index === "number") {
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + style + html.slice(at);
  }
  return style + html;
}
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { getAgentDir } from "./session-reader";

/**
 * 服务端持久化的 UI 状态（目前只有 hiddenCwds：被用户关闭的项目列表）。
 *
 * 为什么不用 localStorage：localhost 与 127.0.0.1 是两个隔离的浏览器源，
 * 重启后换个地址打开就会丢掉隐藏记录、历史项目全部"复活"。落到 pi 的
 * agent 目录下与本机绑定，任何浏览器/源打开都共享同一份。
 */

export interface UiState {
  hiddenCwds: Record<string, boolean>;
}

function uiStatePath(): string {
  return join(getAgentDir(), "ui-state.json");
}

function parseUiState(raw: string): UiState {
  try {
    const parsed = JSON.parse(raw) as Partial<UiState>;
    const hidden = parsed.hiddenCwds;
    return {
      hiddenCwds:
        hidden && typeof hidden === "object" && !Array.isArray(hidden) ? hidden : {},
    };
  } catch {
    return { hiddenCwds: {} };
  }
}

export function readUiState(): UiState {
  try {
    return parseUiState(readFileSync(uiStatePath(), "utf8"));
  } catch {
    return { hiddenCwds: {} };
  }
}

export function writeUiState(state: UiState): void {
  const file = uiStatePath();
  // 写临时文件再原子替换，避免并发写或中途崩溃留下半截 JSON
  const tmp = join(dirname(file), `.ui-state.${process.pid}.tmp`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, JSON.stringify(state, null, "\t"), "utf8");
  renameSync(tmp, file);
}

export function setHiddenCwds(hidden: Record<string, boolean>): UiState {
  const next: UiState = { hiddenCwds: hidden };
  writeUiState(next);
  return next;
}

// 兜底：模块被加载但文件不存在时不应抛错——readUiState 已覆盖；existsSync
// 仅用于避免首次写之前的目录竞态。
export function uiStateExists(): boolean {
  return existsSync(uiStatePath());
}

import { getSessionEntries, readSessionStatus } from "./session-reader";
import type { AgentMessage, SessionEntry } from "./types";

// ============================================================================
// 子会话只读尾读（subagent live follow）
// ----------------------------------------------------------------------------
// 子代理由独立的 pi 进程运行，把自己的会话写入各自的 .jsonl 文件。这里通过
// 反复读取该文件并返回“新增的消息”来模拟实时跟踪。**纯只读**：保持零运行时
// 依赖（不 import 任何会启动/接管代理的模块），保证不会凭空启动一个代理进程。
// （tests/subagent-live.test.ts 有静态守卫断言这一点。）
// ============================================================================

/** 从 session 文件提取全部 message 条目（顺序稳定）。失败返回空数组。 */
export function sessionEntriesToMessages(filePath: string): AgentMessage[] {
  let entries: SessionEntry[];
  try {
    entries = getSessionEntries(filePath);
  } catch {
    return [];
  }
  const msgs: AgentMessage[] = [];
  for (const e of entries) {
    if (e.type !== "message") continue;
    const m = (e as unknown as { message?: AgentMessage }).message;
    if (m) msgs.push(m);
  }
  return msgs;
}

export interface ChildTailSample {
  /** 自上次 poll 以来新增的消息。 */
  messages: AgentMessage[];
  /** 是否仍在运行（tail 无终态）。 */
  running: boolean;
}

/**
 * 可增量轮询的子会话尾读器：记录已投递的 message 条目数，
 * 每次 poll 只返回“比上次多出来”的消息，避免重复推送整个文件。
 */
export class ChildSessionTailer {
  private seenCount: number;

  constructor(private readonly path: string) {
    // 打开时会话的历史已由 loadSession 全量加载；这里把 seenCount 预置为当前
    // 已存在的消息数，使首次 poll 只返回“连接之后新增”的消息，避免重复推送整段历史。
    // 代价：loadSession 读到文件到本构造之间子进程新增的极少数消息会漏（亚秒级窗口，
    // agent 消息以秒计生成，可通过 /api/sessions/[id] 重新拉取恢复，风险可接受）。
    this.seenCount = sessionEntriesToMessages(this.path).length;
  }

  poll(): ChildTailSample {
    const all = sessionEntriesToMessages(this.path);
    const fresh = all.slice(this.seenCount);
    this.seenCount = all.length;
    const terminal = readSessionStatus(this.path);
    return {
      messages: fresh,
      running: terminal === null, // null tail => 尚无终态，视为仍在跑
    };
  }
}
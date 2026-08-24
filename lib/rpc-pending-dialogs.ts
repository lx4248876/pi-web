import { statSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  getSessionEntries,
  resolveLeafUnansweredQuestion,
  type RehydratedQuestion,
} from "./session-reader";
import { getRegistry, type AgentEvent } from "./rpc-manager";


// 类型：文件派生的悬空 question 扫描器。默认真实现走 session-reader 的
// getSessionEntries / resolveLeafUnansweredQuestion；测试用假 scanner 注入。
export type FilePendingScanner = (opts: {
	excludeIds: Set<string>;
}) => Promise<Array<{ sessionId: string; request: AgentEvent }>>;

/**
 * 内存（live wrapper）与文件派生的待答 dialog 按 sessionId 去重并集。
 * 保序：先 memory 后 file；file 与 memory 同 id 时只留 memory 那次。
 */
export function unionPendingDialogs(
	memory: Array<{ sessionId: string; request: AgentEvent }>,
	file: Array<{ sessionId: string; request: AgentEvent }>,
): Array<{ sessionId: string; request: AgentEvent }> {
	const seen = new Set<string>();
	const out: Array<{ sessionId: string; request: AgentEvent }> = [];
	for (const d of memory) {
		if (seen.has(d.sessionId)) continue;
		seen.add(d.sessionId);
		out.push(d);
	}
	for (const d of file) {
		if (seen.has(d.sessionId)) continue;
		seen.add(d.sessionId);
		out.push(d);
	}
	return out;
}

/** 内部：只从 live registry 收集待答 dialog（原 getAllPendingDialogs 逻辑）。 */
function collectMemoryPending(): Array<{
	sessionId: string;
	request: AgentEvent;
}> {
	const out: Array<{ sessionId: string; request: AgentEvent }> = [];
	for (const [sessionId, wrapper] of getRegistry()) {
		// 防御热重载错配：registry 里的 wrapper 可能是旧代码生成的实例，没有
		// pendingDialogs getter（undefined）。跳过而非抛错。
		const dialogs = (wrapper as {
			pendingDialogs?: AgentEvent[];
		}).pendingDialogs;
		if (!Array.isArray(dialogs)) continue;
		for (const request of dialogs) {
			out.push({ sessionId, request });
		}
	}
	return out;
}

// 文件派生的未答 question 读取缓存，仿 statusCacheG 模式挂 globalThis，避免
// dev-server 热重载后丢失。键 = 会话文件路径（绝对路径）；文件未变（mtime+size
// 相同）时直接复用上次的解析结果，不重复解析全文。
type FilePendingCacheEntry = {
	mtimeMs: number;
	size: number;
	question: RehydratedQuestion | null;
};

const filePendingCacheG = globalThis as typeof globalThis & {
	__piFilePendingCache?: Map<string, FilePendingCacheEntry>;
};

function getFilePendingCache(): Map<string, FilePendingCacheEntry> {
	if (!filePendingCacheG.__piFilePendingCache) {
		filePendingCacheG.__piFilePendingCache = new Map();
	}
	return filePendingCacheG.__piFilePendingCache;
}

function readCachedUnansweredQuestion(
	filePath: string,
): RehydratedQuestion | null {
	let st: { mtimeMs: number; size: number };
	try {
		const s = statSync(filePath);
		st = { mtimeMs: s.mtimeMs, size: s.size };
	} catch {
		// 读不到文件视同无未答问题（返回 null）。瞬时读失败会让一次徽标轮询漏报，
		// 但下一轮 statSync 拿到新 mtime 会自愈，属可接受折衷。
		return null;
	}

	const cache = getFilePendingCache();
	const hit = cache.get(filePath);
	if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
		return hit.question;
	}

	let question: RehydratedQuestion | null = null;
	try {
		question = resolveLeafUnansweredQuestion(getSessionEntries(filePath));
	} catch {
		question = null;
	}
	cache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, question });
	// 粗防泄漏：缓存条目超过会话文件数量一个量级时清理失效路径（仿 getStatusCache）。
	if (cache.size > 2000) {
		for (const key of cache.keys()) {
			cache.delete(key);
			if (cache.size <= 1000) break;
		}
	}
	return question;
}

/**
 * 默认 scanner：枚举顶层会话，对每个本进程未打开的会话文件解析悬空 question，
 * 把文件里有、但（因重启/idle destroy）内存里没有的未答会话并进结果。
 */
async function scanFilePending(opts: {
	excludeIds: Set<string>;
}): Promise<Array<{ sessionId: string; request: AgentEvent }>> {
	const out: Array<{ sessionId: string; request: AgentEvent }> = [];
	let sessions;
	try {
		sessions = await SessionManager.listAll();
	} catch {
		return out;
	}
	// 只扫顶层会话：subagent 子会话（browse-only）故意不徽标（与内存侧一致，
	// 非回归），见 scanChildSessions。若将来要给子会话挂未答徽标需另行扩展。
	for (const s of sessions) {
		if (opts.excludeIds.has(s.id)) continue;
		const recovered = readCachedUnansweredQuestion(s.path);
		if (!recovered) continue;
		// 徽标契约（hooks/usePendingSessionIds.ts）只读 pending[].sessionId；
		// 但为与内存侧（memory 的 request 带 type: extension_ui_request）对称，
		// 补上 type，避免将来消费端读到 undefined type。
		out.push({
			sessionId: s.id,
			request: {
				type: "extension_ui_request",
				...recovered.request,
			} as unknown as AgentEvent,
		});
	}
	return out;
}

/**
 * 有“未答问题”的会话（供侧边栏徽标，非打断式）。
 * 在内存（live wrapper）之外还并入文件派生的悬空 question 会话，使进程重启 /
 * idle destroy 后徽标仍亮：只要文件里有未答 question 就数得到。
 */
export async function getAllPendingDialogs(
	scanner?: FilePendingScanner,
): Promise<Array<{ sessionId: string; request: AgentEvent }>> {
	const memory = collectMemoryPending();
	const excludeIds = new Set(memory.map((d) => d.sessionId));
	const file = await (scanner ?? scanFilePending)({ excludeIds });
	return unionPendingDialogs(memory, file);
}

// ─── 会话列表变更订阅（供 /api/sessions/events SSE 推送） ─────────────────────
// 活跃会话有「开始跑/跑完」级别的状态变化时通知订阅者；SSE 路由据此推动前端
// 刷新会话列表，替代轮询。注册表挂 globalThis 以免 dev-server 热重载后丢失。

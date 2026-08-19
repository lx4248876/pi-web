import { SessionManager, buildSessionContext as piBuildSessionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionEntry, SessionInfo, SessionContext, SessionTreeNode, AssistantMessage } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export { getAgentDir };

export function getSessionsDir(): string {
  return `${getAgentDir()}/sessions`;
}

// ─── Session status ──────────────────────────────────────────────────────────
// Derived from the trailing entries of a session file (read only, tail window), so the
// list can cheaply tell whether each session ended OK (green dot) or failed (red dot).
// Returns null for empty / ambiguous tails (no dot); live sessions are reported as
// "running" by listAllSessions instead.

const STATUS_TAIL_BYTES = 128 * 1024;

type SessionStatus = "completed" | "failed" | null;

// 一次尾部读取同时产出：终态状态 + 最后一条消息文本（供历史列表预览）。
interface SessionTailInfo {
  status: SessionStatus;
  lastMessage: string;
}

// ─── 状态推导缓存 ────────────────────────────────────────────────────────────
// /api/sessions 每次刷新都会对每个会话文件做尾部读取+解析；会话多时是列表
// 「慢半拍」的主因。文件没变（mtime+size 相同）时直接复用上次推导结果。
// 注册表挂 globalThis 以免 dev-server 热重载后缓存失效。
const statusCacheG = globalThis as typeof globalThis & {
  __piSessionStatusCache?: Map<string, { mtimeMs: number; size: number; tail: SessionTailInfo | null }>;
};

function getStatusCache() {
  if (!statusCacheG.__piSessionStatusCache) {
    statusCacheG.__piSessionStatusCache = new Map();
  }
  return statusCacheG.__piSessionStatusCache;
}

function readFileTail(filePath: string): string | null {
  try {
    const { size } = statSync(filePath);
    if (size <= STATUS_TAIL_BYTES) {
      return readFileSync(filePath, "utf8");
    }
    const fd = openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(STATUS_TAIL_BYTES);
      const bytesRead = readSync(fd, buf, 0, STATUS_TAIL_BYTES, size - STATUS_TAIL_BYTES);
      return buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

// Determine the session's terminal status from the last message entry.
interface ClientMessageLike {
  role?: string;
  errorMessage?: string;
  content?: unknown;
  isError?: boolean;
}

function deriveStatusFromMessage(msg: ClientMessageLike | undefined | null): SessionStatus {
  if (!msg) return null;
  const role = msg.role;

  if (role === "assistant") {
    if (msg.errorMessage) return "failed";
    const content: unknown[] = Array.isArray(msg.content) ? msg.content : [];
    const hasPendingToolCall = content.some(
      (b) => (b as { type?: string } | null | undefined)?.type === "toolCall",
    );
    if (hasPendingToolCall) return null; // awaiting a tool result / still running
    const hasText = content.some(
      (b) => {
        const block = b as { type?: string; text?: unknown } | null | undefined;
        return block?.type === "text" && typeof block.text === "string" && block.text.trim().length > 0;
      },
    );
    return hasText ? "completed" : null;
  }

  if (role === "toolResult") {
    return msg.isError ? "failed" : null; // an OK tool result with no following message = mid-run
  }

  if (role === "user") return "completed";
  return null;
}

export function readSessionStatus(filePath: string): SessionStatus {
  return getCachedSessionTail(filePath)?.status ?? null;
}

// 最后一条消息的文本；无消息/解析失败返回空串。与 readSessionStatus 共用
// 同一缓存，避免对同一个文件做两次尾部 IO。
export function readSessionLastMessage(filePath: string): string {
  return getCachedSessionTail(filePath)?.lastMessage ?? "";
}

function getCachedSessionTail(filePath: string): SessionTailInfo | null {
  let st: { mtimeMs: number; size: number };
  try {
    const s = statSync(filePath);
    st = { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }

  const cache = getStatusCache();
  const hit = cache.get(filePath);
  // tail !== undefined 兜底：dev 热重载后 globalThis 缓存里可能是旧格式 {status}
  // (无 tail) 的残留条目，命中时不返回，按未命中重新算一次。
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size && hit.tail !== undefined) {
    return hit.tail;
  }

  const tail = readSessionTail(filePath);
  cache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, tail });
  // 粗防泄漏：缓存条目超过会话文件数量一个量级时清理失效路径
  if (cache.size > 2000) {
    for (const key of cache.keys()) {
      cache.delete(key);
      if (cache.size <= 1000) break;
    }
  }
  return tail;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as { type?: string; text?: unknown } | null | undefined;
        return block?.type === "text" && typeof block.text === "string"
          ? block.text
          : "";
      })
      .join("")
      .trim();
  }
  return "";
}

function readSessionTail(filePath: string): SessionTailInfo {
  const tail = readFileTail(filePath);
  if (tail === null) return { status: null, lastMessage: "" };

  let lastMessage: ClientMessageLike | null = null;
  for (const line of tail.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: { type?: unknown; message?: ClientMessageLike };
    try {
      entry = JSON.parse(trimmed) as { type?: unknown; message?: ClientMessageLike };
    } catch {
      continue; // line straddling the tail cut-off
    }
    if (entry?.type !== "message" || !entry.message) continue;
    lastMessage = entry.message;
  }
  return {
    status: deriveStatusFromMessage(lastMessage),
    lastMessage: lastMessage ? messageText(lastMessage.content) : "",
  };
}

// ─── 子代理（子会话）发现 ═══════════════════════════════════════════════════
// pi-subagents 把子代理作为独立 pi 进程运行，子会话文件写入
// `sessions/<父id>/async-*`、`chain-runs`、`dynamic-*` 等两层深的子目录。
// pi 的 SessionManager.listAll() 只扫 `sessions/<dir>/*.jsonl` 一层，看不到它们，
// 因此这里补一个针对性扫描（只读），把它们带进列表并标 browseOnly。
// 注：`sessions/<dir>` 一层内的 .jsonl 已由 listAll 覆盖，本扫描只收集更深一层的。

export interface ChildSessionInfo {
  path: string;
  id: string;
  cwd: string;
  /** Session header timestamp（ISO）。 */
  created: string;
  /** 父会话文件绝对路径（来自 child header 的 parentSession 字段）。 */
  parentSessionPath?: string;
}

interface ParsedChildHeader {
  id: string;
  cwd: string;
  timestamp: string;
  parentSessionPath?: string;
}

// 只读会话文件第一行（session header），失败返回 null（跳过坏文件）。
export function parseChildSessionHeader(filePath: string): ParsedChildHeader | null {
  let first: string;
  try {
    first = readFileSync(filePath, "utf8").split("\n", 1)[0] ?? "";
  } catch {
    return null;
  }
  if (!first.trim()) return null;
  let obj: { type?: unknown; id?: unknown; cwd?: unknown; timestamp?: unknown; parentSession?: unknown };
  try {
    obj = JSON.parse(first) as typeof obj;
  } catch {
    return null;
  }
  if (obj.type !== "session" || typeof obj.id !== "string") return null;
  return {
    id: obj.id,
    cwd: typeof obj.cwd === "string" ? obj.cwd : "",
    timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
    parentSessionPath:
      typeof obj.parentSession === "string" ? obj.parentSession : undefined,
  };
}

// 收集 `sessions/<父id>/<runSubdir>/*.jsonl` 这类两层深的子会话文件。
// 只入一层子目录再入一层“运行子目录”，避免与 listAll 覆盖的一层重复，且防无限递归。
export function scanChildSessions(sessionsDir: string): ChildSessionInfo[] {
  let parents;
  try {
    parents = readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: ChildSessionInfo[] = [];
  for (const parentEntry of parents) {
    if (!parentEntry.isDirectory()) continue;
    const parentDir = join(sessionsDir, parentEntry.name);
    let inner;
    try {
      inner = readdirSync(parentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const runEntry of inner) {
      if (!runEntry.isDirectory()) continue; // 一层内 .jsonl 由 listAll 负责，跳过
      const runDir = join(parentDir, runEntry.name);
      let files: string[];
      try {
        files = readdirSync(runDir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of files) {
        const p = join(runDir, f);
        const h = parseChildSessionHeader(p);
        if (!h) continue;
        found.push({
          path: p,
          id: h.id,
          cwd: h.cwd,
          created: h.timestamp,
          parentSessionPath: h.parentSessionPath,
        });
      }
    }
  }
  return found;
}

// 子会话路径集（TTL 缓存）：供共享 RPC 入口判断某个 id 是否为只读子会话，
// 防止对它 startRpcSession / 发命令。
const CHILD_PATH_TTL_MS = 5000;
const childPathCacheG = globalThis as typeof globalThis & {
  __piChildPaths?: { t: number; paths: Set<string> };
};

export function isChildSessionPath(filePath: string): boolean {
  return isChildSessionPathIn(getSessionsDir(), filePath);
}

export function isChildSessionPathIn(sessionsDir: string, filePath: string): boolean {
  const now = Date.now();
  const cached = childPathCacheG.__piChildPaths;
  if (cached && now - cached.t < CHILD_PATH_TTL_MS) {
    return cached.paths.has(filePath);
  }
  let paths: string[];
  try {
    paths = scanChildSessions(sessionsDir).map((c) => c.path);
  } catch {
    paths = [];
  }
  childPathCacheG.__piChildPaths = { t: now, paths: new Set(paths) };
  return childPathCacheG.__piChildPaths.paths.has(filePath);
}

// 子会话文件的最后修改时间（ISO）；读取失败回退 header created。
function readChildMtime(filePath: string): string {
  try {
    const m = statSync(filePath).mtime;
    return m instanceof Date && !Number.isNaN(m.getTime()) ? m.toISOString() : "";
  } catch {
    return "";
  }
}

// 运行中 heuristic：文件刚被碰过且 tail 未收尾（无终态）→ 视为仍在跑（转圈）。
const LIVE_ACTIVE_MS = 10_000;
export function readChildLiveStatus(filePath: string): "running" | "completed" | "failed" | null {
  const terminal = readSessionStatus(filePath);
  if (terminal) return terminal;
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
  // 有消息且近期仍在写 → running；否则无终态判定。
  if (readSessionLastMessage(filePath) && Date.now() - mtimeMs < LIVE_ACTIVE_MS) {
    return "running";
  }
  return null;
}

// ============================================================================
// Session listing (top-level) + subagent child merge
// ============================================================================
export async function listAllSessions(options?: {
  /** Ids of sessions currently live in the process; they report status "running". */
  runningSessionIds?: Set<string>;
}): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(s.path, s.id);

  const cache = getPathCache();
  const result: SessionInfo[] = piSessions.map((s) => {
    // Populate path cache so resolveSessionPath works without a full scan
    cache.set(s.id, s.path);
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      lastMessage: readSessionLastMessage(s.path),
      parentSessionId: s.parentSessionPath ? pathToId.get(s.parentSessionPath) : undefined,
      // A still-live session shows "running" (spinner dot), others derive done/failed from their file tail.
      status: options?.runningSessionIds?.has(s.id)
        ? "running"
        : readSessionStatus(s.path) ?? undefined,
    };
  });

  // Merge subagent child sessions (nested two levels deep) as browse-only entries.
  // Child sessions run in separate pi processes and are NOT live RPC sessions here,
  // so they must never be treatable as interactive RPC targets.
  const knownPaths = new Set<string>();
  for (const s of piSessions) knownPaths.add(s.path);
  let childSessions: ChildSessionInfo[] = [];
  try {
    childSessions = scanChildSessions(getSessionsDir());
  } catch {
    childSessions = [];
  }
  for (const child of childSessions) {
    if (knownPaths.has(child.path)) continue;
    knownPaths.add(child.path);
    cache.set(child.id, child.path);
    const parentSessionId = child.parentSessionPath
      ? pathToId.get(child.parentSessionPath)
      : undefined;
    const liveStatus = readChildLiveStatus(child.path);
    result.push({
      path: child.path,
      id: child.id,
      cwd: child.cwd,
      name: undefined,
      created: child.created,
      modified: readChildMtime(child.path),
      messageCount: 0,
      firstMessage: "(subagent)",
      lastMessage: readSessionLastMessage(child.path),
      parentSessionId,
      browseOnly: true,
      // Live heuristic: recent writes + no terminal tail => running spinner;
      // otherwise completed/failed from the file tail.
      status: liveStatus ?? undefined,
    });
  }

  // 与 isChildSessionPath 的 TTL 缓存保持同步：本次扫描拿到最新子会话集，
  // 直接刷新，避免 5s 窗口内新建的子会话被发现后仍可被交互入口启动。
  childPathCacheG.__piChildPaths = {
    t: Date.now(),
    paths: new Set(childSessions.map((c) => c.path)),
  };

  return result;
}

// ============================================================================
// Session path cache: sessionId → absolute file path
// Stored in globalThis for hot-reload safety
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

export function buildTree(entries: SessionEntry[]): SessionTreeNode[] {
  const nodeMap = new Map<string, SessionTreeNode>();
  const labelsById = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type === "label") {
      const l = entry as { type: "label"; targetId: string; label?: string };
      if (l.label) labelsById.set(l.targetId, l.label);
      else labelsById.delete(l.targetId);
    }
  }

  const roots: SessionTreeNode[] = [];
  for (const entry of entries) {
    nodeMap.set(entry.id, { entry, children: [], label: labelsById.get(entry.id) });
  }
  for (const entry of entries) {
    const node = nodeMap.get(entry.id)!;
    if (!entry.parentId) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(entry.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }

  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
    stack.push(...node.children);
  }
  return roots;
}

export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  // Build entryIds: parallel array to messages[], mapping each message back to its entry id.
  // Needed for fork and navigate_tree calls from the UI.
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }

  // Walk path from target leaf to root
  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Find the last compaction on path (mirrors pi's buildSessionContext logic)
  let compactionId: string | undefined;
  let firstKeptEntryId: string | undefined;
  for (const e of path) {
    if (e.type === "compaction") {
      compactionId = e.id;
      firstKeptEntryId = (e as { firstKeptEntryId: string }).firstKeptEntryId;
    }
  }

  const entryIds: string[] = [];
  if (compactionId) {
    // The first message in piCtx.messages is the synthetic compaction summary — map to compaction entry id
    entryIds.push(compactionId);
    const compactionIdx = path.findIndex((e) => e.id === compactionId);
    const firstKeptIdx = firstKeptEntryId
      ? path.findIndex((e, i) => i < compactionIdx && e.id === firstKeptEntryId)
      : -1;
    const startIdx = firstKeptIdx >= 0 ? firstKeptIdx : compactionIdx;
    for (let i = startIdx; i < compactionIdx; i++) {
      if (path[i].type === "message") entryIds.push(path[i].id);
    }
    for (let i = compactionIdx + 1; i < path.length; i++) {
      if (path[i].type === "message") entryIds.push(path[i].id);
    }
  } else {
    for (const e of path) {
      if (e.type === "message") entryIds.push(e.id);
    }
  }

  // pi injects compaction summary as {role:"compactionSummary", summary, tokensBefore}.
  // Convert to {role:"user"} so MessageView can render it the same as before.
  const messages = (piCtx.messages as AssistantMessage[]).map((msg) => {
    const raw = msg as unknown as Record<string, unknown>;
    if (raw.role === "compactionSummary") {
      return {
        role: "user" as const,
        content: `*The conversation history before this point was compacted into the following summary:*\n\n${raw.summary ?? ""}`,
        timestamp: raw.timestamp as number | undefined,
      };
    }
    return normalizeToolCalls(msg);
  });

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

export function getLeafId(entries: SessionEntry[]): string | null {
  if (entries.length === 0) return null;
  return entries[entries.length - 1].id;
}




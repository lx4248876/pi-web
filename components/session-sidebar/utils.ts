import type { SessionInfo } from "@/lib/types";

export function formatRelativeTime(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const mins = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;
	return date.toLocaleDateString();
}

export const RECENT_CWDS_STORAGE_KEY = "pi-recent-cwds";
export const PROJECT_ORDER_STORAGE_KEY = "pi-project-order";
export const RECENT_CWDS_LIMIT = 20;

export function getRecentCwds(sessions: SessionInfo[]): string[] {
	const latestByCwd = new Map<string, string>();
	for (const s of sessions) {
		if (!s.cwd) continue;
		const prev = latestByCwd.get(s.cwd);
		if (!prev || s.modified > prev) {
			latestByCwd.set(s.cwd, s.modified);
		}
	}
	return [...latestByCwd.entries()]
		.sort((a, b) => b[1].localeCompare(a[1]))
		.slice(0, RECENT_CWDS_LIMIT)
		.map(([cwd]) => cwd);
}

// Move `item` in an array from its current index to just before `before`, keeping
// the rest of the order intact. Both positions are referenced by value.
export function moveInList<T>(list: T[], item: T, before: T): T[] {
  const next = list.filter((x) => x !== item);
  if (item === before) return next;
  const at = next.indexOf(before);
  if (at < 0) {
    next.push(item);
  } else {
    next.splice(at, 0, item);
  }
  return next;
}

export function readStoredRecentCwds(): string[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(RECENT_CWDS_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(cwd): cwd is string => typeof cwd === "string" && cwd.trim().length > 0,
		);
	} catch {
		return [];
	}
}

export function shortenCwd(cwd: string, homeDir?: string): string {
	const path =
		homeDir && cwd.startsWith(homeDir) ? "~" + cwd.slice(homeDir.length) : cwd;
	const sep = path.includes("/") ? "/" : "\\";
	const parts = path.split(sep).filter(Boolean);
	if (parts.length === 0) return path;
	return parts[parts.length - 1];
}

export function getParentPath(path: string): string | null {
	const trimmed = path.replace(/[\\/]+$/, "");
	if (!trimmed || trimmed === "/") return null;
	if (/^[a-zA-Z]:$/.test(trimmed)) return null;

	const lastSlash = Math.max(
		trimmed.lastIndexOf("/"),
		trimmed.lastIndexOf("\\"),
	);
	if (lastSlash < 0) return null;
	if (lastSlash === 0) return "/";

	const parent = trimmed.slice(0, lastSlash);
	if (/^[a-zA-Z]:$/.test(parent)) return `${parent}\\`;
	return parent || null;
}

export interface SessionTreeNode {
	session: SessionInfo;
	children: SessionTreeNode[];
}

export function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
	const byId = new Map<string, SessionTreeNode>();
	for (const s of sessions) {
		byId.set(s.id, { session: s, children: [] });
	}

	const parentOf = new Map<string, string>();
	for (const s of sessions) {
		if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
	}

	function resolveAncestor(id: string): string | null {
		let cur = parentOf.get(id);
		const visited = new Set<string>();
		while (cur) {
			if (visited.has(cur)) return null;
			visited.add(cur);
			if (byId.has(cur)) return cur;
			cur = parentOf.get(cur);
		}
		return null;
	}

	const roots: SessionTreeNode[] = [];
	for (const node of byId.values()) {
		const ancestor = resolveAncestor(node.session.id);
		if (ancestor) {
			byId.get(ancestor)!.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const sort = (nodes: SessionTreeNode[]) => {
		nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
		nodes.forEach((n) => sort(n.children));
	};
	sort(roots);
	return roots;
}


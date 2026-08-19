"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type BrowseValidationResponse,
	selectCwdWithValidation,
} from "@/lib/cwd-selection";
import { pickSessionForCwd } from "@/lib/project-session-restore";
import {
	buildRecentCwdOptions,
	removeStoredRecentCwd,
} from "@/lib/recent-cwds";
import type { SessionInfo } from "@/lib/types";
import { FileExplorer } from "./FileExplorer";

interface Props {
	selectedSessionId: string | null;
	onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
	onNewSession?: (sessionId: string, cwd: string) => void;
	initialSessionId?: string | null;
	onInitialRestoreDone?: () => void;
	refreshKey?: number;
	onSessionDeleted?: (sessionId: string, cwd: string) => void;
	selectedCwd?: string | null;
	onCwdChange?: (cwd: string | null) => void;
	onOpenFile?: (filePath: string, fileName: string) => void;
	explorerRefreshKey?: number;
	onAtMention?: (relativePath: string) => void;
	// Session currently streaming; its terminal dot is suppressed while running.
	runningSessionId?: string | null;
	// 有「未答 question」的会话（侧边栏小徽标，非打断式）。
	pendingSessionIds?: ReadonlySet<string>;
}

interface BrowseDirEntry {
	name: string;
	path: string;
	isDir: boolean;
}

interface BrowseDirResponse extends BrowseValidationResponse {
	entries?: BrowseDirEntry[];
	requestedPath?: string;
}

function copyText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
    }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return Promise.resolve();
    } catch {
        return Promise.reject();
    }
}

function formatRelativeTime(dateStr: string): string {
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

const RECENT_CWDS_STORAGE_KEY = "pi-recent-cwds";
const PROJECT_ORDER_STORAGE_KEY = "pi-project-order";
const RECENT_CWDS_LIMIT = 20;

function getRecentCwds(sessions: SessionInfo[]): string[] {
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
function moveInList<T>(list: T[], item: T, before: T): T[] {
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

function readStoredRecentCwds(): string[] {
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

function shortenCwd(cwd: string, homeDir?: string): string {
	const path =
		homeDir && cwd.startsWith(homeDir) ? "~" + cwd.slice(homeDir.length) : cwd;
	const sep = path.includes("/") ? "/" : "\\";
	const parts = path.split(sep).filter(Boolean);
	if (parts.length === 0) return path;
	return parts[parts.length - 1];
}

function getParentPath(path: string): string | null {
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

interface SessionTreeNode {
	session: SessionInfo;
	children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
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

const SCRAMBLE_CHARS =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
	const [display, setDisplay] = useState(target);
	const frameRef = useRef<number | null>(null);
	const iterRef = useRef(0);

	useEffect(() => {
		if (!running) {
			setDisplay(target);
			return;
		}
		iterRef.current = 0;
		const totalFrames = target.length * 4;

		const step = () => {
			iterRef.current += 1;
			const progress = iterRef.current / totalFrames;
			const resolved = Math.floor(progress * target.length);

			setDisplay(
				target
					.split("")
					.map((char, i) => {
						if (char === " ") return " ";
						if (i < resolved) return char;
						return SCRAMBLE_CHARS[
							Math.floor(Math.random() * SCRAMBLE_CHARS.length)
						];
					})
					.join(""),
			);

			if (iterRef.current < totalFrames) {
				frameRef.current = requestAnimationFrame(step);
			} else {
				setDisplay(target);
			}
		};

		frameRef.current = requestAnimationFrame(step);
		return () => {
			if (frameRef.current) cancelAnimationFrame(frameRef.current);
		};
	}, [target, running]);

	return display;
}

function PiAgentTitle() {
	const [showVersion, setShowVersion] = useState(false);
	const [scrambling, setScrambling] = useState(false);
	const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const target = showVersion
		? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}`
		: "my-pi-web";
	const display = useScramble(target, scrambling);

	const triggerScramble = useCallback((toVersion: boolean) => {
		setShowVersion(toVersion);
		setScrambling(true);
		setTimeout(
			() => setScrambling(false),
			(toVersion ? 6 : 8) * 4 * (1000 / 60) + 100,
		);
	}, []);

	const handleClick = useCallback(() => {
		if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

		const next = !showVersion;
		triggerScramble(next);

		if (next) {
			revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
		}
	}, [showVersion, triggerScramble]);

	useEffect(
		() => () => {
			if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
		},
		[],
	);

	return (
		<button
			onClick={handleClick}
			style={{
				background: "none",
				border: "none",
				padding: 0,
				cursor: "default",
				fontWeight: 700,
				fontSize: 13,
				letterSpacing: "-0.01em",
				color: showVersion ? "var(--accent)" : "var(--text)",
				fontFamily: "var(--font-mono)",
				minWidth: "6ch",
			}}
		>
			{display}
		</button>
	);
}

export function SessionSidebar({
	selectedSessionId,
	onSelectSession,
	onNewSession,
	initialSessionId,
	onInitialRestoreDone,
	refreshKey,
	onSessionDeleted,
	selectedCwd: selectedCwdProp,
	onCwdChange,
	onOpenFile,
	explorerRefreshKey,
	onAtMention,
	runningSessionId,
	pendingSessionIds,
}: Props) {
	const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
	const [storedRecentCwds, setStoredRecentCwds] = useState<string[]>([]);
	const [projectOrder, setProjectOrder] = useState<string[]>(() => {
		if (typeof window === "undefined") return [];
		try {
			const raw = window.localStorage.getItem(PROJECT_ORDER_STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed))
					return parsed.filter((c): c is string => typeof c === "string");
			}
		} catch {}
		return [];
	});
	const [dragCwd, setDragCwd] = useState<string | null>(null);
	const [dropTargetCwd, setDropTargetCwd] = useState<string | null>(null);
	const [hoverProjectCwd, setHoverProjectCwd] = useState<string | null>(null);
	const [homeDir, setHomeDir] = useState<string>("");
	const [browseOpen, setBrowseOpen] = useState(false);
	const [browsePath, setBrowsePath] = useState<string | null>(null);
	const [browseEntries, setBrowseEntries] = useState<BrowseDirEntry[]>([]);
	const [browseLoading, setBrowseLoading] = useState(false);
	const [browseError, setBrowseError] = useState<string | null>(null);
	const [browseSearch, setBrowseSearch] = useState("");
	const [browseIsEditingPath, setBrowseIsEditingPath] = useState(false);
	const [browsePathInputVal, setBrowsePathInputVal] = useState("");
	const dropdownRef = useRef<HTMLDivElement>(null);
	const [explorerOpen, setExplorerOpen] = useState(true);
	const [explorerKey, setExplorerKey] = useState(0);
	const [explorerFraction, setExplorerFraction] = useState(0.5);
	const sidebarRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);
	const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
	const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
	const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	// Project being confirmed for hide/close — shows a confirmation dialog before removal
	const [confirmHideCwd, setConfirmHideCwd] = useState<string | null>(null);

	// Hidden project paths state helper
	// 隐藏项目列表持久化在服务端（/api/ui-state，落盘在 pi agent 目录）：
	// localStorage 按 localhost/127.0.0.1 等源隔离，换地址打开就会"复活"已隐藏
	// 项目；服务端一份对本机全局生效。localStorage 只作首屏兜底，加载后以服务端为准。
	const [hiddenCwds, setHiddenCwds] = useState<Record<string, boolean>>(() => {
		if (typeof window !== "undefined") {
			try {
				const stored = localStorage.getItem("pi-hidden-cwds");
				if (stored) return JSON.parse(stored);
			} catch {}
		}
		return {};
	});

	// 服务端版本就位后覆盖本地兜底值，并把本地独有的记录合并上去
	useEffect(() => {
		let cancelled = false;
		fetch("/api/ui-state")
			.then((r) => (r.ok ? r.json() : null))
			.then((state: { hiddenCwds?: Record<string, boolean> } | null) => {
				if (cancelled || !state?.hiddenCwds) return;
				const serverHidden = state.hiddenCwds;
				setHiddenCwds((local) => {
					const merged = { ...serverHidden };
					let changed = false;
					for (const [cwd, hidden] of Object.entries(local)) {
						if (hidden && !merged[cwd]) {
							merged[cwd] = true;
							changed = true;
						}
					}
					if (changed) {
						fetch("/api/ui-state", {
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ hiddenCwds: merged }),
						}).catch(() => {});
					}
					try {
						localStorage.setItem("pi-hidden-cwds", JSON.stringify(merged));
					} catch {}
					return merged;
				});
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	const persistHiddenCwds = useCallback((next: Record<string, boolean>) => {
		try {
			localStorage.setItem("pi-hidden-cwds", JSON.stringify(next));
		} catch {}
		fetch("/api/ui-state", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ hiddenCwds: next }),
		}).catch(() => {});
	}, []);

	// 回收站：被「删除」的会话 id 集合。删除后主列表过滤、归档列表展示并支持还原。
	// 持久化机制与 hiddenCwds 一致(服务端 /api/ui-state + localStorage 兜底)。
	const [trashedIds, setTrashedIds] = useState<Set<string>>(() => {
		if (typeof window !== "undefined") {
			try {
				const stored = localStorage.getItem("pi-trashed-sessions");
				if (stored) {
					const arr = JSON.parse(stored);
					if (Array.isArray(arr))
						return new Set(arr.filter((s): s is string => typeof s === "string"));
				}
			} catch {}
		}
		return new Set();
	});

	const persistTrashedIds = useCallback((ids: Set<string>) => {
		const arr = [...ids];
		try {
			localStorage.setItem("pi-trashed-sessions", JSON.stringify(arr));
		} catch {}
		fetch("/api/ui-state", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ trashedSessions: arr }),
		}).catch(() => {});
	}, []);

	// 服务端版本就位后把本地兜底合入(并集)，与 hiddenCwds 的行为对齐。
	useEffect(() => {
		let cancelled = false;
		fetch("/api/ui-state")
			.then((r) => (r.ok ? r.json() : null))
			.then((state: { trashedSessions?: string[] } | null) => {
				if (cancelled || !state) return;
				const server = Array.isArray(state.trashedSessions)
					? state.trashedSessions
					: [];
				setTrashedIds((local) => {
					const merged = new Set<string>(server);
					let changed = false;
					for (const id of local) {
						if (!merged.has(id)) {
							merged.add(id);
							changed = true;
						}
					}
					if (changed) persistTrashedIds(merged);
					return merged;
				});
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [persistTrashedIds]);

	const trashSession = useCallback(
		(id: string) => {
			setTrashedIds((prev) => {
				if (prev.has(id)) return prev;
				const next = new Set(prev);
				next.add(id);
				persistTrashedIds(next);
				return next;
			});
		},
		[persistTrashedIds],
	);

	const restoreSession = useCallback(
		(id: string) => {
			setTrashedIds((prev) => {
				if (!prev.has(id)) return prev;
				const next = new Set(prev);
				next.delete(id);
				persistTrashedIds(next);
				return next;
			});
		},
		[persistTrashedIds],
	);

	// 主列表展示用的会话：剔除已删除(回收站)的，树构建只消费这些。
	const visibleSessions = useMemo(
		() => allSessions.filter((s) => !trashedIds.has(s.id)),
		[allSessions, trashedIds],
	);

	// 归档面板(聚焦弹出,展示所有被关闭项目下的归档会话)开关
	const [archivedOpen, setArchivedOpen] = useState(false);

	// Last time the user viewed each session (persisted) — drives the terminal
	// dot: green/red shows only for sessions with a completed/failed result newer
	// than the last time it was viewed, and it clears once you switch to / view it.
	const [seenAt, setSeenAt] = useState<Record<string, string>>(() => {
		if (typeof window !== "undefined") {
			try {
				const stored = localStorage.getItem("pi-session-seen");
				if (stored) return JSON.parse(stored);
			} catch {}
		}
		return {};
	});

	const persistSeenAt = useCallback((next: Record<string, string>) => {
		try {
			window.localStorage.setItem("pi-session-seen", JSON.stringify(next));
		} catch {}
	}, []);

	// Guard so we only seed historical sessions as "seen" on the very first load.
	const seenSeededRef = useRef(false);

	const markSessionSeen = useCallback(
		(sessionId: string) => {
			setSeenAt((prev) => {
				if ((prev[sessionId] ?? "") >= new Date().toISOString()) return prev;
				const next = { ...prev, [sessionId]: new Date().toISOString() };
				persistSeenAt(next);
				return next;
			});
		},
		[persistSeenAt],
	);

	const hideProjectCwd = useCallback(
		(cwd: string) => {
			setHiddenCwds((prev) => {
				const next = { ...prev, [cwd]: true };
				persistHiddenCwds(next);
				return next;
			});

			if (selectedCwd === cwd) {
				const nextOptions = buildRecentCwdOptions(
					getRecentCwds(allSessions),
					storedRecentCwds,
					RECENT_CWDS_LIMIT,
				).filter(({ cwd: c }) => c !== cwd);

				if (nextOptions.length > 0) {
					setSelectedCwd(nextOptions[0].cwd);
					lastSelectedCwdRef.current = nextOptions[0].cwd;
				} else {
					setSelectedCwd(null);
					lastSelectedCwdRef.current = null;
				}
			}
		},
		[selectedCwd, allSessions, storedRecentCwds, persistHiddenCwds],
	);

	const rememberCwd = useCallback((cwd: string) => {
		const trimmed = cwd.trim();
		if (!trimmed) return;

		setHiddenCwds((prev) => {
			if (!prev[trimmed]) return prev;
			const next = { ...prev };
			delete next[trimmed];
			persistHiddenCwds(next);
			return next;
		});

		setStoredRecentCwds((prev) => {
			const next = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(
				0,
				RECENT_CWDS_LIMIT,
			);
			persistStoredRecentCwds(next);
			return next;
		});
	}, [persistHiddenCwds]);

	const forgetStoredCwd = useCallback(
		(cwd: string) => {
			setStoredRecentCwds((prev) => {
				const next = removeStoredRecentCwd(prev, cwd);
				persistStoredRecentCwds(next);
				return next;
			});
			setBrowseOpen(false);
			setBrowseError(null);

			setHiddenCwds((prev) => {
				if (!prev[cwd]) return prev;
				const next = { ...prev };
				delete next[cwd];
				persistHiddenCwds(next);
				return next;
			});

			if (selectedCwd === cwd) {
				const nextOptions = buildRecentCwdOptions(
					getRecentCwds(allSessions),
					storedRecentCwds.filter((c) => c !== cwd),
					RECENT_CWDS_LIMIT,
				);
				if (nextOptions.length > 0) {
					setSelectedCwd(nextOptions[0].cwd);
					lastSelectedCwdRef.current = nextOptions[0].cwd;
				} else {
					setSelectedCwd(null);
					lastSelectedCwdRef.current = null;
				}
			}
		},
		[selectedCwd, allSessions, storedRecentCwds, persistHiddenCwds],
	);

	const loadBrowseEntries = useCallback(async (path?: string | null) => {
		try {
			setBrowseLoading(true);
			setBrowseError(null);
			const query = path ? `?path=${encodeURIComponent(path)}` : "";
			const res = await fetch(`/api/browse-dirs${query}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as BrowseDirResponse;
			const resolvedPath = data.path ?? path ?? null;
			setBrowsePath(resolvedPath);
			setBrowsePathInputVal(resolvedPath ?? "");
			setBrowseSearch("");
			setBrowseIsEditingPath(false);
			setBrowseEntries(data.entries ?? []);
			if (data.valid === false && data.error) {
				setBrowseError(data.error);
			}
		} catch (e) {
			setBrowseError(String(e));
			setBrowseEntries([]);
		} finally {
			setBrowseLoading(false);
		}
	}, []);

	const commitSelectedCwd = useCallback(
		async (candidatePath: string) => {
			const result = await selectCwdWithValidation(
				candidatePath,
				async (path) => {
					const res = await fetch(
						`/api/browse-dirs?path=${encodeURIComponent(path)}`,
					);
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					return (await res.json()) as BrowseDirResponse;
				},
			);

			if (!result.ok) {
				setBrowseError(result.error);
				if (result.fallbackPath && result.fallbackPath !== browsePath) {
					await loadBrowseEntries(result.fallbackPath);
				}
				return false;
			}

			setBrowseError(null);
			rememberCwd(result.cwd);
			setSelectedCwd(result.cwd);
			setBrowseOpen(false);
			return true;
		},
		[browsePath, loadBrowseEntries, rememberCwd],
	);

	// Drag-to-resize between session list and explorer
	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (!draggingRef.current || !sidebarRef.current) return;
			const sidebarRect = sidebarRef.current.getBoundingClientRect();
			const headerEl = sidebarRef.current.querySelector(
				"[data-sidebar-header]",
			);
			const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
			const available = sidebarRect.height - headerH;
			const y = e.clientY - sidebarRect.top - headerH;
			const frac = Math.max(0.1, Math.min(0.9, y / available));
			setExplorerFraction(1 - frac);
		};
		const onUp = () => {
			draggingRef.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
	}, []);

	const loadSessions = useCallback(
		async (showLoading = false, opts?: { silent?: boolean }) => {
			try {
				if (showLoading) setLoading(true);
				const res = await fetch("/api/sessions");
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as { sessions: SessionInfo[] };
				setAllSessions(data.sessions);
				// First load of each page view: treat every currently-listed session as
				// already-viewed (seenAt = max(existing, modified)) so dots only reflect
				// completions that happen AFTER this page was opened — restarts never
				// light up the whole history.
				if (!seenSeededRef.current) {
					seenSeededRef.current = true;
					setSeenAt((prev) => {
						let changed = false;
						const next = { ...prev };
						for (const s of data.sessions) {
							if ((next[s.id] ?? "") < s.modified) {
								next[s.id] = s.modified;
								changed = true;
							}
						}
						if (changed) persistSeenAt(next);
						return changed ? next : prev;
					});
				}
				setError(null);
				// Silent refreshes (SSE push) skip the refresh-check flash.
				if (!showLoading && !opts?.silent) {
					setSessionRefreshDone(true);
					if (sessionRefreshTimerRef.current)
						clearTimeout(sessionRefreshTimerRef.current);
					sessionRefreshTimerRef.current = setTimeout(
						() => setSessionRefreshDone(false),
						2000,
					);
				}
			} catch (e) {
				setError(String(e));
			} finally {
				if (showLoading) setLoading(false);
			}
		},
		[persistSeenAt],
	);

	// Session dots update via SSE push from the server (agent start/end across ALL
	// sessions, including background ones), plus explicit events (session select).
	useEffect(() => {
		const es = new EventSource("/api/sessions/events");
		es.onmessage = (e) => {
			if (e.data?.includes("session_activity")) {
				loadSessions(false, { silent: true });
			}
		};
		return () => es.close();
	}, [loadSessions]);

	const initialLoadDone = useRef(false);
	useEffect(() => {
		const isFirst = !initialLoadDone.current;
		initialLoadDone.current = true;
		loadSessions(isFirst);
	}, [loadSessions, refreshKey]);

	useEffect(() => {
		if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
	}, [explorerRefreshKey]);

	useEffect(() => {
		fetch("/api/home")
			.then((r) => r.json())
			.then((d: { home?: string }) => {
				if (d.home) setHomeDir(d.home);
			})
			.catch(() => {});
	}, []);

	useEffect(() => {
		setStoredRecentCwds(readStoredRecentCwds());
	}, []);

	const restoredRef = useRef(false);
	const lastSelectedCwdRef = useRef<string | null>(null);

	useEffect(() => {
		onCwdChange?.(selectedCwd);
	}, [selectedCwd, onCwdChange]);

	// Handle URL restore & sync active CWD
	useEffect(() => {
		if (allSessions.length === 0) return;

		if (selectedCwd === null) {
			if (initialSessionId && !restoredRef.current) {
				restoredRef.current = true;
				const target = allSessions.find((s) => s.id === initialSessionId);
				if (target) {
					setSelectedCwd(target.cwd);
					lastSelectedCwdRef.current = target.cwd;
					onSelectSession(target, true);
					return;
				}
				onInitialRestoreDone?.();
			}
			const cwds = getRecentCwds(allSessions);
			if (cwds.length > 0) {
				setSelectedCwd(cwds[0]);
				lastSelectedCwdRef.current = cwds[0];
			}
			return;
		}

		const selectedSession = selectedSessionId
			? (allSessions.find((s) => s.id === selectedSessionId) ?? null)
			: null;
		if (selectedSession?.cwd === selectedCwd) {
			lastSelectedCwdRef.current = selectedCwd;
			return;
		}

		if (lastSelectedCwdRef.current !== selectedCwd) {
			lastSelectedCwdRef.current = selectedCwd;
			const target = pickSessionForCwd(allSessions, selectedCwd);
			if (target) {
				onSelectSession(target);
			}
		}
	}, [
		allSessions,
		selectedCwd,
		initialSessionId,
		onInitialRestoreDone,
		onSelectSession,
		selectedSessionId,
	]);

	const persistStoredRecentCwds = useCallback((next: string[]) => {
		try {
			window.localStorage.setItem(
				RECENT_CWDS_STORAGE_KEY,
				JSON.stringify(next),
			);
		} catch {}
	}, []);

	const handleBrowseFolder = useCallback(async () => {
		setBrowseOpen(true);
		await loadBrowseEntries(selectedCwdProp ?? selectedCwd ?? null);
	}, [loadBrowseEntries, selectedCwd, selectedCwdProp]);

	const handleSessionSelect = useCallback(
		(session: SessionInfo) => {
			// Viewing the session clears its terminal dot, and refreshes the list.
			markSessionSeen(session.id);
			onSelectSession(session);
			loadSessions();
		},
		[onSelectSession, loadSessions, markSessionSeen],
	);

	// A stream that ends while its session is still open was watched live —
	// mark it seen so its terminal dot doesn't light up afterwards.
	const prevRunningRef = useRef<string | null>(null);
	useEffect(() => {
		const prev = prevRunningRef.current;
		prevRunningRef.current = runningSessionId ?? null;
		if (prev && !runningSessionId && prev === selectedSessionId) {
			markSessionSeen(prev);
		}
	}, [runningSessionId, selectedSessionId, markSessionSeen]);

	const handleNewSessionFor = useCallback(
		(cwd: string) => {
			if (!cwd) return;
			const tempId =
				typeof crypto.randomUUID === "function"
					? crypto.randomUUID()
					: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
			onNewSession?.(tempId, cwd);
		},
		[onNewSession],
	);

	const recentCwdOptions = buildRecentCwdOptions(
		getRecentCwds(allSessions),
		storedRecentCwds,
		RECENT_CWDS_LIMIT,
	);
	const browseParentPath = browsePath ? getParentPath(browsePath) : null;

	const browseBreadcrumbs = useMemo(() => {
		if (!browsePath) return [];
		const isWin = browsePath.includes("\\") || /^[a-zA-Z]:/.test(browsePath);
		const parts = browsePath.split(/[\\/]+/).filter(Boolean);
		const crumbs: { name: string; path: string }[] = [];

		if (isWin && parts[0] && /^[a-zA-Z]:/.test(parts[0])) {
			const drive = parts[0];
			crumbs.push({ name: drive, path: drive + "\\" });
			let current = drive + "\\";
			for (let i = 1; i < parts.length; i++) {
				current += (current.endsWith("\\") ? "" : "\\") + parts[i];
				crumbs.push({ name: parts[i], path: current });
			}
		} else {
			let current = "";
			if (browsePath.startsWith("/")) {
				crumbs.push({ name: "root", path: "/" });
			}
			for (let i = 0; i < parts.length; i++) {
				current +=
					(current.endsWith("/") || current === "" ? "" : "/") + parts[i];
				const absPath = browsePath.startsWith("/") ? "/" + current : current;
				crumbs.push({ name: parts[i], path: absPath });
			}
		}
		return crumbs;
	}, [browsePath]);

	const filteredBrowseEntries = useMemo(() => {
		if (!browseSearch.trim()) return browseEntries;
		const q = browseSearch.toLowerCase();
		return browseEntries.filter((entry) =>
			entry.name.toLowerCase().includes(q),
		);
	}, [browseEntries, browseSearch]);

	const activeProjectCwd = selectedCwdProp ?? selectedCwd;

	// Candidate set (filtered, recency-based). Order here is only a seed: the
	// displayed order is pinned by `projectOrder` below so active sessions can't
	// shuffle the list around.
	const baseProjectList = useMemo(() => {
		const persistentCwds = new Set(
			recentCwdOptions.filter((o) => o.source !== "session").map((o) => o.cwd),
		);
		return recentCwdOptions
			.map(({ cwd }) => {
				const sessionsForCwd = visibleSessions.filter((s) => s.cwd === cwd);
				const tree = buildSessionTree(sessionsForCwd);
				return { cwd, tree };
			})
			.filter(
				(p) =>
					!hiddenCwds[p.cwd] &&
					(p.tree.length > 0 ||
						p.cwd === selectedCwdProp ||
						p.cwd === selectedCwd ||
						persistentCwds.has(p.cwd)),
			);
	}, [recentCwdOptions, visibleSessions, selectedCwd, selectedCwdProp, hiddenCwds]);

	const persistProjectOrder = useCallback((next: string[]) => {
		try {
			window.localStorage.setItem(
				PROJECT_ORDER_STORAGE_KEY,
				JSON.stringify(next),
			);
		} catch {}
	}, []);

	// Freeze the current order once, the first time projects appear. Afterwards
	// only explicit drags may change it — session activity can't reorder.
	useEffect(() => {
		const cwds = baseProjectList.map((p) => p.cwd);
		if (cwds.length === 0 || projectOrder.length > 0) return;
		const next = [...new Set([...projectOrder, ...cwds])];
		setProjectOrder(next);
		persistProjectOrder(next);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [baseProjectList]);

	// Displayed order: pinned `projectOrder` first, then any project that isn't
	// pinned yet (new projects) appended in their base order. Stable across reloads.
	const projectList = useMemo(() => {
		const indexByCwd = new Map(baseProjectList.map((p) => [p.cwd, p]));
		const ordered: { cwd: string; tree: SessionTreeNode[] }[] = [];
		const seen = new Set<string>();
		// 1. Explicit pinned order (survives reloads, never reshuffles).
		for (const cwd of projectOrder) {
			const p = indexByCwd.get(cwd);
			if (p && !seen.has(cwd)) {
				ordered.push(p);
				seen.add(cwd);
			}
		}
		// 2. Anything not pinned yet (new projects) appended once at the end.
		for (const p of baseProjectList) {
			if (!seen.has(p.cwd)) {
				ordered.push(p);
				seen.add(p.cwd);
			}
		}
		return ordered;
	}, [baseProjectList, projectOrder]);

	const moveProject = useCallback(
		(fromCwd: string, toCwd: string) => {
			if (fromCwd === toCwd) return;
			setProjectOrder((prev) => {
				const next = moveInList(prev, fromCwd, toCwd);
				persistProjectOrder(next);
				return next;
			});
			setDropTargetCwd(null);
			setDragCwd(null);
		},
		[persistProjectOrder],
	);

	// Expanded/collapsed state of each project folder node
	const [collapsedCwds, setCollapsedCwds] = useState<Record<string, boolean>>(
		() => {
			if (typeof window !== "undefined") {
				try {
					const stored = localStorage.getItem("pi-collapsed-cwds");
					if (stored) return JSON.parse(stored);
				} catch {}
			}
			return {};
		},
	);

	const toggleCwdCollapse = useCallback((cwd: string) => {
		setCollapsedCwds((prev) => {
			const next = { ...prev, [cwd]: !prev[cwd] };
			try {
				localStorage.setItem("pi-collapsed-cwds", JSON.stringify(next));
			} catch {}
			return next;
		});
	}, []);

	return (
		<div
			ref={sidebarRef}
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			{/* Header */}
			<div
				data-sidebar-header=""
				style={{
					padding: "10px 10px 8px",
					borderBottom: "1px solid var(--border)",
					flexShrink: 0,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: 6,
					}}
				>
					<PiAgentTitle />
					<div style={{ display: "flex", gap: 4 }}>
						{/* 归档会话按钮:聚焦弹出所有被关闭项目下的会话,点单个会话还原 */}
						<button
							onClick={() => setArchivedOpen(true)}
							title="归档会话"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								background: archivedOpen
									? "rgba(37,99,235,0.12)"
									: "var(--bg-hover)",
								border: `1px solid ${archivedOpen ? "rgba(37,99,235,0.4)" : "var(--border)"}`,
								color: archivedOpen ? "var(--accent)" : "var(--text-muted)",
								cursor: "pointer",
								width: 26,
								height: 26,
								borderRadius: 6,
								padding: 0,
								flexShrink: 0,
								transition: "background 0.3s, color 0.3s, border-color 0.3s",
							}}
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
								<path d="M9.2 13.2l2 2 3.6-3.6" />
							</svg>
							{/* 红点提示:有归档会话待处理 */}
						</button>
						{/* Refresh Sessions Button */}
						<button
							onClick={() => loadSessions(false)}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								background: sessionRefreshDone
									? "rgba(74,222,128,0.18)"
									: "var(--bg-hover)",
								border: `1px solid ${sessionRefreshDone ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
								color: sessionRefreshDone ? "#4ade80" : "var(--text-muted)",
								cursor: "pointer",
								width: 26,
								height: 26,
								borderRadius: 6,
								padding: 0,
								flexShrink: 0,
								transition: "background 0.3s, color 0.3s, border-color 0.3s",
							}}
							title="Refresh"
						>
							{sessionRefreshDone ? (
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="#4ade80"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<polyline points="20 6 9 17 4 12" />
								</svg>
							) : (
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
									<path d="M3 3v5h5" />
								</svg>
							)}
						</button>
					</div>
				</div>

				{/* Minimalist Add Project Trigger */}
				<div style={{ marginTop: 6 }}>
					<button
						onClick={() => handleBrowseFolder()}
						style={{
							width: "100%",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: 4,
							padding: "4px 8px",
							background: "var(--bg-hover)",
							border: "1px solid var(--border)",
							borderRadius: 7,
							cursor: "pointer",
							fontSize: 11,
							fontWeight: 600,
							color: "var(--text-muted)",
							transition: "border-color 0.15s, background 0.15s",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.borderColor = "var(--accent)";
							e.currentTarget.style.color = "var(--text)";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.borderColor = "var(--border)";
							e.currentTarget.style.color = "var(--text-muted)";
						}}
					>
						<svg
							width="9"
							height="9"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							strokeLinecap="round"
							style={{ flexShrink: 0 }}
						>
							<line x1="12" y1="5" x2="12" y2="19" />
							<line x1="5" y1="12" x2="19" y2="12" />
						</svg>
						<span>Add Project Directory…</span>
					</button>
				</div>

				{/* Browse Directory Modal */}
				{browseOpen && (
					<div
						style={{
							position: "fixed",
							inset: 0,
							zIndex: 500,
							background: "rgba(0,0,0,0.45)",
							backdropFilter: "blur(4px)",
							pointerEvents: "none",
						}}
					>
						<div
							ref={dropdownRef}
							style={{
								position: "absolute",
								top: 40,
								left: 40,
								width: 720,
								maxHeight: "calc(100vh - 80px)",
								display: "flex",
								flexDirection: "column",
								background: "var(--bg)",
								border: "1px solid var(--border)",
								borderRadius: 10,
								boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
								overflow: "hidden",
								pointerEvents: "auto",
							}}
						>
							{/* Modal header */}
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "14px 16px 10px",
									borderBottom: "1px solid var(--border)",
									flexShrink: 0,
								}}
							>
								<span
									style={{
										fontSize: 13,
										fontWeight: 700,
										color: "var(--text)",
									}}
								>
									Add Project Directory
								</span>
								<button
									onClick={() => {
										setBrowseOpen(false);
										setBrowseError(null);
									}}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										width: 24,
										height: 24,
										border: "none",
										background: "none",
										color: "var(--text-dim)",
										cursor: "pointer",
										borderRadius: 4,
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.color = "var(--text)";
										e.currentTarget.style.background = "var(--bg-hover)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.color = "var(--text-dim)";
										e.currentTarget.style.background = "none";
									}}
								>
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.5"
										strokeLinecap="round"
									>
										<line x1="18" y1="6" x2="6" y2="18" />
										<line x1="6" y1="6" x2="18" y2="18" />
									</svg>
								</button>
							</div>

							{/* Path bar */}
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 8,
									padding: "10px 16px",
									borderBottom: "1px solid var(--border)",
									flexShrink: 0,
								}}
							>
								<button
									onClick={() => {
										if (browseParentPath && !browseLoading)
											loadBrowseEntries(browseParentPath).catch(() => {});
									}}
									disabled={!browseParentPath || browseLoading}
									style={{
										width: 28,
										height: 28,
										padding: 0,
										borderRadius: 6,
										border: "1px solid var(--border)",
										background: "var(--bg-hover)",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										fontSize: 14,
										flexShrink: 0,
										cursor:
											browseParentPath && !browseLoading
												? "pointer"
												: "not-allowed",
										opacity: browseParentPath ? 1 : 0.4,
									}}
									title={
										browseParentPath
											? `Up to ${browseParentPath}`
											: "Already at root"
									}
								>
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.5"
										strokeLinecap="round"
										strokeLinejoin="round"
										style={{ flexShrink: 0 }}
									>
										<polyline points="18 15 12 9 6 15" />
									</svg>
								</button>
								{browseIsEditingPath ? (
									<input
										type="text"
										value={browsePathInputVal}
										onChange={(e) => setBrowsePathInputVal(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												loadBrowseEntries(browsePathInputVal).catch((err) =>
													setBrowseError(String(err)),
												);
											} else if (e.key === "Escape") {
												setBrowseIsEditingPath(false);
												setBrowsePathInputVal(browsePath ?? "");
											}
										}}
										onBlur={() => {
											setTimeout(() => {
												setBrowseIsEditingPath(false);
												setBrowsePathInputVal(browsePath ?? "");
											}, 250);
										}}
										autoFocus
										style={{
											flex: 1,
											minWidth: 0,
											fontSize: 12,
											fontFamily: "var(--font-mono)",
											color: "var(--text)",
											padding: "6px 10px",
											border: "1px solid var(--accent)",
											borderRadius: 6,
											background: "var(--bg)",
											outline: "none",
										}}
									/>
								) : (
									<div
										onDoubleClick={() => setBrowseIsEditingPath(true)}
										style={{
											flex: 1,
											minWidth: 0,
											display: "flex",
											alignItems: "center",
											gap: 2,
											padding: "5px 8px",
											border: "1px solid var(--border)",
											borderRadius: 6,
											background: "var(--bg-hover)",
											overflowX: "auto",
											scrollbarWidth: "none",
											whiteSpace: "nowrap",
											cursor: "text",
										}}
										title="Double-click to edit path directly"
									>
										<div style={{ display: "flex", alignItems: "center" }}>
											{browseBreadcrumbs.map(
												(
													crumb: { name: string; path: string },
													idx: number,
												) => (
													<span
														key={crumb.path}
														style={{
															display: "inline-flex",
															alignItems: "center",
														}}
													>
														{idx > 0 && (
															<span
																style={{
																	color: "var(--text-dim)",
																	fontSize: 11,
																	margin: "0 3px",
																	userSelect: "none",
																}}
															>
																/
															</span>
														)}
														<button
															onClick={(e) => {
																e.stopPropagation();
																loadBrowseEntries(crumb.path).catch(() => {});
															}}
															style={{
																background: "none",
																border: "none",
																padding: "2px 5px",
																borderRadius: 4,
																fontSize: 12,
																fontFamily: "var(--font-mono)",
																color:
																	idx === browseBreadcrumbs.length - 1
																		? "var(--text)"
																		: "var(--accent)",
																cursor: "pointer",
																fontWeight:
																	idx === browseBreadcrumbs.length - 1
																		? "bold"
																		: "normal",
																transition: "background 0.15s",
															}}
															onMouseEnter={(e) =>
																(e.currentTarget.style.background =
																	"rgba(100,116,139,0.12)")
															}
															onMouseLeave={(e) =>
																(e.currentTarget.style.background = "none")
															}
														>
															{crumb.name}
														</button>
													</span>
												),
											)}
										</div>
										<button
											onClick={(e) => {
												e.stopPropagation();
												setBrowseIsEditingPath(true);
											}}
											style={{
												marginLeft: "auto",
												background: "none",
												border: "none",
												padding: "4px",
												cursor: "pointer",
												color: "var(--text-dim)",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												borderRadius: 4,
												flexShrink: 0,
											}}
											onMouseEnter={(e) =>
												(e.currentTarget.style.color = "var(--text)")
											}
											onMouseLeave={(e) =>
												(e.currentTarget.style.color = "var(--text-dim)")
											}
											title="Edit path directly"
										>
											<svg
												width="11"
												height="11"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											>
												<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
											</svg>
										</button>
									</div>
								)}
							</div>

							{/* Body: left-right layout */}
							<div
								style={{
									display: "flex",
									flex: 1,
									minHeight: 0,
									overflow: "hidden",
								}}
							>
								{/* Left panel — Recent paths */}
								<div
									style={{
										width: 220,
										flexShrink: 0,
										borderRight: "1px solid var(--border)",
										display: "flex",
										flexDirection: "column",
										overflow: "hidden",
									}}
								>
									<div
										style={{
											padding: "10px 12px 6px",
											fontSize: 10,
											fontWeight: 600,
											color: "var(--text-dim)",
											textTransform: "uppercase",
											letterSpacing: "0.05em",
											flexShrink: 0,
										}}
									>
										Recent Projects
									</div>
									<div
										style={{
											flex: 1,
											overflowY: "auto",
											scrollbarWidth: "thin",
											padding: "0 6px",
										}}
									>
										{recentCwdOptions.length === 0 ? (
											<div
												style={{
													padding: "12px 8px",
													fontSize: 11,
													color: "var(--text-dim)",
													fontStyle: "italic",
												}}
											>
												No recent projects
											</div>
										) : (
											recentCwdOptions.slice(0, 12).map(({ cwd }) => {
												const short = shortenCwd(cwd, homeDir);
												return (
													<button
														key={cwd}
														onClick={() =>
															loadBrowseEntries(cwd).catch(() => {})
														}
														style={{
															width: "100%",
															display: "flex",
															alignItems: "center",
															gap: 8,
															padding: "7px 8px",
															background: "none",
															border: "none",
															borderRadius: 5,
															textAlign: "left",
															fontSize: 12,
															color: "var(--text-muted)",
															cursor: "pointer",
															transition: "background 0.1s, color 0.1s",
														}}
														onMouseEnter={(e) => {
															e.currentTarget.style.background =
																"var(--bg-selected)";
															e.currentTarget.style.color = "var(--text)";
														}}
														onMouseLeave={(e) => {
															e.currentTarget.style.background = "none";
															e.currentTarget.style.color = "var(--text-muted)";
														}}
														title={cwd}
													>
														<svg
															width="13"
															height="13"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															strokeWidth="2"
															strokeLinecap="round"
															strokeLinejoin="round"
															style={{
																flexShrink: 0,
																color: "var(--text-dim)",
															}}
														>
															<circle cx="12" cy="12" r="10" />
															<polyline points="12 6 12 12 16 14" />
														</svg>
														<div
															style={{
																display: "flex",
																flexDirection: "column",
																minWidth: 0,
																flex: 1,
															}}
														>
															<span
																style={{
																	fontWeight: 600,
																	fontSize: 12,
																	overflow: "hidden",
																	textOverflow: "ellipsis",
																	whiteSpace: "nowrap",
																}}
															>
																{short}
															</span>
															<span
																style={{
																	fontSize: 10,
																	color: "var(--text-dim)",
																	overflow: "hidden",
																	textOverflow: "ellipsis",
																	whiteSpace: "nowrap",
																}}
															>
																{cwd}
															</span>
														</div>
													</button>
												);
											})
										)}
									</div>
								</div>

								{/* Right panel — File browser */}
								<div
									style={{
										flex: 1,
										display: "flex",
										flexDirection: "column",
										minWidth: 0,
										overflow: "hidden",
									}}
								>
									{/* Error */}
									{browseError && (
										<div
											style={{
												margin: "8px 12px 0",
												color: "#f87171",
												fontSize: 11,
												padding: "6px 10px",
												background: "rgba(239,68,68,0.06)",
												borderRadius: 6,
												border: "1px solid rgba(239,68,68,0.12)",
											}}
										>
											{browseError}
										</div>
									)}

									{/* Search filter */}
									<div style={{ padding: "8px 12px", flexShrink: 0 }}>
										<input
											type="text"
											placeholder="Filter directories..."
											value={browseSearch}
											onChange={(e) => setBrowseSearch(e.target.value)}
											style={{
												width: "100%",
												fontSize: 12,
												padding: "7px 10px",
												border: "1px solid var(--border)",
												borderRadius: 6,
												outline: "none",
												background: "var(--bg)",
												color: "var(--text)",
												boxSizing: "border-box",
											}}
										/>
									</div>

									{/* File list */}
									<div
										style={{
											flex: 1,
											minHeight: 0,
											overflowY: "auto",
											scrollbarWidth: "thin",
											padding: "0 12px",
										}}
									>
										{browseLoading ? (
											<div
												style={{
													padding: "16px 0",
													fontSize: 12,
													color: "var(--text-dim)",
													fontStyle: "italic",
												}}
											>
												Loading folder entries...
											</div>
										) : filteredBrowseEntries.length === 0 ? (
											<div
												style={{
													padding: "16px 0",
													fontSize: 12,
													color: "var(--text-dim)",
													fontStyle: "italic",
												}}
											>
												No matching sub-directories
											</div>
										) : (
											filteredBrowseEntries.map((entry) => (
												<button
													key={entry.path}
													onClick={() =>
														loadBrowseEntries(entry.path).catch(() => {})
													}
													style={{
														width: "100%",
														display: "flex",
														alignItems: "center",
														gap: 8,
														padding: "8px 10px",
														background: "none",
														border: "none",
														borderBottom: "1px solid var(--border)",
														textAlign: "left",
														fontSize: 12,
														color: "var(--text-muted)",
														cursor: "pointer",
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
														borderRadius: 0,
														transition: "background 0.1s, color 0.1s",
													}}
													onMouseEnter={(e) => {
														e.currentTarget.style.background =
															"var(--bg-selected)";
														e.currentTarget.style.color = "var(--text)";
													}}
													onMouseLeave={(e) => {
														e.currentTarget.style.background = "none";
														e.currentTarget.style.color = "var(--text-muted)";
													}}
													title={entry.path}
												>
													<svg
														width="14"
														height="14"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth="2"
														strokeLinecap="round"
														strokeLinejoin="round"
														style={{ flexShrink: 0, color: "var(--accent)" }}
													>
														<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
													</svg>
													<span
														style={{
															flex: 1,
															overflow: "hidden",
															textOverflow: "ellipsis",
															whiteSpace: "nowrap",
														}}
													>
														{entry.name}
													</span>
												</button>
											))
										)}
									</div>
								</div>
							</div>

							{/* Footer actions */}
							<div
								style={{
									display: "flex",
									gap: 8,
									padding: "12px 16px",
									borderTop: "1px solid var(--border)",
									flexShrink: 0,
								}}
							>
								<button
									onClick={() => {
										if (!browsePath || browseLoading) return;
										commitSelectedCwd(browsePath).catch((e) =>
											setBrowseError(String(e)),
										);
									}}
									disabled={!browsePath || browseLoading}
									style={{
										flex: 1,
										padding: "8px 0",
										background: "var(--accent)",
										border: "none",
										borderRadius: 6,
										color: "#fff",
										fontSize: 12,
										fontWeight: 700,
										cursor:
											!browsePath || browseLoading ? "not-allowed" : "pointer",
										opacity: !browsePath || browseLoading ? 0.6 : 1,
										transition: "opacity 0.15s",
									}}
								>
									Add Project
								</button>
								<button
									onClick={() => {
										setBrowseOpen(false);
										setBrowseError(null);
									}}
									style={{
										flex: 1,
										padding: "8px 0",
										background: "var(--bg-hover)",
										border: "1px solid var(--border)",
										borderRadius: 6,
										color: "var(--text-muted)",
										fontSize: 12,
										fontWeight: 500,
										cursor: "pointer",
										transition: "background 0.15s",
									}}
								>
									Cancel
								</button>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Structured "Project - Session" Folders List */}
			<div
				style={{
					flex:
						explorerOpen && activeProjectCwd
							? `${1 - explorerFraction} 1 0`
							: "1 1 auto",
					overflowY: "auto",
					padding: "6px 2px",
					minHeight: 80,
				}}
			>
				{loading && (
					<div
						style={{
							padding: "16px 14px",
							color: "var(--text-muted)",
							fontSize: 12,
						}}
					>
						Loading Project Workspaces...
					</div>
				)}
				{error && (
					<div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
						{error}
					</div>
				)}
				{!loading && !error && projectList.length === 0 && (
					<div
						style={{
							padding: "16px 14px",
							color: "var(--text-muted)",
							fontSize: 12,
						}}
					>
						No sessions or project workspaces found
					</div>
				)}
				{projectList.map(({ cwd, tree }) => {
					const isCollapsed = !!collapsedCwds[cwd];
					const isActiveProject = cwd === activeProjectCwd;
					const shortName = shortenCwd(cwd, homeDir);

					return (
						<div
							key={cwd}
							style={{
								marginBottom: 12,
								opacity: dragCwd === cwd ? 0.4 : 1,
								borderRadius: 6,
								boxShadow:
									dropTargetCwd === cwd && dragCwd && dragCwd !== cwd
										? "inset 0 2px 0 var(--accent)"
										: "none",
								paddingTop:
									dropTargetCwd === cwd && dragCwd && dragCwd !== cwd ? 3 : 0,
							}}
							draggable
							onDragStart={(e) => {
								e.dataTransfer.effectAllowed = "move";
								e.dataTransfer.setData("text/plain", cwd);
								setDragCwd(cwd);
							}}
							onDragOver={(e) => {
								e.preventDefault();
								e.dataTransfer.dropEffect = "move";
								if (dragCwd && dragCwd !== cwd) setDropTargetCwd(cwd);
							}}
							onDragLeave={(e) => {
								if (e.currentTarget.contains(e.relatedTarget as Node)) return;
								if (dragCwd && dropTargetCwd === cwd) setDropTargetCwd(null);
							}}
							onDrop={(e) => {
								e.preventDefault();
								const from = e.dataTransfer.getData("text/plain");
								if (from) moveProject(from, cwd);
							}}
							onDragEnd={() => {
								setDragCwd(null);
								setDropTargetCwd(null);
							}}
						>
							{/* CWD Folder Group Header */}
							<div
								onClick={() => {
									setSelectedCwd(cwd);
									toggleCwdCollapse(cwd);
								}}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "5px 6px",
									borderRadius: 6,
									cursor: dragCwd ? "grabbing" : "grab",
									background: isActiveProject
										? "rgba(37,99,235,0.06)"
										: "transparent",
									border: isActiveProject
										? "1px solid rgba(37,99,235,0.18)"
										: "1px solid transparent",
									transition: "background 0.12s",
								}}
								onMouseEnter={(e) => {
									setHoverProjectCwd(cwd);
									if (!isActiveProject)
										e.currentTarget.style.background = "var(--bg-hover)";
								}}
								onMouseLeave={(e) => {
									setHoverProjectCwd(null);
									if (!isActiveProject)
										e.currentTarget.style.background = "transparent";
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: 5,
										minWidth: 0,
										paddingLeft: 2,
									}}
								>
									<svg
										width="7"
										height="7"
										viewBox="0 0 10 10"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.2"
										style={{
											transform: isCollapsed ? "none" : "rotate(90deg)",
											transition: "transform 0.12s",
											color: isActiveProject
												? "var(--accent)"
												: "var(--text-dim)",
											flexShrink: 0,
										}}
									>
										<polyline points="3 2 7 5 3 8" />
									</svg>
									<span
										style={{
											fontSize: 11.5,
											fontWeight: 700,
											color: isActiveProject
												? "var(--text)"
												: "var(--text-muted)",
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
										title={cwd}
									>
										{shortName}
									</span>
									<span
										style={{
											fontSize: 9,
											color: "var(--text-dim)",
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
											marginLeft: 2,
											opacity: 0.8,
										}}
									>
										({cwd})
									</span>
								</div>

								{/* Row actions: drag handle + new session + hide workspace (shown on row hover) */}
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: 2,
										flexShrink: 0,
										opacity: hoverProjectCwd === cwd ? 1 : 0,
										pointerEvents: hoverProjectCwd === cwd ? "auto" : "none",
										transition: "opacity 0.12s",
									}}
								>
									<span
										title="Drag to reorder"
										style={{
											width: 14,
											height: 16,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											color: "var(--text-dim)",
											cursor: "grab",
											opacity: dragCwd === cwd ? 0.5 : 0.55,
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.color = "var(--accent)";
											e.currentTarget.style.opacity = "1";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.color = "var(--text-dim)";
											e.currentTarget.style.opacity = "0.55";
										}}
									>
										<svg
											width="10"
											height="12"
											viewBox="0 0 10 12"
											fill="currentColor"
										>
											<circle cx="2.5" cy="2" r="1" />
											<circle cx="7.5" cy="2" r="1" />
											<circle cx="2.5" cy="6" r="1" />
											<circle cx="7.5" cy="6" r="1" />
											<circle cx="2.5" cy="10" r="1" />
											<circle cx="7.5" cy="10" r="1" />
										</svg>
									</span>
									<button
										onClick={(e) => {
											e.stopPropagation();
											handleNewSessionFor(cwd);
										}}
										title={`New session in ${cwd}`}
										style={{
											background: "none",
											border: "none",
											width: 18,
											height: 18,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											color: "var(--text-dim)",
											cursor: "pointer",
											borderRadius: 3,
											padding: 0,
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.color = "var(--accent)";
											e.currentTarget.style.background = "rgba(37,99,235,0.10)";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.color = "var(--text-dim)";
											e.currentTarget.style.background = "none";
										}}
									>
										<svg
											width="11"
											height="11"
											viewBox="0 0 12 12"
											fill="none"
											stroke="currentColor"
											strokeWidth="2.2"
											strokeLinecap="round"
										>
											<line x1="6" y1="1.5" x2="6" y2="10.5" />
											<line x1="1.5" y1="6" x2="10.5" y2="6" />
										</svg>
									</button>
									<button
										onClick={(e) => {
											e.stopPropagation();
											setConfirmHideCwd(cwd);
										}}
										title="Close this project from workspace"
										style={{
											background: "none",
											border: "none",
											width: 16,
											height: 16,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											color: "var(--text-dim)",
											cursor: "pointer",
											borderRadius: 3,
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.color = "#f87171";
											e.currentTarget.style.background =
												"rgba(239, 68, 68, 0.08)";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.color = "var(--text-dim)";
											e.currentTarget.style.background = "none";
										}}
									>
										<svg
											width="11"
											height="11"
											viewBox="0 0 12 12"
											fill="none"
											stroke="currentColor"
											strokeWidth="2.2"
											strokeLinecap="round"
										>
											<line x1="1.5" y1="1.5" x2="10.5" y2="10.5" />
											<line x1="10.5" y1="1.5" x2="1.5" y2="10.5" />
										</svg>
									</button>
								</div>
							</div>

							{/* Collapsible sessions tree children box */}
							{!isCollapsed && (
								<div
									style={{
										paddingLeft: 10,
										marginTop: 4,
										borderLeft: "1px dashed var(--border)",
										marginLeft: 4,
									}}
								>
									{tree.length === 0 ? (
										<div
											style={{
												padding: "8px 12px",
												fontSize: 11,
												color: "var(--text-dim)",
												fontStyle: "italic",
											}}
										>
											No active sessions. Click "New" above to start one.
										</div>
									) : (
										tree.map((node) => (
											<SessionTreeItem
												key={node.session.id}
												node={node}
												selectedSessionId={selectedSessionId}
												onSelectSession={handleSessionSelect}
												runningSessionId={runningSessionId}
												pendingSessionIds={pendingSessionIds}
												seenAt={seenAt}
												onRenamed={loadSessions}
												onSessionDeleted={(id, cwd) => {
													onSessionDeleted?.(id, cwd);
													trashSession(id);
													loadSessions().then(() => {
														// 删除会话后，如果该项目的最后一个会话也被删了，
														// 仍应保留项目在工作区列表中，而不是随会话一起消失。
														if (!hiddenCwds[cwd]) rememberCwd(cwd);
													});
												}}
												depth={0}
											/>
										))
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Drag handle between session list and explorer */}
			{(selectedCwdProp || selectedCwd) && explorerOpen && (
				<div
					onMouseDown={(e) => {
						e.preventDefault();
						draggingRef.current = true;
						document.body.style.cursor = "row-resize";
						document.body.style.userSelect = "none";
					}}
					style={{
						flexShrink: 0,
						height: 5,
						cursor: "row-resize",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "transparent",
						borderTop: "1px solid var(--border)",
						transition: "background 0.15s",
						position: "relative",
					}}
					onMouseEnter={(e) => {
						e.currentTarget.style.background = "var(--bg-hover)";
					}}
					onMouseLeave={(e) => {
						if (!draggingRef.current)
							e.currentTarget.style.background = "transparent";
					}}
				>
					<div
						style={{
							width: 24,
							height: 2,
							borderRadius: 1,
							background: "var(--border)",
						}}
					/>
				</div>
			)}

			{/* File Explorer section */}
			{(selectedCwdProp || selectedCwd) && (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						borderTop: !explorerOpen ? "1px solid var(--border)" : undefined,
						flex: explorerOpen ? `${explorerFraction} 1 0` : "0 0 auto",
						minHeight: 0,
						overflow: "hidden",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
						<button
							onClick={() => setExplorerOpen((v) => !v)}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								flex: 1,
								padding: "6px 10px",
								background: "none",
								border: "none",
								color: "var(--text-muted)",
								cursor: "pointer",
								fontSize: 11,
								fontWeight: 600,
								letterSpacing: "0.05em",
								textTransform: "uppercase",
								textAlign: "left",
							}}
						>
							<svg
								width="9"
								height="9"
								viewBox="0 0 10 10"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
								style={{
									transform: explorerOpen ? "rotate(90deg)" : "none",
									transition: "transform 0.15s",
									flexShrink: 0,
								}}
							>
								<polyline points="3 2 7 5 3 8" />
							</svg>
							Explorer
						</button>
						<button
							onClick={async () => {
								const targetCwd = selectedCwdProp ?? selectedCwd;
								if (!targetCwd) return;
								try {
									const res = await fetch("/api/open-folder", {
										method: "POST",
										headers: { "Content-Type": "application/json" },
										body: JSON.stringify({ path: targetCwd }),
									});
									if (!res.ok) {
										const data = await res.json();
										alert(`Failed to open folder: ${data.error}`);
									}
								} catch (err: any) {
									alert(`Failed to open folder: ${err.message || err}`);
								}
							}}
							title="Open folder in system explorer"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 26,
								height: 26,
								padding: 0,
								marginRight: 4,
								background: "none",
								border: "none",
								color: "var(--text-dim)",
								cursor: "pointer",
								borderRadius: 5,
								flexShrink: 0,
								transition: "color 0.3s, background 0.3s",
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.color = "var(--text-muted)";
								e.currentTarget.style.background = "var(--bg-hover)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.color = "var(--text-dim)";
								e.currentTarget.style.background = "none";
							}}
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
								<polyline points="12 11 15 8 12 5" />
								<line x1="9" y1="8" x2="15" y2="8" />
							</svg>
						</button>
						<button
							onClick={() => {
								setExplorerKey((k) => k + 1);
								setExplorerRefreshDone(true);
								if (explorerRefreshTimerRef.current)
									clearTimeout(explorerRefreshTimerRef.current);
								explorerRefreshTimerRef.current = setTimeout(
									() => setExplorerRefreshDone(false),
									2000,
								);
							}}
							title="Refresh explorer"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 26,
								height: 26,
								padding: 0,
								marginRight: 6,
								background: explorerRefreshDone
									? "rgba(74,222,128,0.18)"
									: "none",
								border: "none",
								color: explorerRefreshDone ? "#4ade80" : "var(--text-dim)",
								cursor: "pointer",
								borderRadius: 5,
								flexShrink: 0,
								transition: "color 0.3s, background 0.3s",
							}}
							onMouseEnter={(e) => {
								if (explorerRefreshDone) return;
								e.currentTarget.style.color = "var(--text-muted)";
								e.currentTarget.style.background = "var(--bg-hover)";
							}}
							onMouseLeave={(e) => {
								if (explorerRefreshDone) return;
								e.currentTarget.style.color = "var(--text-dim)";
								e.currentTarget.style.background = "none";
							}}
						>
							{explorerRefreshDone ? (
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="#4ade80"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<polyline points="20 6 9 17 4 12" />
								</svg>
							) : (
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
									<path d="M3 3v5h5" />
								</svg>
							)}
						</button>
					</div>
					{explorerOpen && (
						<div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
							<FileExplorer
								cwd={selectedCwdProp ?? selectedCwd!}
								onOpenFile={onOpenFile ?? (() => {})}
								refreshKey={explorerKey}
								onAtMention={onAtMention}
							/>
						</div>
					)}
				</div>
			)}

			{/* Close-project confirmation dialog */}
			{confirmHideCwd && (
				<div
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 600,
						background: "rgba(0,0,0,0.45)",
						backdropFilter: "blur(4px)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
					onClick={() => setConfirmHideCwd(null)}
				>
					<div
						onClick={(e) => e.stopPropagation()}
						style={{
							width: 380,
							maxWidth: "calc(100vw - 32px)",
							background: "var(--bg)",
							border: "1px solid var(--border)",
							borderRadius: 10,
							boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
							padding: 18,
						}}
					>
						<div
							style={{
								fontSize: 14,
								fontWeight: 700,
								color: "var(--text)",
								marginBottom: 8,
							}}
						>
							Close this project?
						</div>
						<div
							style={{
								fontSize: 12,
								lineHeight: 1.6,
								color: "var(--text-muted)",
								marginBottom: 16,
								wordBreak: "break-all",
							}}
						>
							“{confirmHideCwd}” will be removed from the workspace.
							Existing sessions are preserved and you can re-add the project later.
						</div>
						<div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
							<button
								autoFocus
								onClick={() => setConfirmHideCwd(null)}
								style={{
									padding: "7px 14px",
									background: "var(--bg-hover)",
									border: "1px solid var(--border)",
									borderRadius: 6,
									color: "var(--text-muted)",
									fontSize: 12,
									fontWeight: 500,
									cursor: "pointer",
									transition: "background 0.15s",
								}}
								onMouseEnter={(e) =>
									(e.currentTarget.style.background = "var(--bg-selected)")
								}
								onMouseLeave={(e) =>
									(e.currentTarget.style.background = "var(--bg-hover)")
								}
							>
								Cancel
							</button>
							<button
								onClick={() => {
									const cwd = confirmHideCwd;
									setConfirmHideCwd(null);
									if (cwd) hideProjectCwd(cwd);
								}}
								style={{
									padding: "7px 14px",
									background: "#ef4444",
									border: "1px solid #ef4444",
									borderRadius: 6,
									color: "#fff",
									fontSize: 12,
									fontWeight: 700,
									cursor: "pointer",
									transition: "opacity 0.15s",
								}}
								onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
								onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
							>
								Close project
							</button>
						</div>
					</div>
				</div>
			)}

			{archivedOpen && (
				<div
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 600,
						background: "rgba(0,0,0,0.45)",
						backdropFilter: "blur(4px)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
					onClick={() => setArchivedOpen(false)}
				>
					<div
						onClick={(e) => e.stopPropagation()}
						style={{
							width: 560,
							maxWidth: "calc(100vw - 32px)",
							maxHeight: "calc(100vh - 96px)",
							display: "flex",
							flexDirection: "column",
							background: "var(--bg)",
							border: "1px solid var(--border)",
							borderRadius: 10,
							boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "14px 16px 10px",
								borderBottom: "1px solid var(--border)",
								flexShrink: 0,
							}}
						>
							<span
								style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}
							>
								归档会话
							</span>
							<button
								onClick={() => setArchivedOpen(false)}
								title="Close"
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: 24,
									height: 24,
									border: "none",
									background: "none",
									color: "var(--text-dim)",
									cursor: "pointer",
									borderRadius: 4,
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.color = "var(--text)";
									e.currentTarget.style.background = "var(--bg-hover)";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.color = "var(--text-dim)";
									e.currentTarget.style.background = "none";
								}}
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
								>
									<line x1="18" y1="6" x2="6" y2="18" />
									<line x1="6" y1="6" x2="18" y2="18" />
								</svg>
							</button>
						</div>
						<div
							style={{
								flex: 1,
								overflowY: "auto",
								padding: "10px 12px",
								scrollbarWidth: "thin",
							}}
						>
							{(() => {
								const hiddenList = Object.keys(hiddenCwds).filter(
									(c) => !!hiddenCwds[c] && c.trim().length > 0,
								);
								const hiddenSet = new Set(hiddenList);
								// 归档 = 被关闭项目的会话 ∪ 回收站里已删除的会话
								const archived = allSessions
									.filter((s) => hiddenSet.has(s.cwd) || trashedIds.has(s.id))
									.sort((a, b) => b.modified.localeCompare(a.modified));
								if (archived.length === 0) {
									return (
										<div
											style={{
												padding: "24px 12px",
												fontSize: 12,
												color: "var(--text-dim)",
												fontStyle: "italic",
											}}
										>
											没有归档会话
										</div>
									);
								}
								return archived.map((s) => (
									<ArchivedSessionRow
										key={s.id}
										session={s}
										homeDir={homeDir}
										onRestore={() => {
											// 回收站会话：从回收站还原(回原项目)；被关闭项目的会话：还原项目。
											if (trashedIds.has(s.id)) {
												restoreSession(s.id);
											} else {
												rememberCwd(s.cwd);
											}
											markSessionSeen(s.id);
											onSelectSession(s);
											setArchivedOpen(false);
											loadSessions();
										}}
										onRemoved={() => {
											// 彻底删除后：清掉回收站记录(若在)，若正查看该书签由上层关闭，再刷新列表。
											restoreSession(s.id);
											onSessionDeleted?.(s.id, s.cwd);
											loadSessions();
										}}
									/>
								))
								}
								)
								()
								}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// 归档列表里的单行：点击还原会话；右侧“彻底删除”会把 .jsonl 从磁盘永久移除(不可还原)。
// 之所以单独成组件：每行需要自己的确认态(confirming/deleting)，缩在 IIFE 里不便维护。
function ArchivedSessionRow({
	session,
	homeDir,
	onRestore,
	onRemoved,
}: {
	session: SessionInfo;
	homeDir?: string;
	onRestore: () => void;
	onRemoved: () => void;
}) {
	const stitle =
		session.name ||
		session.firstMessage.slice(0, 50) ||
		session.id.slice(0, 12);
	const [confirming, setConfirming] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const confirmDelete = async (e: React.MouseEvent) => {
		e.stopPropagation();
		setDeleting(true);
		try {
			await fetch(`/api/sessions/${encodeURIComponent(session.id)}?permanent=1`, {
				method: "DELETE",
			});
		} catch {
			// 文件已不存在等情况视同成功，交给上层清理列表即可。
		}
		onRemoved();
	};

	return (
		<div
			onClick={confirming || deleting ? undefined : onRestore}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				width: "100%",
				padding: "8px 10px",
				borderRadius: 6,
				background: confirming ? "rgba(239,68,68,0.06)" : "none",
				textAlign: "left",
				cursor: confirming || deleting ? "default" : "pointer",
				opacity: deleting ? 0.5 : 1,
				transition: "background 0.12s",
			}}
			onMouseEnter={(e) => {
				if (!confirming) e.currentTarget.style.background = "var(--bg-selected)";
			}}
			onMouseLeave={(e) => {
				if (!confirming) e.currentTarget.style.background = "none";
			}}
		>
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="var(--accent)"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{ flexShrink: 0 }}
			>
				<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
				<polyline points="7 10 12 15 17 10" />
				<line x1="12" y1="15" x2="12" y2="3" />
			</svg>
			<div style={{ flex: 1, minWidth: 0 }}>
				<div
					style={{
						fontSize: 10,
						color: "var(--text-dim)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						marginBottom: 2,
					}}
					title={session.cwd}
				>
					{shortenCwd(session.cwd, homeDir)}
				</div>
				<div
					style={{
						fontSize: 12,
						fontWeight: 500,
						color: "var(--text)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
					title={stitle}
				>
					{stitle}
				</div>
				<div
					style={{
						fontSize: 11,
						color: "var(--text-dim)",
					}}
				>
					{formatRelativeTime(session.modified)} · {session.messageCount} msgs
				</div>
				{session.lastMessage ? (
					<div
						style={{
							marginTop: 3,
							fontSize: 11,
							color: "var(--text-dim)",
							whiteSpace: "pre-wrap",
							overflow: "hidden",
							display: "-webkit-box",
							WebkitLineClamp: 2,
							WebkitBoxOrient: "vertical",
						}}
						title={session.lastMessage}
					>
						{session.lastMessage}
					</div>
				) : null}
			</div>
			{confirming ? (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 5,
						flexShrink: 0,
					}}
				>
					<span
						style={{
							fontSize: 11,
							fontWeight: 600,
							color: "#ef4444",
							whiteSpace: "nowrap",
						}}
					>
						彻底删除？
					</span>
					<button
						onClick={confirmDelete}
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: 4,
							height: 26,
							padding: "0 9px",
							background: "#ef4444",
							border: "none",
							borderRadius: 6,
							color: "#fff",
							cursor: "pointer",
							fontSize: 11,
							fontWeight: 600,
							whiteSpace: "nowrap",
						}}
					>
						删除
					</button>
					<button
						onClick={(e) => {
							e.stopPropagation();
							setConfirming(false);
						}}
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							height: 26,
							padding: "0 9px",
							background: "var(--bg)",
							border: "1px solid var(--border)",
							borderRadius: 6,
							color: "var(--text-muted)",
							cursor: "pointer",
							fontSize: 11,
							fontWeight: 500,
							whiteSpace: "nowrap",
						}}
					>
						取消
					</button>
				</div>
			) : (
				<>
					<span
						style={{
							fontSize: 11,
							fontWeight: 600,
							color: "var(--accent)",
							flexShrink: 0,
						}}
					>
						还原
					</span>
					<button
						title="彻底删除(不可还原)"
						onClick={(e) => {
							e.stopPropagation();
							setConfirming(true);
						}}
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: 24,
							height: 24,
							border: "none",
							background: "none",
							color: "var(--text-dim)",
							cursor: "pointer",
							borderRadius: 4,
							flexShrink: 0,
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.color = "#ef4444";
							e.currentTarget.style.background = "rgba(239,68,68,0.1)";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.color = "var(--text-dim)";
							e.currentTarget.style.background = "none";
						}}
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<polyline points="3 6 5 6 21 6" />
							<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
							<path d="M10 11v6M14 11v6" />
							<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
						</svg>
					</button>
				</>
			)}
		</div>
	);
}

function SessionTreeItem({
	node,
	selectedSessionId,
	onSelectSession,
	onRenamed,
	onSessionDeleted,
	runningSessionId,
	seenAt,
	depth,
	pendingSessionIds,
}: {
	node: SessionTreeNode;
	selectedSessionId: string | null;
	onSelectSession: (s: SessionInfo) => void;
	onRenamed?: () => void;
	onSessionDeleted?: (id: string, cwd: string) => void;
	runningSessionId?: string | null;
	seenAt?: Record<string, string>;
	depth: number;
	pendingSessionIds?: ReadonlySet<string>;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const hasChildren = node.children.length > 0;

	return (
		<div>
			<div style={{ position: "relative" }}>
				{/* Indent line for child sessions */}
				{depth > 0 && (
					<div
						style={{
							position: "absolute",
							left: depth * 12 + 6,
							top: 0,
							bottom: 0,
							width: 1,
							background: "var(--border)",
							pointerEvents: "none",
						}}
					/>
				)}
				<SessionItem
					session={node.session}
					isSelected={node.session.id === selectedSessionId}
					onClick={() => onSelectSession(node.session)}
					onRenamed={onRenamed}
					onDeleted={(id, cwd) => onSessionDeleted?.(id, cwd)}
					runningSessionId={runningSessionId}
					seenAt={seenAt}
					depth={depth}
					hasChildren={hasChildren}
					collapsed={collapsed}
					onToggleCollapse={() => setCollapsed((v) => !v)}
					pendingSessionIds={pendingSessionIds}
				/>
			</div>
			{hasChildren && !collapsed && (
				<div>
						{node.children.map((child) => (
							<SessionTreeItem
								key={child.session.id}
								node={child}
								selectedSessionId={selectedSessionId}
								onSelectSession={onSelectSession}
								onRenamed={onRenamed}
								onSessionDeleted={onSessionDeleted}
								runningSessionId={runningSessionId}
								seenAt={seenAt}
								depth={depth + 1}
								pendingSessionIds={pendingSessionIds}
							/>
						))}
				</div>
			)}
		</div>
	);
}

// Status dot shown before each session title: spinner while running, green when
// completed, red when failed.
function SessionStatusDot({ status }: { status: NonNullable<SessionInfo["status"]> }) {
	if (status === "running") {
		return (
			<span
				title="会话进行中"
				style={{
					width: 10,
					height: 10,
					flexShrink: 0,
					border: "1.5px solid var(--border)",
					borderTopColor: "var(--text-dim)",
					borderRadius: "50%",
					boxSizing: "border-box",
					animation: "spin 0.9s linear infinite",
				}}
			/>
		);
	}
	const failed = status === "failed";
	return (
		<span
			title={failed ? "会话失败" : "会话已完成"}
			style={{
				width: 7,
				height: 7,
				borderRadius: "50%",
				flexShrink: 0,
				background: failed ? "#f87171" : "#4ade80",
				boxShadow: `0 0 0 2px ${failed ? "rgba(248,113,113,0.18)" : "rgba(74,222,128,0.18)"}`,
			}}
		/>
	);
}

function SessionItem({
	session,
	isSelected,
	onClick,
	onRenamed,
	onDeleted,
	runningSessionId,
	seenAt = {},
	depth = 0,
	hasChildren = false,
	collapsed = false,
	onToggleCollapse,
	pendingSessionIds,
}: {
	session: SessionInfo;
	isSelected: boolean;
	onClick: () => void;
	onRenamed?: () => void;
	onDeleted?: (id: string, cwd: string) => void;
	runningSessionId?: string | null;
	seenAt?: Record<string, string>;
	depth?: number;
	hasChildren?: boolean;
	collapsed?: boolean;
	onToggleCollapse?: () => void;
	pendingSessionIds?: ReadonlySet<string>;
}) {
	const [hovered, setHovered] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState("");
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [copied, setCopied] = useState(false);
	const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const title =
		session.name ||
		session.firstMessage.slice(0, 50) ||
		session.id.slice(0, 12);

	const startRename = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			setRenameValue(session.name ?? "");
			setRenaming(true);
			setTimeout(() => inputRef.current?.select(), 0);
		},
		[session.name],
	);

	const commitRename = useCallback(async () => {
		const name = renameValue.trim();
		setRenaming(false);
		if (name === (session.name ?? "")) return;
		try {
			await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name }),
			});
			onRenamed?.();
		} catch {
			// ignore
		}
	}, [renameValue, session.id, session.name, onRenamed]);

	const handleCopyId = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		setCopied(true);
		if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
		copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
		copyText(session.id).catch(() => setCopied(false));
	}, [session.id]);

	useEffect(
		() => () => {
			if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
		},
		[],
	);

	const handleDeleteClick = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		setConfirmDelete(true);
	}, []);

	const handleDeleteConfirm = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			setConfirmDelete(false);
			setDeleting(true);
			try {
				await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
					method: "DELETE",
				});
				onDeleted?.(session.id, session.cwd);
			} catch {
				setDeleting(false);
			}
		},
		[session.id, session.cwd, onDeleted],
	);

	const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		setConfirmDelete(false);
	}, []);

	// Fixed-height outer wrapper — content swaps in place so the list never reflows
	const ITEM_HEIGHT = 44;

	return (
		<div
			onClick={confirmDelete || renaming ? undefined : onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => {
				setHovered(false);
			}}
			style={{
				height: ITEM_HEIGHT,
				display: "flex",
				alignItems: "center",
				paddingLeft: depth > 0 ? depth * 12 + 6 : 6,
				paddingRight: 8,
				cursor: confirmDelete || renaming ? "default" : "pointer",
				background: confirmDelete
					? "rgba(239,68,68,0.06)"
					: isSelected
						? "var(--bg-selected)"
						: hovered
							? "var(--bg-hover)"
							: "transparent",
				borderLeft: confirmDelete
					? "2px solid #ef4444"
					: isSelected
						? "2px solid var(--accent)"
						: "2px solid transparent",
				transition: "background 0.1s",
				opacity: deleting ? 0.5 : 1,
				gap: 6,
				overflow: "hidden",
			}}
		>
			{confirmDelete ? (
				/* ── Delete confirmation: same height, two flat buttons ── */
				<>
					<div
						style={{
							flex: 1,
							minWidth: 0,
							fontSize: 12,
							color: "var(--text)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						Delete{" "}
						<span style={{ fontWeight: 600 }}>
							&ldquo;{title.slice(0, 22)}
							{title.length > 22 ? "…" : ""}&rdquo;
						</span>
						?
					</div>
					<div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
						<button
							onClick={handleDeleteConfirm}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								gap: 4,
								height: 30,
								padding: "0 11px",
								background: "#ef4444",
								border: "none",
								borderRadius: 6,
								color: "#fff",
								cursor: "pointer",
								fontSize: 12,
								fontWeight: 600,
								whiteSpace: "nowrap",
							}}
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<polyline points="3 6 5 6 21 6" />
								<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
								<path d="M10 11v6M14 11v6" />
								<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
							</svg>
							Delete
						</button>
						<button
							onClick={handleDeleteCancel}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								height: 30,
								padding: "0 11px",
								background: "var(--bg)",
								border: "1px solid var(--border)",
								borderRadius: 6,
								color: "var(--text-muted)",
								cursor: "pointer",
								fontSize: 12,
								fontWeight: 500,
								whiteSpace: "nowrap",
							}}
						>
							Cancel
						</button>
					</div>
				</>
			) : renaming ? (
				/* ── Rename: input fills the same row ── */
				<input
					ref={inputRef}
					value={renameValue}
					onChange={(e) => setRenameValue(e.target.value)}
					onBlur={commitRename}
					onKeyDown={(e) => {
						if (e.key === "Enter") commitRename();
						if (e.key === "Escape") setRenaming(false);
					}}
					autoFocus
					style={{
						flex: 1,
						fontSize: 12,
						padding: "5px 8px",
						border: "1px solid var(--accent)",
						borderRadius: 5,
						outline: "none",
						background: "var(--bg)",
						color: "var(--text)",
						height: 30,
					}}
				/>
			) : (
				/* ── Normal view ── */
				<>
					{/* Fork indicator for child sessions */}
					{depth > 0 && (
						<svg
							width="10"
							height="10"
							viewBox="0 0 24 24"
							fill="none"
							stroke="var(--text-dim)"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ flexShrink: 0 }}
						>
							<line x1="6" y1="3" x2="6" y2="15" />
							<circle cx="18" cy="6" r="3" />
							<circle cx="6" cy="18" r="3" />
							<path d="M18 9a9 9 0 0 1-9 9" />
						</svg>
					)}
					{/* Session status dot: spinner whenever the server reports the session running
					    (authoritative running-ids set, so background/switched-away sessions get a
					    stable spinner regardless of selection/seenAt), or while streaming in this
					    tab (instant front-end fast-path). Terminal green/red show only for
					    done/failed sessions with an unviewed result. Reserved-width slot keeps the
					    row from shifting left/right as the dot appears, disappears, or changes
					    between spinner (10px) and terminal dot (7px). */}
					<div style={{ width: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
						{session.id === runningSessionId || session.status === "running" ? (
							<SessionStatusDot status="running" />
						) : (
							session.status &&
							!isSelected &&
							session.modified > (seenAt[session.id] ?? "") && (
								<SessionStatusDot status={session.status} />
							)
						)}
					</div>
					<div style={{ flex: 1, minWidth: 0 }}>
						<div
							style={{
								fontSize: 12,
								fontWeight: isSelected ? 500 : 400,
								lineHeight: 1.4,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								color: "var(--text)",
							}}
							title={title}
						>
							{title}
							{pendingSessionIds?.has(session.id) && (
								<span
									title="有未回答的问题，点进来即可作答"
									style={{
										marginLeft: 6,
										flexShrink: 0,
										fontSize: 10,
										lineHeight: "14px",
										padding: "0 5px",
										borderRadius: 8,
										background: "var(--accent)",
										color: "#fff",
									}}
								>
									待答
								</span>
							)}
						</div>
						<div
							style={{
								marginTop: 2,
								display: "flex",
								gap: 8,
								color: "var(--text-dim)",
								fontSize: 11,
							}}
						>
							<span title={session.modified}>
								{formatRelativeTime(session.modified)}
							</span>
							<span>{session.messageCount} msgs</span>
						</div>
					</div>

					{/* Collapse toggle — always visible when has children */}
					{hasChildren && (
						<button
							onClick={(e) => {
								e.stopPropagation();
								onToggleCollapse?.();
							}}
							title={collapsed ? "Expand forks" : "Collapse forks"}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 20,
								height: 20,
								padding: 0,
								flexShrink: 0,
								background: "none",
								border: "none",
								color: "var(--text-dim)",
								cursor: "pointer",
								transform: collapsed ? "rotate(-90deg)" : "none",
								transition: "transform 0.15s",
							}}
						>
							<svg
								width="10"
								height="10"
								viewBox="0 0 10 10"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<polyline points="2 3.5 5 6.5 8 3.5" />
							</svg>
						</button>
					)}

					{/* Action buttons — shown on hover */}
					{hovered && (
						<div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
							<button
								onClick={handleCopyId}
								title={copied ? "Copied!" : "Copy session ID"}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: 26,
									height: 26,
									padding: 0,
									background: copied
										? "rgba(74,222,128,0.14)"
										: "var(--bg-hover)",
									border: `1px solid ${copied ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
									borderRadius: 7,
									color: copied ? "#4ade80" : "var(--text-muted)",
									cursor: "pointer",
									flexShrink: 0,
									transition:
										"background 0.12s, color 0.12s, border-color 0.12s",
								}}
								onMouseEnter={(e) => {
									if (copied) return;
									e.currentTarget.style.background = "var(--bg-selected)";
									e.currentTarget.style.color = "var(--accent)";
									e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
								}}
								onMouseLeave={(e) => {
									if (copied) return;
									e.currentTarget.style.background = "var(--bg-hover)";
									e.currentTarget.style.color = "var(--text-muted)";
									e.currentTarget.style.borderColor = "var(--border)";
								}}
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
									<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
								</svg>
							</button>
							<button
								onClick={startRename}
								title="Rename"
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: 26,
									height: 26,
									padding: 0,
									background: "var(--bg-hover)",
									border: "1px solid var(--border)",
									borderRadius: 7,
									color: "var(--text-muted)",
									cursor: "pointer",
									flexShrink: 0,
									transition:
										"background 0.12s, color 0.12s, border-color 0.12s",
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.background = "var(--bg-selected)";
									e.currentTarget.style.color = "var(--accent)";
									e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.background = "var(--bg-hover)";
									e.currentTarget.style.color = "var(--text-muted)";
									e.currentTarget.style.borderColor = "var(--border)";
								}}
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
								</svg>
							</button>
							<button
								onClick={handleDeleteClick}
								title="Delete"
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: 26,
									height: 26,
									padding: 0,
									background: "var(--bg-hover)",
									border: "1px solid var(--border)",
									borderRadius: 7,
									color: "var(--text-muted)",
									cursor: "pointer",
									flexShrink: 0,
									transition:
										"background 0.12s, color 0.12s, border-color 0.12s",
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.background = "rgba(239,68,68,0.08)";
									e.currentTarget.style.color = "#ef4444";
									e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.background = "var(--bg-hover)";
									e.currentTarget.style.color = "var(--text-muted)";
									e.currentTarget.style.borderColor = "var(--border)";
								}}
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<polyline points="3 6 5 6 21 6" />
									<path d="M19 6V20a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								</svg>
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}

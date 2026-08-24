"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickSessionForCwd } from "@/lib/project-session-restore";
import {
	buildRecentCwdOptions,
	removeStoredRecentCwd,
} from "@/lib/recent-cwds";
import type { SessionInfo } from "@/lib/types";
import { BrowseDialog } from "./session-sidebar/BrowseDialog";
import { ProjectList } from "./session-sidebar/ProjectList";
import { SessionExplorer } from "./session-sidebar/SessionExplorer";

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

// 拆分的模块
import { getRecentCwds, moveInList, readStoredRecentCwds, buildSessionTree, RECENT_CWDS_LIMIT, RECENT_CWDS_STORAGE_KEY, PROJECT_ORDER_STORAGE_KEY, type SessionTreeNode } from "./session-sidebar/utils";
import { PiAgentTitle } from "./session-sidebar/PiAgentTitle";
import { ArchivedDialog } from "./session-sidebar/ArchivedDialog";
import { ConfirmHideDialog } from "./session-sidebar/ConfirmHideDialog";
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

	// 刷新文件浏览器：bump refreshKey 让 FileExplorer 重载，按钮闪 2s 绿色对勾。
	const refreshExplorer = useCallback(() => {
		setExplorerKey((k) => k + 1);
		setExplorerRefreshDone(true);
		if (explorerRefreshTimerRef.current)
			clearTimeout(explorerRefreshTimerRef.current);
		explorerRefreshTimerRef.current = setTimeout(
			() => setExplorerRefreshDone(false),
			2000,
		);
	}, []);

	// Session dots update via SSE push from the server (agent start/end across ALL
	// sessions, including background ones), plus explicit events (session select).
	// 状态与列表解耦：SSE 带 running 标志。running=true（正在流式跑，3s 心跳）
	// 只本地补那一个会话的转圈点，不重扫全表；running=false（跑完边沿）才拉
	// 一次列表拿到终态点。
	const patchSessionRunning = useCallback((id: string) => {
		setAllSessions((prev) => {
			const target = prev.find((s) => s.id === id);
			if (!target || target.status === "running") return prev; // 未变不产生新数组
			return prev.map((s) => (s.id === id ? { ...s, status: "running" as const } : s));
		});
	}, []);

	useEffect(() => {
		const es = new EventSource("/api/sessions/events");
		es.onmessage = (e) => {
			let ev: { type?: string; sessionId?: string; running?: boolean } | null = null;
			try {
				ev = JSON.parse(e.data);
			} catch { /* ignore malformed frame */ }
			if (ev?.type === "session_activity") {
				if (ev.running) {
					patchSessionRunning(ev.sessionId ?? "");
				} else {
					loadSessions(false, { silent: true });
				}
			}
		};
		return () => es.close();
	}, [loadSessions, patchSessionRunning]);

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

	const handleBrowseFolder = useCallback(() => {
		setBrowseOpen(true);
	}, []);

	const handleBrowseCommit = useCallback(
		async (cwd: string) => {
			rememberCwd(cwd);
			setSelectedCwd(cwd);
			setBrowseOpen(false);
		},
		[rememberCwd],
	);

	const handleSessionSelect = useCallback(
		(session: SessionInfo) => {
			// Viewing the session clears its terminal dot locally. No full-list refetch
			// here: 切换会话不必重扫全表,列表新鲜度由 SSE 推送维护。
			markSessionSeen(session.id);
			onSelectSession(session);
		},
		[onSelectSession, markSessionSeen],
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

			<BrowseDialog
				open={browseOpen}
				initialPath={selectedCwdProp ?? selectedCwd}
				recentCwds={recentCwdOptions}
				homeDir={homeDir}
				onClose={() => {
					setBrowseOpen(false);
				}}
				onCommit={handleBrowseCommit}
			/>
			</div>

			<ProjectList
				loading={loading}
				error={error}
				projectList={projectList}
				explorerOpen={explorerOpen}
				activeProjectCwd={activeProjectCwd}
				explorerFraction={explorerFraction}
				collapsedCwds={collapsedCwds}
				onToggleCollapse={toggleCwdCollapse}
				dragCwd={dragCwd}
				onDragCwd={setDragCwd}
				dropTargetCwd={dropTargetCwd}
				onDropTargetCwd={setDropTargetCwd}
				hoverProjectCwd={hoverProjectCwd}
				onHoverProjectCwd={setHoverProjectCwd}
				moveProject={moveProject}
				onSelectCwd={setSelectedCwd}
				onNewSession={handleNewSessionFor}
				onSelectSession={handleSessionSelect}
				selectedSessionId={selectedSessionId}
				runningSessionId={runningSessionId}
				pendingSessionIds={pendingSessionIds}
				seenAt={seenAt}
				onReload={loadSessions}
				onTrash={trashSession}
				onConfirmHide={setConfirmHideCwd}
				onRememberCwd={rememberCwd}
				hiddenCwds={hiddenCwds}
				homeDir={homeDir}
				onSessionDeleted={onSessionDeleted}
			/>

			<SessionExplorer
				explorerOpen={explorerOpen}
				onToggleOpen={() => setExplorerOpen((v) => !v)}
				explorerFraction={explorerFraction}
				cwd={selectedCwdProp ?? selectedCwd}
				onOpenFile={onOpenFile ?? (() => {})}
				onAtMention={onAtMention}
				refreshKey={explorerKey}
				refreshDone={explorerRefreshDone}
				onRefresh={refreshExplorer}
				draggingRef={draggingRef}
			/>

			<ConfirmHideDialog
				cwd={confirmHideCwd}
				onClose={() => setConfirmHideCwd(null)}
				onConfirm={(cwd) => {
					setConfirmHideCwd(null);
					if (cwd) hideProjectCwd(cwd);
				}}
			/>
			<ArchivedDialog
				open={archivedOpen}
				sessions={allSessions}
				hiddenCwds={hiddenCwds}
				trashedIds={trashedIds}
				homeDir={homeDir}
				onClose={() => setArchivedOpen(false)}
				onRestore={(s) => {
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
				onRemove={(s) => {
					restoreSession(s.id);
					onSessionDeleted?.(s.id, s.cwd);
					loadSessions();
				}}
			/>
		</div>
	);
}

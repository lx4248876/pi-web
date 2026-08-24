"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import type { SessionInfo } from "@/lib/types";
import { formatRelativeTime, shortenCwd, type SessionTreeNode } from "./utils";

export function ArchivedSessionRow({
	session,
	homeDir,
	onRestore,
	onRemoved,
}: {
	session: SessionInfo;
	homeDir?: string;
	onRestore: (s: SessionInfo) => void;
	onRemoved: (s: SessionInfo) => void;
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
		onRemoved(session);
	};

	return (
		<div
			onClick={confirming || deleting ? undefined : () => onRestore(session)}
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

export function SessionTreeItem({
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
export function SessionStatusDot({ status }: { status: NonNullable<SessionInfo["status"]> }) {
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

export function SessionItem({
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


"use client";

import type { SessionInfo } from "@/lib/types";
import { SessionTreeItem } from "./rows";
import { shortenCwd, type SessionTreeNode } from "./utils";

export function ProjectList({
  loading,
  error,
  projectList,
  explorerOpen,
  activeProjectCwd,
  explorerFraction,
  collapsedCwds,
  onToggleCollapse,
  dragCwd,
  onDragCwd,
  dropTargetCwd,
  onDropTargetCwd,
  hoverProjectCwd,
  onHoverProjectCwd,
  moveProject,
  onSelectCwd,
  onNewSession,
  onSelectSession,
  selectedSessionId,
  runningSessionId,
  pendingSessionIds,
  seenAt,
  onReload,
  onTrash,
  onConfirmHide,
  onRememberCwd,
  hiddenCwds,
  homeDir,
  onSessionDeleted,
}: {
  loading: boolean;
  error: string | null;
  projectList: { cwd: string; tree: SessionTreeNode[] }[];
  explorerOpen: boolean;
  activeProjectCwd: string | null;
  explorerFraction: number;
  collapsedCwds: Record<string, boolean>;
  onToggleCollapse: (cwd: string) => void;
  dragCwd: string | null;
  onDragCwd: (cwd: string | null) => void;
  dropTargetCwd: string | null;
  onDropTargetCwd: (cwd: string | null) => void;
  hoverProjectCwd: string | null;
  onHoverProjectCwd: (cwd: string | null) => void;
  moveProject: (from: string, before: string) => void;
  onSelectCwd: (cwd: string) => void;
  onNewSession: (cwd: string) => void;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  selectedSessionId: string | null;
  runningSessionId?: string | null;
  pendingSessionIds?: ReadonlySet<string>;
  seenAt: Record<string, string>;
  onReload: (showLoading?: boolean) => Promise<void>;
  onTrash: (id: string) => void;
  onConfirmHide: (cwd: string | null) => void;
  onRememberCwd: (cwd: string) => void;
  hiddenCwds: Record<string, boolean>;
  homeDir: string;
  onSessionDeleted?: (sessionId: string, cwd: string) => void;
}) {
  return (
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
								onDragCwd(cwd);
							}}
							onDragOver={(e) => {
								e.preventDefault();
								e.dataTransfer.dropEffect = "move";
								if (dragCwd && dragCwd !== cwd) onDropTargetCwd(cwd);
							}}
							onDragLeave={(e) => {
								if (e.currentTarget.contains(e.relatedTarget as Node)) return;
								if (dragCwd && dropTargetCwd === cwd) onDropTargetCwd(null);
							}}
							onDrop={(e) => {
								e.preventDefault();
								const from = e.dataTransfer.getData("text/plain");
								if (from) moveProject(from, cwd);
							}}
							onDragEnd={() => {
								onDragCwd(null);
								onDropTargetCwd(null);
							}}
						>
							{/* CWD Folder Group Header */}
							<div
								onClick={() => {
									onSelectCwd(cwd);
									onToggleCollapse(cwd);
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
									onHoverProjectCwd(cwd);
									if (!isActiveProject)
										e.currentTarget.style.background = "var(--bg-hover)";
								}}
								onMouseLeave={(e) => {
									onHoverProjectCwd(null);
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
											onNewSession(cwd);
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
											onConfirmHide(cwd);
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
												onSelectSession={onSelectSession}
												runningSessionId={runningSessionId}
												pendingSessionIds={pendingSessionIds}
												seenAt={seenAt}
												onRenamed={onReload}
												onSessionDeleted={(id, cwd) => {
													onSessionDeleted?.(id, cwd);
													onTrash(id);
													onReload().then(() => {
														// 删除会话后，如果该项目的最后一个会话也被删了，
														// 仍应保留项目在工作区列表中，而不是随会话一起消失。
														if (!hiddenCwds[cwd]) onRememberCwd(cwd);
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
  );
}

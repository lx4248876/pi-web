"use client";

import { ArchivedSessionRow } from "./rows";
import type { SessionInfo } from "@/lib/types";

export function ArchivedDialog({
  open,
  sessions,
  hiddenCwds,
  trashedIds,
  homeDir,
  onClose,
  onRestore,
  onRemove,
}: {
  open: boolean;
  sessions: SessionInfo[];
  hiddenCwds: Record<string, boolean>;
  trashedIds: Set<string>;
  homeDir: string;
  onClose: () => void;
  onRestore: (s: SessionInfo) => void;
  onRemove: (s: SessionInfo) => void;
}) {
  if (!open) return null;
  return (
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
					onClick={() => onClose()}
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
								onClick={() => onClose()}
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
								const archived = sessions
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
										onRestore={onRestore}
										onRemoved={onRemove}
									/>
								))
								}
								)
								()
								}
						</div>
					</div>
				</div>
  );
}

// 归档列表里的单行:点击还原会话;右侧"彻底删除"会把 .jsonl 从磁盘永久移除(不可还原)。
// 之所以单独成组件:每行需要自己的确认态(confirming/deleting),缩在 IIFE 里不便维护。

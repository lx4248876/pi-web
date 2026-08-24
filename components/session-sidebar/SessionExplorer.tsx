"use client";

import { FileExplorer } from "@/components/FileExplorer";

export function SessionExplorer({
	explorerOpen,
	onToggleOpen,
	explorerFraction,
	cwd,
	onOpenFile,
	onAtMention,
	refreshKey,
	refreshDone,
	onRefresh,
	draggingRef,
}: {
	explorerOpen: boolean;
	onToggleOpen: () => void;
	explorerFraction: number;
	cwd: string | null;
	onOpenFile: (filePath: string, fileName: string) => void;
	onAtMention?: (relativePath: string) => void;
	refreshKey: number;
	refreshDone: boolean;
	onRefresh: () => void;
	draggingRef: { current: boolean };
}) {
	return (
		<>
			{/* Drag handle between session list and explorer */}
			{cwd && explorerOpen && (
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
			{cwd && (
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
							onClick={() => onToggleOpen()}
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
								const targetCwd = cwd;
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
							onClick={onRefresh}
							title="Refresh explorer"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 26,
								height: 26,
								padding: 0,
								marginRight: 6,
								background: refreshDone ? "rgba(74,222,128,0.18)" : "none",
								border: "none",
								color: refreshDone ? "#4ade80" : "var(--text-dim)",
								cursor: "pointer",
								borderRadius: 5,
								flexShrink: 0,
								transition: "color 0.3s, background 0.3s",
							}}
							onMouseEnter={(e) => {
								if (refreshDone) return;
								e.currentTarget.style.color = "var(--text-muted)";
								e.currentTarget.style.background = "var(--bg-hover)";
							}}
							onMouseLeave={(e) => {
								if (refreshDone) return;
								e.currentTarget.style.color = "var(--text-dim)";
								e.currentTarget.style.background = "none";
							}}
						>
							{refreshDone ? (
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
								cwd={cwd}
								onOpenFile={onOpenFile}
								refreshKey={refreshKey}
								onAtMention={onAtMention}
							/>
						</div>
					)}
				</div>
			)}
		</>
	);
}

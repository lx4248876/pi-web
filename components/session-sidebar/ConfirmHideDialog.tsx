"use client";

export function ConfirmHideDialog({
  cwd,
  onClose,
  onConfirm,
}: {
  cwd: string | null;
  onClose: () => void;
  onConfirm: (cwd: string) => void;
}) {
  if (!cwd) return null;
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
							“{cwd}” will be removed from the workspace.
							Existing sessions are preserved and you can re-add the project later.
						</div>
						<div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
							<button
								autoFocus
								onClick={() => onClose()}
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
									onClose();
									if (cwd) onConfirm(cwd);
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
	);
}

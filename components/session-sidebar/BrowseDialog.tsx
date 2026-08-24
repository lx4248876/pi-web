"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectCwdWithValidation } from "@/lib/cwd-selection";
import type { BrowseDirEntry, BrowseDirResponse } from "@/lib/cwd-selection";
import { getParentPath, shortenCwd } from "./utils";

export function BrowseDialog({
  open,
  initialPath,
  recentCwds,
  homeDir,
  onClose,
  onCommit,
}: {
  open: boolean;
  initialPath: string | null;
  recentCwds: { cwd: string }[];
  homeDir: string;
  onClose: () => void;
  onCommit: (cwd: string) => Promise<void>;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<BrowseDirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInputVal, setPathInputVal] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadEntries = useCallback(async (target?: string | null) => {
    try {
      setLoading(true);
      setError(null);
      const query = target ? `?path=${encodeURIComponent(target)}` : "";
      const res = await fetch(`/api/browse-dirs${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as BrowseDirResponse;
      const resolvedPath = data.path ?? target ?? null;
      setPath(resolvedPath);
      setPathInputVal(resolvedPath ?? "");
      setSearch("");
      setIsEditingPath(false);
      setEntries(data.entries ?? []);
      if (data.valid === false && data.error) {
        setError(data.error);
      }
    } catch (e) {
      setError(String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadEntries(initialPath);
  }, [open, initialPath, loadEntries]);

  const commitCwd = useCallback(
    async (candidatePath: string) => {
      const result = await selectCwdWithValidation(candidatePath, async (p) => {
        const res = await fetch(`/api/browse-dirs?path=${encodeURIComponent(p)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as BrowseDirResponse;
      });

      if (!result.ok) {
        setError(result.error);
        if (result.fallbackPath && result.fallbackPath !== path) {
          await loadEntries(result.fallbackPath);
        }
        return false;
      }

      setError(null);
      await onCommit(result.cwd);
      return true;
    },
    [path, loadEntries, onCommit],
  );

  const parentPath = path ? getParentPath(path) : null;

  const breadcrumbs = useMemo(() => {
    if (!path) return [];
    const isWin = path.includes("\\") || /^[a-zA-Z]:/.test(path);
    const parts = path.split(/[\\/]+/).filter(Boolean);
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
      if (path.startsWith("/")) {
        crumbs.push({ name: "root", path: "/" });
      }
      for (let i = 0; i < parts.length; i++) {
        current += (current.endsWith("/") || current === "" ? "" : "/") + parts[i];
        const absPath = path.startsWith("/") ? "/" + current : current;
        crumbs.push({ name: parts[i], path: absPath });
      }
    }
    return crumbs;
  }, [path]);

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter((entry) => entry.name.toLowerCase().includes(q));
  }, [entries, search]);

  if (!open) return null;
  return (
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
										onClose();
										setError(null);
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
										if (parentPath && !loading)
											loadEntries(parentPath).catch(() => {});
									}}
									disabled={!parentPath || loading}
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
											parentPath && !loading
												? "pointer"
												: "not-allowed",
										opacity: parentPath ? 1 : 0.4,
									}}
									title={
										parentPath
											? `Up to ${parentPath}`
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
								{isEditingPath ? (
									<input
										type="text"
										value={pathInputVal}
										onChange={(e) => setPathInputVal(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												loadEntries(pathInputVal).catch((err) =>
													setError(String(err)),
												);
											} else if (e.key === "Escape") {
												setIsEditingPath(false);
												setPathInputVal(path ?? "");
											}
										}}
										onBlur={() => {
											setTimeout(() => {
												setIsEditingPath(false);
												setPathInputVal(path ?? "");
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
										onDoubleClick={() => setIsEditingPath(true)}
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
											{breadcrumbs.map(
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
																loadEntries(crumb.path).catch(() => {});
															}}
															style={{
																background: "none",
																border: "none",
																padding: "2px 5px",
																borderRadius: 4,
																fontSize: 12,
																fontFamily: "var(--font-mono)",
																color:
																	idx === breadcrumbs.length - 1
																		? "var(--text)"
																		: "var(--accent)",
																cursor: "pointer",
																fontWeight:
																	idx === breadcrumbs.length - 1
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
												setIsEditingPath(true);
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
										{recentCwds.length === 0 ? (
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
											recentCwds.slice(0, 12).map(({ cwd }) => {
												const short = shortenCwd(cwd, homeDir);
												return (
													<button
														key={cwd}
														onClick={() =>
															loadEntries(cwd).catch(() => {})
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
									{error && (
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
											{error}
										</div>
									)}

									{/* Search filter */}
									<div style={{ padding: "8px 12px", flexShrink: 0 }}>
										<input
											type="text"
											placeholder="Filter directories..."
											value={search}
											onChange={(e) => setSearch(e.target.value)}
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
										{loading ? (
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
										) : filteredEntries.length === 0 ? (
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
											filteredEntries.map((entry) => (
												<button
													key={entry.path}
													onClick={() =>
														loadEntries(entry.path).catch(() => {})
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
										if (!path || loading) return;
										commitCwd(path).catch((e) =>
											setError(String(e)),
										);
									}}
									disabled={!path || loading}
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
											!path || loading ? "not-allowed" : "pointer",
										opacity: !path || loading ? 0.6 : 1,
										transition: "opacity 0.15s",
									}}
								>
									Add Project
								</button>
								<button
									onClick={() => {
										onClose();
										setError(null);
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
				

  );
}

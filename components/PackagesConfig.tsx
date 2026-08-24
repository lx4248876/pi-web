"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { PiPackage } from "@/lib/pi-packages";
import { useModalRect } from "./app-shell/useModalRect";

import { PackageDetail, fmtMatches } from "./packages-config/PackageDetail";

export function PackagesConfig({
  onClose,
  onInstalled,
}: {
  onClose: () => void;
  onInstalled?: () => void;
}) {
  const [packages, setPackages] = useState<PiPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  const [uninstallErrors, setUninstallErrors] = useState<Record<string, string>>({});
  const [installedPkgs, setInstalledPkgs] = useState<Set<string>>(new Set());
  const [installedDetails, setInstalledDetails] = useState<Map<string, PiPackage>>(new Map());
  const [scope, setScope] = useState<"global" | "project">("global");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [tab, setTab] = useState<"market" | "installed">("market");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const load = useCallback(async (name?: string, type?: string, pageN?: number) => {
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    if (!pageN || pageN === 1) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (name) params.set("name", name);
      if (type) params.set("type", type);
      if (pageN && pageN > 1) params.set("page", String(pageN));
      const qs = params.toString();
      const res = await fetch(`/api/packages${qs ? `?${qs}` : ""}`, { signal: ctrl.signal });
      const d = (await res.json()) as { packages?: PiPackage[]; error?: string; totalPages?: number | null };
      if (d.error) {
        setError(d.error);
        return;
      }
      const list = d.packages ?? [];
      setTotalPages(d.totalPages ?? null);
      if (pageN && pageN > 1) {
        // append for "load more"
        setPackages((prev) => {
          const seen = new Set(prev.map((p) => p.name));
          return [...prev, ...list.filter((p) => !seen.has(p.name))];
        });
        setPage(pageN);
      } else {
        setPackages(list);
        setPage(1);
        if (list.length > 0) setSelected(list[0].name);
        else setSelected(null);
      }
      // hasMore when the queried page is still below the last available page
      const tp = d.totalPages ?? null;
      setHasMore(tp !== null && (pageN ?? 1) < tp);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(String(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    load(query.trim() || undefined, typeFilter || undefined, page + 1);
  }, [hasMore, loadingMore, load, query, typeFilter, page]);

  // Initial load: browse mode (default page)
  useEffect(() => {
    load();
  }, [load]);

  // Debounced search resets pagination
  useEffect(() => {
    const t = setTimeout(() => {
      const q = query.trim();
      load(q || undefined, typeFilter || undefined, 1);
    }, 350);
    return () => clearTimeout(t);
  }, [query, typeFilter, load]);

  // Load installed packages from the local machine (cross-session accurate).
  const loadInstalled = useCallback(async () => {
    try {
      const res = await fetch("/api/packages/list-installed", { cache: "no-store" });
      const d = (await res.json()) as {
        packages?: { name?: string; source: string }[];
        error?: string;
      };
      if (d.error || !d.packages) return;
      setInstalledPkgs(new Set(d.packages.map((p) => p.name).filter((n): n is string => !!n)));
    } catch {
      // ignore — installed markers just won't show
    }
  }, []);

  useEffect(() => {
    loadInstalled();
  }, [loadInstalled]);

  const install = useCallback(
    async (pkg: PiPackage) => {
      setInstalling(pkg.name);
      setInstallErrors((prev) => ({ ...prev, [pkg.name]: "" }));
      try {
        const res = await fetch("/api/packages/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: pkg.name, scope }),
        });
        const d = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || d.error) {
          setInstallErrors((prev) => ({ ...prev, [pkg.name]: d.error ?? `HTTP ${res.status}` }));
          return;
        }
        setInstalledPkgs((prev) => {
          const n = new Set(prev);
          n.add(pkg.name);
          return n;
        });
        setInstalledDetails((prev) => new Map(prev).set(pkg.name, pkg));
        onInstalled?.();
      } catch (e) {
        setInstallErrors((prev) => ({ ...prev, [pkg.name]: String(e) }));
      } finally {
        setInstalling(null);
      }
    },
    [scope, onInstalled],
  );

  const uninstall = useCallback(async (pkg: PiPackage) => {
    setUninstalling(pkg.name);
    setUninstallErrors((prev) => ({ ...prev, [pkg.name]: "" }));
    try {
      const res = await fetch("/api/packages/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: pkg.name, scope }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setUninstallErrors((prev) => ({ ...prev, [pkg.name]: d.error ?? `HTTP ${res.status}` }));
        return;
      }
      setInstalledPkgs((prev) => {
        const n = new Set(prev);
        n.delete(pkg.name);
        return n;
      });
      setInstalledDetails((prev) => {
        const n = new Map(prev);
        n.delete(pkg.name);
        return n;
      });
      onInstalled?.();
    } catch (e) {
      setUninstallErrors((prev) => ({ ...prev, [pkg.name]: String(e) }));
    } finally {
      setUninstalling(null);
    }
  }, [scope, onInstalled]);

  const selectedPkg = packages.find((p) => p.name === selected) ?? null;

  const {
    clampedRect: modalRect,
    handleBarPointerDown,
    handleResizePointerDown,
    onPointerMove: onModalPointerMove,
    onPointerUp: onModalPointerUp,
  } = useModalRect({
    storageKey: "pi-web:packages-modal-rect",
    defaultWidth: 920,
    defaultHeight: 640,
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          position: "absolute",
          left: modalRect.x,
          top: modalRect.y,
          width: modalRect.width,
          height: modalRect.height,
          maxWidth: "calc(100vw - 2px)",
          maxHeight: "calc(100vh - 2px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {/* Header (draggable) */}
        <div
          onPointerDown={handleBarPointerDown}
          onPointerMove={onModalPointerMove}
          onPointerUp={onModalPointerUp}
          title="Drag to move"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            cursor: "move",
            userSelect: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              插件市场
            </span>
            <a
              href="https://pi.dev/packages"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: "var(--text-dim)", textDecoration: "none" }}
            >
              pi.dev ↗
            </a>
          </div>

          {/* Search + filter */}
          <div style={{ display: "flex", gap: 8, flex: 1, justifyContent: "flex-end" }}>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{
                padding: "5px 8px",
                fontSize: 12,
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                outline: "none",
              }}
            >
              <option value="">全部类型</option>
              {["extension", "skill", "theme", "prompt"].map((t) => (
                <option key={t} value={t}>
                  {t === "extension" ? "扩展" : t === "skill" ? "技能" : t === "theme" ? "主题" : "提示词"}
                </option>
              ))}
            </select>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索插件…"
              style={{
                width: 240,
                padding: "5px 10px",
                fontSize: 13,
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                outline: "none",
              }}
            />
          </div>

          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", gap: 0, flex: 1, overflow: "hidden" }}>
          {/* Left: list */}
          <div
            style={{
              width: 280,
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              background: "var(--bg-panel)",
            }}
          >
            {/* Tabs: 市场 / 已安装 */}
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              {([
                { key: "market", label: "市场", icon: "▦" },
                { key: "installed", label: `已安装` },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setTab(t.key);
                  }}
                  style={{
                    flex: 1,
                    padding: "9px 0",
                    fontSize: 12,
                    fontWeight: tab === t.key ? 600 : 400,
                    border: "none",
                    background: tab === t.key ? "var(--bg-selected)" : "none",
                    color: tab === t.key ? "var(--text)" : "var(--text-dim)",
                    cursor: "pointer",
                    borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* Scope toggle */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  borderRadius: 5,
                  border: "1px solid var(--border)",
                  overflow: "hidden",
                  fontSize: 11,
                }}
              >
                {([{ key: "global", label: "全局" }, { key: "project", label: "项目" }] as const).map((s, i) => (
                  <button
                    key={s.key}
                    onClick={() => setScope(s.key)}
                    style={{
                      padding: "3px 10px",
                      border: "none",
                      cursor: "pointer",
                      background: scope === s.key ? "var(--bg-selected)" : "none",
                      color: scope === s.key ? "var(--text)" : "var(--text-dim)",
                      fontWeight: scope === s.key ? 600 : 400,
                      borderRight: i === 0 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                {loading ? "…" : tab === "market" ? `${packages.length} 个` : `${installedPkgs.size} 个`}
              </span>
            </div>

            {/* Scrollable list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
              {loading && tab === "market" ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>加载中…</div>
              ) : error && tab === "market" ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "#f87171", wordBreak: "break-word" }}>{error}</div>
              ) : tab === "installed" ? (
                installedPkgs.size === 0 ? (
                  <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--text-dim)" }}>尚未安装任何插件</div>
                ) : (
                  Array.from(installedPkgs).map((name) => {
                    const pkg = installedDetails.get(name);
                    const isSelected = selected === name && tab === "installed";
                    return (
                      <div
                        key={name}
                        onClick={() => setSelected(name)}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                          padding: "8px 8px",
                          borderRadius: 5,
                          cursor: "pointer",
                          background: isSelected ? "var(--bg-selected)" : "none",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) e.currentTarget.style.background = "none";
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "#16a34a" }}>✓</span>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: isSelected ? 600 : 400,
                              color: "var(--text)",
                              fontFamily: "var(--font-mono)",
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {name}
                          </span>
                        </div>
                        {pkg?.types?.length ? (
                          <div style={{ display: "flex", gap: 6, paddingLeft: 12 }}>
                            {pkg.types.slice(0, 2).map((t) => (
                              <span key={t} style={{ fontSize: 9, color: "var(--text-dim)" }}>{t}</span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )
              ) : packages.length === 0 ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--text-dim)" }}>未找到插件</div>
              ) : (
                packages.map((pkg) => {
                  const isSelected = selected === pkg.name;
                  return (
                    <div
                      key={pkg.name}
                      onClick={() => setSelected(pkg.name)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        padding: "8px 8px",
                        borderRadius: 5,
                        cursor: "pointer",
                        background: isSelected ? "var(--bg-selected)" : "none",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "none";
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {installedPkgs.has(pkg.name) && (
                          <span style={{ fontSize: 10, color: "#16a34a" }}>✓</span>
                        )}
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: isSelected ? 600 : 400,
                            color: "var(--text)",
                            fontFamily: "var(--font-mono)",
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {pkg.name}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 12 }}>
                        {pkg.types.length > 0 ? (
                          pkg.types.slice(0, 2).map((t) => (
                            <span key={t} style={{ fontSize: 9, color: "var(--text-dim)" }}>{t}</span>
                          ))
                        ) : (
                          <span style={{ fontSize: 9, color: "var(--text-dim)" }}>package</span>
                        )}
                        {pkg.downloads > 0 && (
                          <span style={{ fontSize: 9, color: "var(--text-dim)" }}>{fmtMatches(pkg.downloads)}/mo</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {/* Load more (market tab only) */}
              {tab === "market" && hasMore && !loading && (
                <div style={{ padding: "10px 0 4px", textAlign: "center" }}>
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    style={{
                      padding: "6px 20px",
                      fontSize: 12,
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "none",
                      color: "var(--text-muted)",
                      cursor: loadingMore ? "wait" : "pointer",
                      opacity: loadingMore ? 0.6 : 1,
                    }}
                  >
                    {loadingMore ? "加载中…" : `加载更多（第 ${page + 1} 页 / 共 ${totalPages} 页）`}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {(() => {
              if (tab === "installed") {
                if (!selected || !installedPkgs.has(selected)) {
                  return (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-dim)",
                        fontSize: 13,
                      }}
                    >
                      {installedPkgs.size === 0 ? "尚未安装任何插件" : "选择要管理的插件"}
                    </div>
                  );
                }
                const pkg =
                  installedDetails.get(selected) ??
                  // Pre-existing installs (from `pi list`) may lack marketplace
                  // detail — synthesize a minimal card so the detail pane works.
                  ({ name: selected, description: "", types: [], downloads: 0, date: 0, sortName: selected, searchText: "", install: selected.includes(":") ? selected : `npm:${selected}` } as PiPackage);
                return (
                  <PackageDetail
                    pkg={pkg}
                    onInstall={() => {}}
                    installing={false}
                    installed
                    installError={null}
                    onUninstall={() => uninstall(pkg)}
                    uninstalling={uninstalling === selected}
                    uninstallError={
                      uninstallErrors[selected]?.trim() ? uninstallErrors[selected] : null
                    }
                    scope={scope}
                  />
                );
              }

              if (loading || error || !selectedPkg) {
                return (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-dim)",
                      fontSize: 13,
                    }}
                  >
                    选择插件
                  </div>
                );
              }

              return (
                <PackageDetail
                  key={selectedPkg.name}
                  pkg={selectedPkg}
                  onInstall={() => install(selectedPkg)}
                  installing={installing === selectedPkg.name}
                  installed={installedPkgs.has(selectedPkg.name)}
                  installError={
                    installErrors[selectedPkg.name]?.trim() ? installErrors[selectedPkg.name] : null
                  }
                  onUninstall={() => uninstall(selectedPkg)}
                  uninstalling={uninstalling === selectedPkg.name}
                  uninstallError={
                    uninstallErrors[selectedPkg.name]?.trim() ? uninstallErrors[selectedPkg.name] : null
                  }
                  scope={scope}
                />
              );
            })()}
          </div>
        </div>

        {/* Resize handle — bottom-right */}
        <div
          onPointerDown={(e) => { e.stopPropagation(); handleResizePointerDown(e); }}
          onPointerMove={onModalPointerMove}
          onPointerUp={onModalPointerUp}
          title="Drag to resize"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 18,
            height: 18,
            cursor: "nwse-resize",
            background: "linear-gradient(135deg, transparent 50%, var(--text-dim) 50%, var(--text-dim) 60%, transparent 60%)",
            opacity: 0.5,
            borderBottomRightRadius: 9,
            zIndex: 2,
          }}
        />
      </div>
    </div>
  );
}

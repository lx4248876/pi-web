"use client";

import { useCallback, useEffect, useState } from "react";
import type { PiPackage } from "@/lib/pi-packages";

export function fmtMatches(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function fmtDate(epoch: number): string {
  if (!epoch) return "";
  const now = Date.now();
  const days = Math.floor((now - epoch) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function TypeTag({ type }: { type: string }) {
  const color =
    type === "extension"
      ? { bg: "rgba(99,102,241,0.12)", fg: "rgba(99,102,241,0.85)", label: "extension" }
      : type === "skill"
        ? { bg: "rgba(34,197,94,0.12)", fg: "rgba(34,197,94,0.85)", label: "skill" }
        : type === "theme"
          ? { bg: "rgba(251,191,36,0.12)", fg: "rgba(251,191,36,0.85)", label: "theme" }
          : type === "prompt"
            ? { bg: "rgba(236,72,153,0.12)", fg: "rgba(236,72,153,0.85)", label: "prompt" }
            : { bg: "rgba(120,120,120,0.12)", fg: "var(--text-dim)", label: type || "package" };
  return (
    <span
      style={{
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 3,
        flexShrink: 0,
        background: color.bg,
        color: color.fg,
        whiteSpace: "nowrap",
      }}
    >
      {color.label}
    </span>
  );
}

export function PackageDetail({
  pkg,
  onInstall,
  installing,
  installed,
  installError,
  onUninstall,
  uninstalling,
  uninstallError,
  scope,
}: {
  pkg: PiPackage;
  onInstall: () => void;
  installing: boolean;
  installed: boolean;
  installError: string | null;
  onUninstall: () => void;
  uninstalling: boolean;
  uninstallError: string | null;
  scope: "global" | "project";
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [zhDescription, setZhDescription] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [translated, setTranslated] = useState(false);

  // Auto-reveal a previously cached translation the moment this package's
  // detail opens — zero extra tokens.
  useEffect(() => {
    let cancelled = false;
    setTranslated(false);
    setZhDescription(null);
    setExpanded(false);
    setTranslateError(null);
    if (!pkg.name) return;
    fetch(`/api/packages/translate-desc?name=${encodeURIComponent(pkg.name)}`)
      .then((r) => r.json())
      .then((d: { zh?: string | null }) => {
        if (cancelled) return;
        if (d.zh) {
          setZhDescription(d.zh);
          setExpanded(false);
          setTranslated(true);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pkg.name]);

  const translate = useCallback(async () => {
    if (translating) return;
    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch("/api/packages/translate-desc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pkg.name, description: pkg.description }),
      });
      const d = (await res.json()) as { zh?: string; error?: string };
      if (!res.ok || d.error) {
        setTranslateError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setZhDescription(d.zh ?? "");
      setExpanded(false);
      setTranslated(true);
    } catch (e) {
      setTranslateError(String(e));
    } finally {
      setTranslating(false);
    }
  }, [translating, pkg.name, pkg.description]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Name + tags + install button */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "column" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
          {pkg.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {pkg.types.map((t) => <TypeTag key={t} type={t} />)}
          {pkg.downloads > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{fmtMatches(pkg.downloads)}/mo</span>
          )}
          {pkg.date > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{fmtDate(pkg.date)}</span>
          )}
        </div>
      </div>

      {/* 描述 */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>描述</span>
          {!zhDescription && (
            <button
              onClick={translate}
              disabled={translating}
              style={{
                fontSize: 11,
                padding: "1px 8px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "none",
                color: translating ? "var(--text-dim)" : "var(--accent)",
                cursor: translating ? "wait" : "pointer",
                opacity: translating ? 0.6 : 1,
              }}
            >
              {translating ? "翻译中…" : "翻译成中文"}
            </button>
          )}
        </div>
        {/* 英文短描述（始终可见，简洁） */}
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, marginTop: 5, marginBottom: 0 }}>
          {pkg.description || "无描述"}
        </p>
        {/* 中文全量翻译（有缓存/已翻译时直接显示，可折叠） */}
        {zhDescription && (
          <div style={{ marginTop: 8, background: "rgba(107,159,242,0.08)", border: "1px solid rgba(107,159,242,0.18)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", flexShrink: 0 }}>
                {translated ? "中文说明" : "中文翻译"}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {zhDescription.length} 字{translated ? " · 已缓存" : ""}
              </span>
              <button
                onClick={() => setExpanded((v) => !v)}
                style={{ fontSize: 11, padding: "1px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "none", color: "var(--text-muted)", cursor: "pointer" }}
              >
                {expanded ? "收起" : "展开"}
              </button>
            </div>
            <div style={{ padding: "0 10px 8px" }}>
              {expanded ? (
                <pre
                  style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}
                >
                  {zhDescription}
                </pre>
              ) : (
                <p style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>
                  {zhDescription.length > 300 ? zhDescription.slice(0, 300) + "…" : zhDescription}
                </p>
              )}
            </div>
          </div>
        )}
        {translateError && (
          <div style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>{translateError}</div>
        )}
      </div>

      {/* 安装命令 */}
      <div>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>安装命令</span>
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
          <code
            style={{
              flex: 1,
              fontSize: 12,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "7px 10px",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            $ pi install {pkg.install}
          </code>
          {installed ? (
            confirmRemove ? (
              <>
                <button
                  onClick={onUninstall}
                  disabled={uninstalling}
                  style={{
                    flexShrink: 0,
                    padding: "7px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: "none",
                    cursor: uninstalling ? "not-allowed" : "pointer",
                    background: "#dc2626",
                    color: "#fff",
                    opacity: uninstalling ? 0.7 : 1,
                  }}
                >
                  {uninstalling ? "卸载中…" : "确认卸载"}
                </button>
                <button
                  onClick={() => setConfirmRemove(false)}
                  disabled={uninstalling}
                  style={{
                    flexShrink: 0,
                    padding: "7px 12px",
                    fontSize: 13,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "none",
                    color: "var(--text-muted)",
                    cursor: uninstalling ? "not-allowed" : "pointer",
                  }}
                >
                  取消
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmRemove(true)}
                style={{
                  flexShrink: 0,
                  padding: "7px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "rgba(220,38,38,0.08)",
                  color: "#f87171",
                  cursor: "pointer",
                }}
              >
                卸载
              </button>
            )
          ) : (
            <button
              onClick={onInstall}
              disabled={installing}
              style={{
                flexShrink: 0,
                padding: "7px 16px",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 6,
                border: "none",
                cursor: installing ? "not-allowed" : "pointer",
                background: "var(--accent)",
                color: "#fff",
                opacity: installing ? 0.8 : 1,
              }}
            >
              {installing ? "安装中…" : "安装"}
            </button>
          )}
        </div>
        <div style={{ marginTop: 5, fontSize: 11, color: "var(--text-dim)" }}>
          {scope === "global" ? "→ 全局（~/.pi/agent，所有项目可用）" : "→ 项目级（当前目录 .pi）"}
        </div>
      </div>

      {installError && (
        <div style={{ fontSize: 12, color: "#f87171", wordBreak: "break-word", maxHeight: 120, overflowY: "auto", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 6, padding: "8px 10px", whiteSpace: "pre-wrap" }}>
          {installError}
        </div>
      )}

      {uninstallError && (
        <div style={{ fontSize: 12, color: "#f87171", wordBreak: "break-word", maxHeight: 120, overflowY: "auto", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 6, padding: "8px 10px" }}>
          {uninstallError}
        </div>
      )}

      {/* Links */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingTop: 4 }}>
        {pkg.npmUrl && (
          <a href={pkg.npmUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
            npm ↗
          </a>
        )}
        {pkg.repoUrl && (
          <a href={pkg.repoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
            GitHub ↗
          </a>
        )}
        <a
          href={`https://pi.dev/packages/${encodeURIComponent(pkg.name)}`}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: "var(--text-dim)", textDecoration: "none" }}
        >
          pi.dev ↗
        </a>
      </div>
    </div>
  );
}
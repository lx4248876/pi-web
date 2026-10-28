"use client";

import { useState } from "react";
import type { PiPackage } from "@/lib/pi-packages";
import { copyText } from "@/lib/clipboard";

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

/**
 * 插件详情（**只读**）。
 *
 * pi-web 只做「看有什么、装了什么」，安装/卸载一律交给终端（`pi install` /
 * `pi remove`）。原因：装包要在 pi 进程外生效、并需要重启会话，Web 侧假装能管
 * 只会出现「装完没生效」。这里给出可复制的命令，比一个假按钮诚实。
 */
export function PackageDetail({
  pkg,
  installed,
  scope,
}: {
  pkg: PiPackage;
  installed: boolean;
  scope: "global" | "project";
}) {
  const [copied, setCopied] = useState(false);

  const command = `pi install ${pkg.install}${scope === "project" ? " -l" : ""}`;

  const copy = async () => {
    try {
      await copyText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时用户仍可手动选中复制
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
            {pkg.name}
          </span>
          {installed && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(34,197,94,0.12)", color: "rgba(34,197,94,0.85)", whiteSpace: "nowrap" }}>
              已安装
            </span>
          )}
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

      <div>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>描述</span>
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, marginTop: 5, marginBottom: 0 }}>
          {pkg.description || "无描述"}
        </p>
      </div>

      <div>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
          {installed ? "已安装" : "在终端执行"}
        </span>
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
            $ {command}
          </code>
          <button
            onClick={copy}
            style={{
              flexShrink: 0,
              padding: "7px 12px",
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "none",
              color: copied ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {copied ? "已复制" : "复制"}
          </button>
        </div>
        <div style={{ marginTop: 5, fontSize: 11, color: "var(--text-dim)" }}>
          {scope === "global" ? "→ 全局（~/.pi/agent，所有项目可用）" : "→ 项目级（当前目录 .pi）"}
          {installed ? "　卸载：pi remove <包名>" : "　装完请重启 pi-web 会话以加载新扩展"}
        </div>
      </div>

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
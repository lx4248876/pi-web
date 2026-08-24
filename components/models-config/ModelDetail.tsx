"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Field, NumInput, SectionTitle, Select, TextInput } from "./form";
import { API_OPTIONS, type ModelEntry, type ModelTestState, type ProviderEntry } from "./types";


const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

// 部分转发网关（如 dgrid）不识别 OpenAI 的 developer role（会 500 get_channel_failed），
// 显式设 supportsDeveloperRole:false 让 pi-ai 走标准 system role。
function usesStandardSystemRole(model: ModelEntry): boolean {
  return model.compat?.supportsDeveloperRole === false;
}

function setSystemRoleCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), supportsDeveloperRole: false } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.supportsDeveloperRole;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

export function ModelDetail({
  providerName,
  provider,
  model,
  onChange,
  onDelete,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
}) {
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  // 生效的 API 类型 = 模型级 override ?? 供应商级 ?? SDK 默认。
  // DeepSeek compat(thinkingFormat) 只在 openai-completions 实现里被读取，
  // 其它 API(如 openai-responses) 走各自的 reasoning 字段，勾了也不生效 ——
  // 这里按它做联动，避免出现“选了 response 却困惑为什么不勾选”的情况。
  const effectiveApi = model.api ?? provider.api ?? "openai-completions";
  const costVal = (k: keyof NonNullable<ModelEntry["cost"]>) => model.cost?.[k] !== undefined ? String(model.cost[k]) : "";
  const setCost = (k: keyof NonNullable<ModelEntry["cost"]>, v: string) => {
    const n = parseFloat(v);
    onChange({ ...model, cost: { ...(model.cost ?? {}), [k]: isNaN(n) ? undefined : n } });
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
    if (testState.phase === "testing") return "Testing model connection...";
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
      return ["Connected", ...meta, testState.responseText || null].filter(Boolean).join(" · ");
    }
    return ["Failed", ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
      });
      const d = await res.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok || !d.ok) {
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>Model</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {testSummary && (
            <span
              title={testSummary}
              style={{
                maxWidth: 260,
                height: 24,
                padding: "0 8px",
                border: `1px solid ${testState.phase === "error" ? "#fecaca" : testState.phase === "success" ? "#bbf7d0" : "var(--border)"}`,
                borderRadius: 4,
                background: testState.phase === "error" ? "#fee2e2" : testState.phase === "success" ? "#dcfce7" : "#e5e7eb",
                color: "#111827",
                fontSize: 11,
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                boxSizing: "border-box",
              }}
            >
              {testSummary}
            </span>
          )}
          <button
            onClick={handleTest}
            disabled={!model.id.trim() || testState.phase === "testing"}
            title="Test model connection"
            style={{
              height: 24,
              padding: "0 8px",
              background: testState.phase === "success" ? "#16a34a" : "none",
              border: `1px solid ${testState.phase === "success" ? "#16a34a" : "var(--border)"}`,
              borderRadius: 4,
              color: testState.phase === "success" ? "#fff" : (!model.id.trim() || testState.phase === "testing") ? "var(--text-dim)" : "var(--text-muted)",
              cursor: (!model.id.trim() || testState.phase === "testing") ? "not-allowed" : "pointer",
              fontSize: 11,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              gap: 5,
            }}
          >
            {testState.phase === "success" && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {testState.phase === "testing" ? "Testing…" : testState.phase === "success" ? "OK" : "Test"}
          </button>
          <button onClick={onDelete}
            style={{ height: 24, padding: "0 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 11, boxSizing: "border-box" }}>
            Remove
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="ID *"><TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono /></Field>
        <Field label="Name"><TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder="Display name" /></Field>
      </div>

      <Field label="API override">
        <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
      </Field>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Check label="Reasoning / thinking" checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
        <Check label="Image input" checked={model.input?.includes("image") ?? false}
          onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
      </div>

      {model.reasoning && (
        <>
          <Check
            label="DeepSeek thinking compat"
            checked={hasDeepseekCompat(model)}
            onChange={(v) => onChange(setDeepseekCompat(model, v))}
            disabled={effectiveApi !== "openai-completions"}
          />
          {effectiveApi !== "openai-completions" ? (
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              API 类型为 <code style={{ fontFamily: "var(--font-mono)" }}>{effectiveApi}</code> 时，SDK
              按该 API 的 reasoning 字段处理，不读取 DeepSeek 兼容配置
              {hasDeepseekCompat(model) ? "（当前已勾选但不会生效）" : ""}，故此处不可勾选。
            </p>
          ) : (
            hasDeepseekCompat(model) && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                DeepSeek 兼容用于解析供应商返回的推理内容（reasoning_content）；它与网关报错无关，去掉会导致推理过程无法在对话中渲染。
              </p>
            )
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
            <Check
              label="Use 'system' role (not 'developer')"
              checked={usesStandardSystemRole(model)}
              onChange={(v) => onChange(setSystemRoleCompat(model, v))}
            />
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              部分转发网关（如 dgrid）不识别 OpenAI 的 developer role，会返回{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>get_channel_failed</code>；勾选后改用标准 system role，此类渠道即可正常。
            </p>
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Context window (tokens)">
          <NumInput value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
            onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)} placeholder="128000" />
        </Field>
        <Field label="Max output tokens">
          <NumInput value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
            onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)} placeholder="16384" />
        </Field>
      </div>

      <Field label="自动压缩阈值 (tokens)">
        <NumInput value={model.autoCompactThreshold !== undefined ? String(model.autoCompactThreshold) : ""}
          onChange={(v) => set("autoCompactThreshold", v ? parseInt(v) : undefined)} placeholder="留空 = 不开启自动压缩" />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.5 }}>
          上下文超过该值时自动压缩历史（需模型已填 Context window）；留空则不开启自动压缩。
        </span>
      </Field>

      <div>
        <SectionTitle>Cost (per million tokens)</SectionTitle>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
            <Field key={k} label={k}>
              <NumInput value={costVal(k)} onChange={(v) => setCost(k, v)} placeholder="0" />
            </Field>
          ))}
        </div>
      </div>
    </div>
  );
}

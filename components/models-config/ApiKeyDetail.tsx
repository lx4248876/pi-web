"use client";

import { useCallback, useEffect, useState } from "react";
import { validateApiKeyValue } from "@/lib/api-key-guard";
import { Field, SecretTextInput, SectionTitle } from "./form";
import type { ApiKeyProvider } from "./types";


export function ApiKeyDetail({ provider, onRefresh }: { provider: ApiKeyProvider; onRefresh: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  // 替换已有 key 的二次确认：默认 false，点 Save 时若已配置则先进入确认态，须再点“确认替换”。
  const [confirmReplace, setConfirmReplace] = useState(false);

  // 内联防呆：非空输入时校验“看起来是否像 API key”，拦截中文/多段文本等脏值直接保存。
  const keyCheck = apiKey.trim() ? validateApiKeyValue(apiKey) : null;
  const keyInvalid =
    keyCheck !== null && !keyCheck.ok && keyCheck.code !== "EMPTY";
  const canSave = !!apiKey.trim() && !keyInvalid;

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setSavedOk(false);
    setConfirmReplace(false);
  }, [provider.id]);

  // 输入变化后复位二次确认，避免旧确认态残留。
  useEffect(() => {
    setConfirmReplace(false);
  }, [apiKey]);

  const doSave = useCallback(async (apiKeyValue: string) => {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyValue.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setApiKey("");
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
      onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
      setConfirmReplace(false);
    }
  }, [provider.id, onRefresh]);

  const handleSave = useCallback(async () => {
    const v = apiKey.trim();
    if (!v || !canSave) return;
    // 已配置过 key 时，替换前必须显式二次确认，防止输入框里的脏值静默覆盖正确 key。
    if (provider.configured && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    await doSave(v);
  }, [apiKey, canSave, confirmReplace, provider.configured, doSave]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `HTTP ${res.status}`);
      else onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>API Key</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.configured ? "#4ade80" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: provider.configured ? "#4ade80" : "var(--text-dim)" }}>
            {provider.configured ? "configured" : "not configured"}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {provider.configured
          ? `API key is stored. Enter a new key below to replace it, or disconnect to remove it.`
          : `Enter your ${provider.displayName} API key to enable ${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}.`}
      </p>

      <Field label="API Key">
        <div style={{ display: "flex", gap: 6 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) handleSave(); }}
            placeholder={provider.configured ? "Enter new key to replace…" : "sk-…"}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <button
            onClick={handleSave}
            disabled={saving || !canSave || savedOk}
            style={{
              padding: "6px 12px",
              background: savedOk ? "#16a34a" : canSave ? "var(--accent)" : "var(--bg-panel)",
              border: "none", borderRadius: 5,
              color: (canSave || savedOk) ? "#fff" : "var(--text-dim)",
              cursor: (saving || !canSave || savedOk) ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 600, flexShrink: 0,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            {savedOk && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {savedOk ? "Saved" : saving ? "Saving…" : "Save"}
          </button>
        </div>
      </Field>

      {keyInvalid && keyCheck && !keyCheck.ok && (
        <p style={{ margin: 0, fontSize: 12, color: "#fbbf24", lineHeight: 1.5 }}>
          ⚠️ {keyCheck.message}
        </p>
      )}

      {confirmReplace && provider.configured && canSave && !savedOk && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px", borderRadius: 5,
            border: "1px solid rgba(251,191,36,0.5)", background: "rgba(251,191,36,0.08)",
          }}
        >
          <span style={{ fontSize: 12, color: "#fbbf24", flex: 1 }}>
            要把当前已存的 API Key 替换成上面这串吗？
          </span>
          <button
            onClick={() => setConfirmReplace(false)}
            style={{ padding: "4px 10px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer", fontSize: 12 }}
          >Cancel</button>
          <button
            onClick={handleSave}
            style={{ padding: "4px 10px", background: "#d97706", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
          >确认替换</button>
        </div>
      )}

      {error && <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{error}</p>}

      {provider.configured && (
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start", padding: "5px 12px",
            background: "none", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 5, color: "#ef4444",
            cursor: removing ? "not-allowed" : "pointer", fontSize: 12,
          }}
        >
          {removing ? "Removing…" : "Disconnect"}
        </button>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { pickTestModelId } from "@/lib/models-config-test-connection";
import { Field, SectionTitle, SecretTextInput, Select, TextInput } from "./form";
import { API_OPTIONS, type ProviderEntry } from "./types";


export function ProviderDetail({ name, provider, onChange, onRename, onDelete }: {
  name: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onRename: (n: string) => void; onDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(name);
  const [testState, setTestState] = useState<{ phase: "idle" | "testing" | "success" | "error"; response?: string; error?: string }>({ phase: "idle" });
  useEffect(() => setEditingName(name), [name]);
  // Reset test state when provider changes
  useEffect(() => setTestState({ phase: "idle" }), [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>Provider</SectionTitle>
        <button onClick={onDelete}
          style={{ padding: "3px 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 11 }}>
          Delete
        </button>
      </div>

      <Field label="Provider name">
        <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
        {editingName !== name && editingName.trim() && (
          <button onClick={() => onRename(editingName.trim())}
            style={{ marginTop: 4, padding: "3px 10px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11, alignSelf: "flex-start" }}>
            Rename
          </button>
        )}
      </Field>

      <Field label="Base URL">
        <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="https://api.example.com/v1" mono />
      </Field>

      <Field label="API Key">
        <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
          placeholder="ENV_VAR_NAME, !shell-command, or literal key" mono />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          Prefix with <code style={{ fontFamily: "var(--font-mono)" }}>!</code> to run a shell command, or use an env var name
        </span>
      </Field>

      <Field label="API">
        <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
      </Field>

      {/* Test connection */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
        <SectionTitle>Test Connection</SectionTitle>
        <p style={{ margin: "4px 0 8px", fontSize: 11, color: "var(--text-dim)" }}>
          Send a minimal prompt to the first model in this provider to verify connectivity.
        </p>
        <button
          onClick={async () => {
            const modelId = pickTestModelId(provider);
            if (!modelId) {
              setTestState({ phase: "error", error: "No testable model configured — add a model id first" });
              return;
            }
            setTestState({ phase: "testing" });
            try {
              const res = await fetch("/api/test-connection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider: name, modelId }),
              });
              const data = await res.json() as { ok?: boolean; error?: string; response?: string };
              if (data.ok) {
                setTestState({ phase: "success", response: data.response });
              } else {
                setTestState({ phase: "error", error: data.error ?? `HTTP ${res.status}` });
              }
            } catch (e) {
              setTestState({ phase: "error", error: e instanceof Error ? e.message : String(e) });
            }
          }}
          disabled={testState.phase === "testing"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 14px",
            background: testState.phase === "success" ? "#16a34a" : testState.phase === "error" ? "rgba(239,68,68,0.08)" : "var(--accent)",
            border: testState.phase === "error" ? "1px solid rgba(239,68,68,0.3)" : "none",
            borderRadius: 5,
            color: testState.phase === "error" ? "#ef4444" : "#fff",
            cursor: testState.phase === "testing" ? "wait" : "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {testState.phase === "testing" ? (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" style={{ animation: "spin 1s linear infinite" }} /></svg>Testing…</>
          ) : testState.phase === "success" ? (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>Connected</>
          ) : (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>Test</>
          )}
        </button>
        {testState.phase === "success" && testState.response && (
          <div style={{ marginTop: 8, padding: "6px 9px", background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 5, fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            Response: {testState.response}
          </div>
        )}
        {testState.phase === "error" && testState.error && (
          <div style={{ marginTop: 8, padding: "6px 9px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 5, fontSize: 11, color: "#f87171" }}>
            {testState.error}
          </div>
        )}
      </div>
    </div>
  );
}


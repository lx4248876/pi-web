"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "@/hooks/useTheme";
import { GitPanel } from "./GitPanel";
import { applyPreviewTheme } from "@/lib/html-preview-theme";
import { encodeFilePathForApi, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { formatSize } from "./file-viewer/format";
import { DiffView } from "./file-viewer/DiffView";
import { ImageViewer } from "./file-viewer/ImageViewer";
import { AudioViewer } from "./file-viewer/AudioViewer";
import { useFileWatch } from "./file-viewer/useFileWatch";

interface Props {
  filePath: string;
  cwd?: string;
}

interface FileData {
  content: string;
  language: string;
  size: number;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba", "webm"]);

function isImagePath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXTS.has(ext);
}

function isAudioPath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return AUDIO_EXTS.has(ext);
}

export function FileViewer({ filePath, cwd }: Props) {
  if (filePath === "git" && cwd) {
    return <GitPanel cwd={cwd} />;
  }
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} cwd={cwd} />;
  }
  return <TextFileViewer filePath={filePath} cwd={cwd} />;
}

function TextFileViewer({ filePath, cwd }: Props) {
  const { isDark } = useTheme();
  const [data, setData] = useState<FileData | null>(null);
  const [prevContent, setPrevContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [diffPreviewMode, setDiffPreviewMode] = useState(true); // html diff 视图内默认预览
  const [viewMode, setViewMode] = useState<"source" | "diff">("source");
  const [wrapLines, setWrapLines] = useState(false);
  const [changeCount, setChangeCount] = useState(0);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editDirty, setEditDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // 进入编辑时聚焦
  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
    }
  }, [editing]);

  const startEdit = () => {
    setEditText(data?.content ?? "");
    setEditDirty(false);
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditDirty(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const encoded = encodeFilePathForApi(filePath);
      const res = await fetch(`/api/files/${encoded}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editText }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string; size?: number };
      if (!res.ok || !d.ok) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      // 立即更新本地内容,SSE watch 之后也会再同步一次
      setData((prev) => (prev ? { ...prev, content: editText, size: d.size ?? prev.size } : prev));
      setEditing(false);
      setEditDirty(false);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  // 编辑区快捷键:Ctrl/Cmd+S 保存;Esc 退出编辑(不冒泡到弹窗的 Esc 关闭)
  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      cancelEdit();
    }
  };

  // 编辑中屏蔽弹窗的全局 Esc 关闭监听已在 RightPanel 内通过「编辑区不关弹窗」实现;退出编辑由 textarea 局部 Esc 接管

  const fetchContent = useCallback((filePath: string, isRefresh = false) => {
    const encoded = encodeFilePathForApi(filePath);
    return fetch(`/api/files/${encoded}?type=read`)
      .then((r) => r.json())
      .then((d: FileData & { error?: string }) => {
        if (d.error) {
          setError(d.error);
          return null;
        }
        if (isRefresh) {
          setData((prev) => {
            if (prev) setPrevContent(prev.content);
            return d;
          });
          setChangeCount((c) => c + 1);
        } else {
          setData(d);
        }
        return d;
      })
      .catch((e) => {
        setError(String(e));
        return null;
      });
  }, []);

  // Initial load + 文件切换重置
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setPrevContent(null);
    setPreviewMode(false);
    setDiffPreviewMode(true);
    setViewMode("source");
    setWrapLines(false);
    setChangeCount(0);

    fetchContent(filePath).then((d) => {
      if (d?.language === "markdown") setPreviewMode(true);
    }).finally(() => setLoading(false));
  }, [filePath, fetchContent]);

  // 文件变更（SSE watch）时刷新内容
  const watching = useFileWatch(filePath, () => fetchContent(filePath, true));

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  const isHtml = data.language === "html";
  const isMarkdown = data.language === "markdown";
  const lines = data.content.split("\n");
  const hasDiff = prevContent !== null && prevContent !== data.content;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{data.language}</span>
        {viewMode === "source" && <span>{lines.length} lines</span>}
        <span>{formatSize(data.size)}</span>

        {/* Edit controls */}
        {editing ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {editDirty && <span title="Unsaved changes" style={{ color: "#fbbf24", fontSize: 12 }}>●</span>}
            {saveError && <span style={{ color: "#f87171", fontSize: 11 }}>{saveError}</span>}
            <button
              onClick={cancelEdit}
              title="Cancel (Esc)"
              style={{ padding: "2px 10px", fontSize: 11, cursor: "pointer", background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 5 }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              title="Save (Ctrl+S)"
              style={{ padding: "2px 12px", fontSize: 11, cursor: saving ? "wait" : "pointer", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 5, fontWeight: 600, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : viewMode === "source" ? (
          <button
            onClick={startEdit}
            title="Edit this file (read/write)"
            style={{ padding: "2px 10px", fontSize: 11, cursor: "pointer", background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 5 }}
          >
            Edit
          </button>
        ) : null}

        {/* Live watch indicator */}
        <span
          title={watching ? "Live sync active" : "Not watching"}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>

        {/* Diff / Source toggle — shown only when there are changes */}
        {hasDiff && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setViewMode("source")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: viewMode === "source" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "source" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "source" ? 600 : 400,
              }}
            >
              Source
            </button>
            <button
              onClick={() => setViewMode("diff")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: viewMode === "diff" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "diff" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "diff" ? 600 : 400,
              }}
            >
              Diff {changeCount > 0 && <span style={{ color: "#4ade80", marginLeft: 2 }}>+{changeCount}</span>}
            </button>
          </div>
        )}

        {/* HTML diff 模式:预览/源码切换(默认预览渲染改动后内容) */}
        {isHtml && viewMode === "diff" && hasDiff && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setDiffPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: diffPreviewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: diffPreviewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: diffPreviewMode ? 600 : 400,
              }}
            >
              Preview
            </button>
            <button
              onClick={() => setDiffPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: !diffPreviewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !diffPreviewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !diffPreviewMode ? 600 : 400,
              }}
            >
              Diff
            </button>
          </div>
        )}

        {/* Word wrap toggle */}
        {viewMode === "source" && !previewMode && (
          <button
            onClick={() => setWrapLines((v) => !v)}
            title={wrapLines ? "Disable word wrap" : "Enable word wrap"}
            style={{
              padding: "2px 8px", fontSize: 11, cursor: "pointer",
              background: wrapLines ? "var(--bg-selected)" : "var(--bg-hover)",
              color: wrapLines ? "var(--text)" : "var(--text-muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: wrapLines ? 600 : 400,
            }}
          >
            wrap
          </button>
        )}

        {/* HTML source/preview toggle */}
        {isHtml && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              Code
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              Preview
            </button>
          </div>
        )}

        {/* Markdown preview/raw toggle */}
        {isMarkdown && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              Preview
            </button>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              Raw
            </button>
          </div>
        )}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
        {editing ? (
          <textarea
            ref={editRef}
            value={editText}
            onChange={(e) => { setEditText(e.target.value); setEditDirty(true); }}
            onKeyDown={handleEditKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            style={{
              width: "100%",
              height: "100%",
              minHeight: "100%",
              boxSizing: "border-box",
              background: "var(--bg)",
              color: "var(--text)",
              border: "none",
              outline: "none",
              resize: "none",
              padding: "12px 16px",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre",
              overflow: "auto",
              tabSize: 2,
            }}
          />
        ) : viewMode === "diff" && hasDiff ? (
          isHtml && diffPreviewMode ? (
            <iframe
              srcDoc={applyPreviewTheme(data.content, isDark)}
              sandbox="allow-scripts"
              style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
              title="HTML diff preview"
            />
          ) : (
            <DiffView oldContent={prevContent!} newContent={data.content} language={data.language} />
          )
        ) : isHtml && previewMode ? (
          <iframe
            srcDoc={applyPreviewTheme(data.content, isDark)}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
            title="HTML preview"
          />
        ) : isMarkdown && previewMode ? (
          <div
            className="markdown-body markdown-file-preview"
            style={{ padding: "24px 32px", maxWidth: 800 }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
          </div>
        ) : (
          <SyntaxHighlighter
            language={data.language === "text" ? "plaintext" : data.language}
            style={isDark ? vscDarkPlus : vs}
            showLineNumbers
            lineNumberStyle={{
              color: "var(--text-dim)",
              fontStyle: "normal",
              minWidth: "3em",
              paddingRight: "1em",
            }}
            customStyle={{
              margin: 0,
              padding: "12px 0",
              background: "var(--bg)",
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: "var(--font-mono)",
              minHeight: "100%",
            }}
            codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
            wrapLongLines={wrapLines}
          >
            {data.content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
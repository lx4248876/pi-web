"use client";

import {useMemo, useState} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {Prism as SyntaxHighlighter} from "react-syntax-highlighter";
import {vs, vscDarkPlus} from "react-syntax-highlighter/dist/cjs/styles/prism";
import {useTheme} from "@/hooks/useTheme";
import {copyText} from "@/lib/clipboard";
import type {
    AssistantContentBlock,
    TextContent,
    ThinkingContent,
    ToolCallContent,
    ToolResultMessage,
} from "@/lib/types";

export interface ToolErrorContext {
    sessionId?: string;
    cwd?: string;
}

export function BlockView({
                       block,
                       toolResults,
                       isStreaming,
                       streamingDuration,
                       toolCallDurations,
                       toolContext,
                   }: {
    block: AssistantContentBlock;
    toolResults?: Map<string, ToolResultMessage>;
    isStreaming?: boolean;
    streamingDuration?: number;
    toolCallDurations?: Map<string, number>;
    toolContext?: ToolErrorContext;
}) {
    if (block.type === "text") {
        return <TextBlock block={block as TextContent}/>;
    }
    if (block.type === "thinking") {
        return (
            <ThinkingBlock
                block={block as ThinkingContent}
                duration={streamingDuration}
            />
        );
    }
    if (block.type === "toolCall") {
        const tc = block as ToolCallContent;
        const result = toolResults?.get(tc.toolCallId);
        const duration = toolCallDurations?.get(tc.toolCallId);
        return (
            <ToolCallBlock
                block={tc}
                result={result}
                isRunning={isStreaming && !result}
                duration={duration}
                toolContext={toolContext}
            />
        );
    }
    return null;
}

function TextBlock({ block }: { block: TextContent }) {
    return (
        <div className="markdown-body">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    code({className, children, ...props}) {
                        const lang = className?.replace("language-", "") ?? "";
                        const raw = String(children);
                        const isBlock =
                            className?.includes("language-") || raw.includes("\n");
                        if (isBlock) {
                            return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang}/>;
                        }
                        return (
                            <code
                                style={{
                                    background: "var(--bg-selected)",
                                    padding: "1px 4px",
                                    borderRadius: 3,
                                    fontFamily: "var(--font-mono)",
                                    fontSize: "0.9em",
                                }}
                                {...props}
                            >
                                {children}
                            </code>
                        );
                    },
                    pre({children}) {
                        // Unwrap <pre> wrapper — CodeBlock handles its own container
                        return <>{children}</>;
                    },
                }}
            >
                {block.text}
            </ReactMarkdown>
        </div>
    );
}

function ThinkingBlock({
                           block,
                           duration,
                       }: {
    block: ThinkingContent;
    duration?: number;
}) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div
            style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                overflow: "hidden",
                fontSize: 13,
            }}
        >
            <button
                onClick={() => setExpanded((v) => !v)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    padding: "6px 10px",
                    background: "var(--bg-panel)",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                }}
            >
                <span>Thinking</span>
                {duration !== undefined && (
                    <span
                        style={{
                            marginLeft: "auto",
                            fontSize: 11,
                            color: "var(--text-dim)",
                            fontVariantNumeric: "tabular-nums",
                        }}
                    >
						{duration}s
					</span>
                )}
            </button>
            {expanded && (
                <div
                    style={{
                        padding: "8px 10px",
                        color: "var(--text-muted)",
                        fontSize: 12,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        background: "var(--bg-panel)",
                        borderTop: "1px solid var(--border)",
                    }}
                >
                    {block.thinking}
                </div>
            )}
        </div>
    );
}

function ToolCallBlock({
                           block,
                           result,
                           isRunning,
                           duration,
                           toolContext,
                       }: {
    block: ToolCallContent;
    result?: ToolResultMessage;
    isRunning?: boolean;
    duration?: number;
    toolContext?: ToolErrorContext;
}) {
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const inputStr = JSON.stringify(block.input, null, 2);

    const copyToolResult = () => {
        const body = resultText?.trim() ?? "";
        let payload =
            `【${isError ? "工具调用报错" : "工具调用"}】${block.toolName}\n\n` +
            `▍入参\n${inputStr}\n\n` +
            `▍${isError ? "报错输出" : "输出"}\n${body}\n`;
        if (toolContext?.cwd) payload += `\n工作目录: ${toolContext.cwd}\n`;
        if (toolContext?.sessionId) payload += `会话: ${toolContext.sessionId}\n`;
        copyText(payload).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    // Result display
    const resultText = result
        ? result.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("\n")
        : null;
    const resultIsEmpty =
        resultText === null
            ? false
            : resultText.trim() === "(no output)" || resultText.trim() === "";
    const isError = result?.isError ?? false;

    return (
        <div
            style={{
                borderRadius: 7,
                overflow: "hidden",
                fontSize: 12,
                border: isError
                    ? "1px solid rgba(248,113,113,0.45)"
                    : "1px solid rgba(34,197,94,0.25)",
                background: isError ? "rgba(248,113,113,0.05)" : "rgba(34,197,94,0.04)",
            }}
        >
            {/* ── Tool call header ── */}
            <button
                onClick={() => setExpanded((v) => !v)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "6px 10px",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                    minWidth: 0,
                }}
            >
				<span
                    style={{
                        color: isError ? "#f87171" : "#16a34a",
                        fontFamily: "var(--font-mono)",
                        fontWeight: 600,
                        fontSize: 11,
                        flexShrink: 0,
                    }}
                >
					{block.toolName}
				</span>
                <span
                    style={{
                        color: "var(--text-dim)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        minWidth: 0,
                    }}
                >
					{getToolPreview(block)}
				</span>
                {duration !== undefined && (
                    <span
                        style={{
                            fontSize: 11,
                            color: "var(--text-dim)",
                            flexShrink: 0,
                            fontVariantNumeric: "tabular-nums",
                        }}
                    >
						{duration}s
					</span>
                )}
                {result && !isRunning && (
                    <span
                        onClick={(e) => {
                            e.stopPropagation();
                            copyToolResult();
                        }}
                        title={isError ? "复制报错（含入参会话信息，便于其它会话排查）" : "复制此工具调用（含入参会话信息）"}
                        style={{
                            flexShrink: 0,
                            fontSize: 10,
                            fontWeight: 600,
                            color: copied ? "#4ade80" : (isError ? "#fbbf24" : "#7dd3fc"),
                            border: `1px solid ${copied ? "rgba(74,222,128,0.5)" : isError ? "rgba(251,191,36,0.5)" : "rgba(125,211,252,0.35)"}`,
                            borderRadius: 4,
                            padding: "1px 6px",
                            cursor: "pointer",
                            userSelect: "none",
                        }}
                    >
						{copied ? "已复制" : isError ? "复制报错" : "复制"}
					</span>
                )}
                <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="var(--text-dim)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                        flexShrink: 0,
                        transform: expanded ? "rotate(180deg)" : "none",
                        transition: "transform 0.15s",
                    }}
                >
                    <polyline points="2 3.5 5 6.5 8 3.5"/>
                </svg>
            </button>

            {/* ── Expanded: input args ── */}
            {expanded && (
                <pre
                    style={{
                        margin: 0,
                        padding: "8px 10px",
                        color: "var(--text-muted)",
                        fontSize: 12,
                        lineHeight: 1.5,
                        overflow: "auto",
                        background: "var(--bg-subtle)",
                        borderTop: isError
                            ? "1px solid rgba(248,113,113,0.25)"
                            : "1px solid rgba(34,197,94,0.2)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                    }}
                >
					{inputStr}
				</pre>
            )}

            {/* ── Paired result — only shown when expanded ── */}
            {expanded && result && (
                <PairedResult
                    text={resultText ?? ""}
                    isEmpty={resultIsEmpty}
                    isError={isError}
                />
            )}
        </div>
    );
}

function PairedResult({
                          text,
                          isEmpty,
                          isError,
                      }: {
    text: string;
    isEmpty: boolean;
    isError: boolean;
}) {
    return (
        <div
            style={{
                borderTop: `1px solid ${isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`,
                background: isError ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)",
            }}
        >
			<pre
                style={{
                    margin: 0,
                    padding: "8px 10px",
                    color: isError
                        ? "#f87171"
                        : isEmpty
                            ? "var(--text-dim)"
                            : "var(--text-muted)",
                    fontSize: 12,
                    lineHeight: 1.5,
                    overflow: "auto",
                    maxHeight: 400,
                    background: "var(--bg)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontStyle: isEmpty ? "italic" : "normal",
                    opacity: isEmpty ? 0.6 : 1,
                }}
            >
				{isEmpty ? "(no output)" : text}
			</pre>
        </div>
    );
}

function getToolPreview(block: ToolCallContent): string {
    const input = block.input;
    if (!input || typeof input !== "object") return "";
    const keys = Object.keys(input);
    if (keys.length === 0) return "";

    // Common tool input patterns
    if ("command" in input) return String(input.command).slice(0, 120);
    if ("path" in input) return String(input.path).slice(0, 120);
    if ("file_path" in input) return String(input.file_path).slice(0, 120);
    if ("pattern" in input) return String(input.pattern).slice(0, 120);
    if ("query" in input) return String(input.query).slice(0, 120);

    const first = input[keys[0]];
    return String(first).slice(0, 120);
}

export function formatUsage(usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: { total: number };
}): string {
    const parts = [];
    if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
    if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
    if (usage.cacheRead) {
        // 缓存命中率：被缓存命中的输入占比（命中率越高越省钱省时）
        const total = usage.input + usage.cacheRead;
        const pct = total > 0 ? Math.round((usage.cacheRead / total) * 100) : 0;
        parts.push(`缓存 ${pct}%`);
    }
    if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
    return parts.join(" · ");
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
    const {isDark} = useTheme();
    const [copied, setCopied] = useState(false);

    const lineCount = useMemo(() => code.split("\n").length, [code]);
    const isCollapsible = lineCount > 45;
    const [isCollapsed, setIsCollapsed] = useState(isCollapsible);

    const copy = () => {
        copyText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    return (
        <div
            style={{
                position: "relative",
                marginTop: 6,
                marginBottom: 6,
                borderRadius: 6,
                overflow: "hidden",
                border: "1px solid var(--border)",
            }}
        >
            <div
                style={{
                    padding: "5px 12px",
                    background: "var(--bg-panel)",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 11,
                    color: "var(--text-dim)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontFamily: "var(--font-mono)",
                }}
            >
                <span style={{fontWeight: 600}}>{lang || "text"}</span>
                <div style={{display: "flex", alignItems: "center", gap: 10}}>
                    {isCollapsible && (
                        <button
                            onClick={() => setIsCollapsed((v) => !v)}
                            style={{
                                background: "none",
                                border: "none",
                                color: "var(--text-muted)",
                                cursor: "pointer",
                                fontSize: 11,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = "var(--text)";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = "var(--text-muted)";
                            }}
                        >
                            {isCollapsed ? (
                                <>
                                    <svg
                                        width="11"
                                        height="11"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.5"
                                    >
                                        <polyline points="7 13 12 18 17 13"></polyline>
                                        <polyline points="7 6 12 11 17 6"></polyline>
                                    </svg>
                                    展开 ({lineCount} 行)
                                </>
                            ) : (
                                <>
                                    <svg
                                        width="11"
                                        height="11"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.5"
                                    >
                                        <polyline points="17 11 12 6 7 11"></polyline>
                                        <polyline points="17 18 12 13 7 18"></polyline>
                                    </svg>
                                    折叠
                                </>
                            )}
                        </button>
                    )}
                    <button
                        onClick={copy}
                        style={{
                            background: "none",
                            border: "none",
                            color: copied ? "var(--accent)" : "var(--text-muted)",
                            cursor: "pointer",
                            fontSize: 11,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontWeight: copied ? 600 : 400,
                        }}
                        onMouseEnter={(e) => {
                            if (!copied) e.currentTarget.style.color = "var(--text)";
                        }}
                        onMouseLeave={(e) => {
                            if (!copied) e.currentTarget.style.color = "var(--text-muted)";
                        }}
                    >
                        {copied ? (
                            <>
                                <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#22c55e"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="20 6 9 17 4 12"/>
                                </svg>
                                已复制
                            </>
                        ) : (
                            <>
                                <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                                复制
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div
                style={{
                    position: "relative",
                    maxHeight: isCollapsed ? "300px" : "none",
                    overflow: "hidden",
                }}
            >
                <SyntaxHighlighter
                    language={lang || "text"}
                    style={isDark ? vscDarkPlus : vs}
                    showLineNumbers
                    lineNumberStyle={{color: "var(--text-dim)", fontStyle: "normal"}}
                    customStyle={{
                        margin: 0,
                        padding: "12px 14px",
                        fontSize: 12.5,
                        lineHeight: 1.6,
                        borderRadius: 0,
                        background: "var(--bg)",
                        maxHeight: isCollapsed ? "300px" : "1000px",
                        overflow: "auto",
                    }}
                    codeTagProps={{style: {fontFamily: "var(--font-mono)"}}}
                >
                    {code}
                </SyntaxHighlighter>

                {isCollapsed && (
                    <div
                        onClick={() => setIsCollapsed(false)}
                        style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: "70px",
                            background:
                                "linear-gradient(to top, var(--bg) 15%, rgba(0,0,0,0) 100%)",
                            display: "flex",
                            alignItems: "flex-end",
                            justifyContent: "center",
                            paddingBottom: "12px",
                            cursor: "pointer",
                            userSelect: "none",
                        }}
                    >
                        <div
                            style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                                background: "var(--bg-panel)",
                                border: "1px solid var(--border)",
                                borderRadius: "15px",
                                padding: "4px 12px",
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                                fontWeight: 600,
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = "var(--text)";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = "var(--text-muted)";
                            }}
                        >
                            <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                            >
                                <polyline points="7 13 12 18 17 13"></polyline>
                                <polyline points="7 6 12 11 17 6"></polyline>
                            </svg>
                            展开完整代码 ({lineCount} 行)
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}


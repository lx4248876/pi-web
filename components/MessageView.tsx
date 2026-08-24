"use client";

import {memo, useEffect, useMemo, useRef, useState} from "react";
import {copyText} from "@/lib/clipboard";
import {parseModelError, friendlyModelErrorHint} from "@/lib/model-error";
import type {
    AgentMessage,
    AssistantMessage,
    ImageContent,
    TextContent,
    ThinkingContent,
    ToolCallContent,
    ToolResultMessage,
    UserMessage,
} from "@/lib/types";
import {BlockView, formatUsage, type ToolErrorContext} from "./message-view/blocks";

interface Props {
    message: AgentMessage;
    isStreaming?: boolean;
    toolResults?: Map<string, ToolResultMessage>;
    modelNames?: Record<string, string>;
    entryId?: string;
    /** 会话标识与工作目录，用于「复制报错」按钮打包可排查信息 */
    toolContext?: ToolErrorContext;
    onFork?: (entryId: string) => void;
    forking?: boolean;
    onNavigate?: (entryId: string) => void;
    prevAssistantEntryId?: string;
    onEditContent?: (content: string) => void;
    showTimestamp?: boolean;
    prevTimestamp?: number;
}

function formatTime(ts?: number): string | null {
    if (!ts) return null;
    const d = new Date(ts);
    const now = new Date();
    const isToday =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
    const time = d.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
    if (isToday) return time;
    const date = d.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
    return `${date} ${time}`;
}


function arePropsEqual(prev: Props, next: Props) {
    if (prev.isStreaming !== next.isStreaming) return false;
    if (prev.forking !== next.forking) return false;
    if (prev.showTimestamp !== next.showTimestamp) return false;
    if (prev.prevTimestamp !== next.prevTimestamp) return false;
    if (prev.entryId !== next.entryId) return false;
    if (prev.prevAssistantEntryId !== next.prevAssistantEntryId) return false;
    if (
        prev.toolContext?.sessionId !== next.toolContext?.sessionId ||
        prev.toolContext?.cwd !== next.toolContext?.cwd
    ) {
        return false;
    }

    if (prev.message !== next.message) {
        if (prev.message.role !== next.message.role) return false;
        if (
            JSON.stringify(prev.message.content) !==
            JSON.stringify(next.message.content)
        ) {
            return false;
        }
    }

    if (prev.message.role === "assistant") {
        const prevMsg = prev.message as AssistantMessage;
        const nextMsg = next.message as AssistantMessage;
        const prevBlocks = prevMsg.content ?? [];
        const nextBlocks = nextMsg.content ?? [];
        const prevCallIds = prevBlocks
            .filter((b) => b.type === "toolCall")
            .map((b) => b.toolCallId);
        const nextCallIds = nextBlocks
            .filter((b) => b.type === "toolCall")
            .map((b) => b.toolCallId);

        if (prevCallIds.length !== nextCallIds.length) return false;
        for (let i = 0; i < prevCallIds.length; i++) {
            if (prevCallIds[i] !== nextCallIds[i]) return false;
        }

        for (const callId of prevCallIds) {
            const prevRes = prev.toolResults?.get(callId);
            const nextRes = next.toolResults?.get(callId);
            if (prevRes !== nextRes) {
                if (!prevRes || !nextRes) return false;
                if (
                    JSON.stringify(prevRes.content) !== JSON.stringify(nextRes.content)
                ) {
                    return false;
                }
            }
        }
    }

    return true;
}

export const MessageView = memo(function MessageView({
                                                         message,
                                                         isStreaming,
                                                         toolResults,
                                                         modelNames,
                                                         entryId,
                                                         onFork,
                                                         forking,
                                                         onNavigate,
                                                         prevAssistantEntryId,
                                                         onEditContent,
                                                         showTimestamp,
                                                         prevTimestamp,
                                                         toolContext,
                                                     }: Props) {
    if (message.role === "user") {
        return (
            <UserMessageView
                message={message as UserMessage}
                entryId={entryId}
                onFork={onFork}
                forking={forking}
                onNavigate={onNavigate}
                prevAssistantEntryId={prevAssistantEntryId}
                onEditContent={onEditContent}
            />
        );
    }
    if (message.role === "assistant") {
        return (
            <AssistantMessageView
                message={message as AssistantMessage}
                isStreaming={isStreaming}
                toolResults={toolResults}
                modelNames={modelNames}
                showTimestamp={showTimestamp}
                prevTimestamp={prevTimestamp}
                toolContext={toolContext}
            />
        );
    }
    if (message.role === "toolResult") {
        // Rendered inline under its toolCall — skip standalone rendering if paired
        return null;
    }
    return null;
}, arePropsEqual);

function UserMessageView({
                             message,
                             entryId,
                             onFork,
                             forking,
                             onNavigate,
                             prevAssistantEntryId,
                             onEditContent,
                         }: {
    message: UserMessage;
    entryId?: string;
    onFork?: (entryId: string) => void;
    forking?: boolean;
    onNavigate?: (entryId: string) => void;
    prevAssistantEntryId?: string;
    onEditContent?: (content: string) => void;
}) {
    const [hovered, setHovered] = useState(false);
    const [copied, setCopied] = useState(false);

    const content =
        typeof message.content === "string"
            ? message.content
            : message.content
                .filter((b): b is TextContent => b.type === "text")
                .map((b) => b.text)
                .join("\n");

    const imageBlocks: ImageContent[] =
        typeof message.content === "string"
            ? []
            : message.content.filter((b): b is ImageContent => b.type === "image");

    const time = formatTime(message.timestamp);
    const canFork = !!entryId && !!onFork;
    const canNavigate = !!prevAssistantEntryId && !!onNavigate;

    const copyContent = () => {
        copyText(content).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    return (
        <div
            style={{
                marginBottom: 16,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                contain: "content",
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 6,
                    maxWidth: "85%",
                }}
            >
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        background: "var(--user-bg)",
                        border: "1px solid rgba(59,130,246,0.2)",
                        borderRadius: 12,
                        padding: "8px 12px",
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: "var(--text)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                    }}
                >
                    {imageBlocks.length > 0 && (
                        <div
                            style={{
                                display: "flex",
                                gap: 6,
                                flexWrap: "wrap",
                                marginBottom: content ? 8 : 0,
                            }}
                        >
                            {imageBlocks.map((img, i) => {
                                // lib/types.ts ImageContent uses {source:{type,data,media_type,url}}
                                // pi-ai on-disk format uses flat {data, mimeType} — handle both
                                const flat = img as unknown as {
                                    data?: string;
                                    mimeType?: string;
                                };
                                const src = img.source
                                    ? img.source.type === "base64"
                                        ? `data:${img.source.media_type};base64,${img.source.data}`
                                        : (img.source.url ?? "")
                                    : flat.data
                                        ? `data:${flat.mimeType};base64,${flat.data}`
                                        : "";
                                return (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        key={i}
                                        src={src}
                                        alt=""
                                        style={{
                                            maxWidth: 240,
                                            maxHeight: 240,
                                            borderRadius: 6,
                                            objectFit: "contain",
                                            display: "block",
                                            border: "1px solid rgba(59,130,246,0.15)",
                                        }}
                                    />
                                );
                            })}
                        </div>
                    )}
                    {content}
                </div>
            </div>

            {/* Bottom row: action buttons + timestamp */}
            {(time || canFork || canNavigate || true) && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 6,
                        marginTop: 3,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            gap: 3,
                            opacity: hovered ? 1 : 0,
                            pointerEvents: hovered ? "auto" : "none",
                            transition: "opacity 0.12s",
                        }}
                    >
                        <button
                            onClick={copyContent}
                            title="Copy message"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "3px 8px",
                                height: 22,
                                background: "none",
                                border: "none",
                                borderRadius: 5,
                                color: copied ? "var(--accent)" : "var(--text-dim)",
                                cursor: "pointer",
                                fontSize: 11,
                                fontWeight: 400,
                                whiteSpace: "nowrap",
                                transition: "color 0.12s",
                            }}
                            onMouseEnter={(e) => {
                                if (!copied) e.currentTarget.style.color = "var(--accent)";
                            }}
                            onMouseLeave={(e) => {
                                if (!copied) e.currentTarget.style.color = "var(--text-dim)";
                            }}
                        >
                            {copied ? (
                                <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="20 6 9 17 4 12"/>
                                </svg>
                            ) : (
                                <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                            )}
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                    {(canFork || canNavigate) && (
                        <div
                            style={{
                                display: "flex",
                                gap: 3,
                                opacity: hovered || forking ? 1 : 0,
                                pointerEvents: hovered || forking ? "auto" : "none",
                                transition: "opacity 0.12s",
                            }}
                        >
                            {canNavigate && (
                                <button
                                    onClick={() => {
                                        onNavigate!(prevAssistantEntryId!);
                                        onEditContent?.(content);
                                    }}
                                    title="Edit from here — branches within this session"
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        padding: "3px 8px",
                                        height: 22,
                                        background: "none",
                                        border: "none",
                                        borderRadius: 5,
                                        color: "var(--text-dim)",
                                        cursor: "pointer",
                                        fontSize: 11,
                                        fontWeight: 400,
                                        whiteSpace: "nowrap",
                                        transition: "color 0.12s",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.color = "var(--accent)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.color = "var(--text-dim)";
                                    }}
                                >
                                    <svg
                                        width="11"
                                        height="11"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <polyline points="15 10 20 15 15 20"/>
                                        <path d="M4 4v7a4 4 0 0 0 4 4h12"/>
                                    </svg>
                                    Edit from here
                                </button>
                            )}
                            {canFork && (
                                <button
                                    onClick={() => {
                                        onFork!(entryId!);
                                    }}
                                    disabled={forking}
                                    title={
                                        forking
                                            ? "Creating new session…"
                                            : "New session — creates an independent copy from here"
                                    }
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        padding: "3px 8px",
                                        height: 22,
                                        background: "none",
                                        border: "none",
                                        borderRadius: 5,
                                        color: forking ? "var(--accent)" : "var(--text-dim)",
                                        cursor: forking ? "not-allowed" : "pointer",
                                        fontSize: 11,
                                        fontWeight: 400,
                                        whiteSpace: "nowrap",
                                        transition: "color 0.12s",
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!forking) e.currentTarget.style.color = "var(--accent)";
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!forking)
                                            e.currentTarget.style.color = "var(--text-dim)";
                                    }}
                                >
                                    <svg
                                        width="11"
                                        height="11"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <line x1="6" y1="3" x2="6" y2="15"/>
                                        <circle cx="18" cy="6" r="3"/>
                                        <circle cx="6" cy="18" r="3"/>
                                        <path d="M18 9a9 9 0 0 1-9 9"/>
                                    </svg>
                                    {forking ? "Creating…" : "New session"}
                                </button>
                            )}
                        </div>
                    )}
                    {time && (
                        <span style={{fontSize: 10, color: "var(--text-dim)"}}>
							{time}
						</span>
                    )}
                </div>
            )}
        </div>
    );
}

function AssistantMessageView({
                                  message,
                                  isStreaming,
                                  toolResults,
                                  modelNames,
                                  showTimestamp,
                                  prevTimestamp,
                                  toolContext,
}: {
    message: AssistantMessage;
    isStreaming?: boolean;
    toolResults?: Map<string, ToolResultMessage>;
    modelNames?: Record<string, string>;
    showTimestamp?: boolean;
    prevTimestamp?: number;
    toolContext?: ToolErrorContext;
}) {
    const time = showTimestamp ? formatTime(message.timestamp) : null;
    const blocks = message.content ?? [];
    const [hovered, setHovered] = useState(false);
    const [copied, setCopied] = useState(false);
    const streamStartRef = useRef<number | null>(null);
    const [tps, setTps] = useState<number | null>(null);
    const blocksRef = useRef(blocks);
    blocksRef.current = blocks;

    // Streaming-based timing for thinking blocks
    const blockStartTimesRef = useRef<Map<number, number>>(new Map());
    const [streamingDurations, setStreamingDurations] = useState<
        Map<number, number>
    >(new Map());

    // Thinking duration derived from file timestamps: time from prev message end to this message end
    // This is the total generation time (thinking + any text before first tool call)
    const thinkingDurationFromFile = useMemo<number | undefined>(() => {
        if (!message.timestamp || !prevTimestamp) return undefined;
        const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
        return secs > 0 ? secs : undefined;
    }, [message.timestamp, prevTimestamp]);

    // Tool call durations derived from session file timestamps (accurate for completed messages)
    // assistant message timestamp = when generation ended = when tools started running
    // toolResult timestamp = when tool execution finished
    const toolCallDurations = useMemo<Map<string, number>>(() => {
        const map = new Map<string, number>();
        if (!toolResults || !message.timestamp) return map;
        for (const [callId, result] of toolResults) {
            if (result.timestamp && message.timestamp) {
                const secs = Math.round((result.timestamp - message.timestamp) / 1000);
                if (secs > 0) map.set(callId, secs);
            }
        }
        return map;
    }, [toolResults, message.timestamp]);

    const textContent = blocks
        .filter((b): b is TextContent => b.type === "text")
        .map((b) => b.text)
        .join("\n");


    const copyContent = () => {
        copyText(textContent).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    useEffect(() => {
        if (!isStreaming) {
            // Finalise any un-finished thinking block durations on stream end
            const now = Date.now();
            setStreamingDurations((prev: Map<number, number>) => {
                const next = new Map(prev);
                for (const [idx, start] of blockStartTimesRef.current) {
                    if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
                }
                return next;
            });
            streamStartRef.current = null;
            setTps(null);
            return;
        }
        const tick = () => {
            const bs = blocksRef.current;
            const now = Date.now();

            // Record start time for each block the first time we see it
            bs.forEach((_, i) => {
                if (!blockStartTimesRef.current.has(i))
                    blockStartTimesRef.current.set(i, now);
            });

            // When a non-last block has a successor already started, finalise its duration
            setStreamingDurations((prev: Map<number, number>) => {
                let changed = false;
                const next = new Map(prev);
                for (let i = 0; i < bs.length - 1; i++) {
                    if (!next.has(i) && blockStartTimesRef.current.has(i)) {
                        const start = blockStartTimesRef.current.get(i)!;
                        const nextStart = blockStartTimesRef.current.get(i + 1) ?? now;
                        next.set(i, Math.round((nextStart - start) / 1000));
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });

            let chars = 0;
            for (const b of bs) {
                if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
                else if (b.type === "thinking")
                    chars += (b as ThinkingContent).thinking?.length ?? 0;
                else if (b.type === "toolCall")
                    chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
            }
            if (chars === 0) return;
            if (streamStartRef.current === null) streamStartRef.current = now;
            const elapsed = (now - streamStartRef.current) / 1000;
            if (elapsed > 0.5) setTps(chars / 4 / elapsed);
        };
        const id = setInterval(tick, 300);
        return () => clearInterval(id);
    }, [isStreaming]);

    return (
        <div
            style={{marginBottom: 16, contain: "content"}}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Model label */}
            <div
                style={{
                    fontSize: 11,
                    color: "var(--text-dim)",
                    marginBottom: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
            >
                {message.provider && (
                    <span>
						{modelNames?.[`${message.provider}:${message.model}`] ??
                            modelNames?.[message.model] ??
                            message.model}
					</span>
                )}
                {isStreaming &&
                    (() => {
                        let chars = 0;
                        for (const b of blocks) {
                            if (b.type === "text")
                                chars += (b as TextContent).text?.length ?? 0;
                            else if (b.type === "thinking")
                                chars += (b as ThinkingContent).thinking?.length ?? 0;
                            else if (b.type === "toolCall")
                                chars += JSON.stringify(
                                    (b as ToolCallContent).input ?? {},
                                ).length;
                        }
                        const est = Math.round(chars / 4);
                        return (
                            <>
                                {est > 0 && (
                                    <span
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 4,
                                            color: "var(--text)",
                                        }}
                                        title="预估 token 数（流式接收中）"
                                    >
										<span
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 2,
                                                fontSize: 11,
                                                fontWeight: 400,
                                            }}
                                        >
											<svg
                                                width="10"
                                                height="10"
                                                viewBox="0 0 10 10"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
												<line x1="5" y1="1.5" x2="5" y2="8.5"/>
												<polyline points="2 6 5 8.5 8 6"/>
											</svg>
                                            {est}
										</span>
                                        {tps !== null &&
                                            (() => {
                                                const bg =
                                                    tps >= 50
                                                        ? "#53b3cb"
                                                        : tps >= 30
                                                            ? "#9bc53d"
                                                            : tps >= 15
                                                                ? "#f9c22e"
                                                                : "#e01a4f";
                                                return (
                                                    <span
                                                        style={{
                                                            marginLeft: 6,
                                                            padding: "1px 6px",
                                                            borderRadius: 4,
                                                            background: bg,
                                                            color: "#fff",
                                                            fontSize: 11,
                                                            fontWeight: 400,
                                                        }}
                                                    >
														{tps.toFixed(1)} t/s
													</span>
                                                );
                                            })()}
									</span>
                                )}
                            </>
                        );
                    })()}
            </div>

            <div style={{display: "flex", flexDirection: "column", gap: 8}}>
                {blocks.map((block, i) => (
                    <BlockView
                        key={i}
                        block={block}
                        toolResults={toolResults}
                        isStreaming={isStreaming}
                        streamingDuration={
                            streamingDurations.get(i) ??
                            (block.type === "thinking" ? thinkingDurationFromFile : undefined)
                        }
                        toolCallDurations={toolCallDurations}
                        toolContext={toolContext}
                    />
                ))}
            </div>

            {/* 模型返回错误（余额不足、限流、网络等）时，pi 协议会带 stopReason:"error" + errorMessage。
          AssistantMessageView 默认只渲染 content blocks，必须在此显式展示错误，否则用户只看到一条空白消息。 */}
            {!isStreaming &&
                message.stopReason === "error" &&
                message.errorMessage && (
                    <ErrorBanner message={message}/>
                )}

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 4,
                }}
            >
                {message.usage && !isStreaming && (
                    <div style={{fontSize: 11, color: "var(--text-dim)"}}>
                        {formatUsage(message.usage)}
                    </div>
                )}
                {textContent && !isStreaming && (
                    <button
                        onClick={copyContent}
                        title="Copy message"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "3px 8px",
                            height: 22,
                            background: "none",
                            border: "none",
                            borderRadius: 5,
                            color: copied ? "var(--accent)" : "var(--text-dim)",
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 400,
                            whiteSpace: "nowrap",
                            opacity: hovered ? 1 : 0,
                            pointerEvents: hovered ? "auto" : "none",
                            transition: "opacity 0.12s, color 0.12s",
                        }}
                        onMouseEnter={(e) => {
                            if (!copied) e.currentTarget.style.color = "var(--accent)";
                        }}
                        onMouseLeave={(e) => {
                            if (!copied) e.currentTarget.style.color = "var(--text-dim)";
                        }}
                    >
                        {copied ? (
                            <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        ) : (
                            <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                        )}
                        {copied ? "Copied" : "Copy"}
                    </button>
                )}
                {time && !isStreaming && (
                    <span
                        style={{
                            fontSize: 10,
                            color: "var(--text-dim)",
                            marginLeft: "auto",
                        }}
                    >
						{time}
					</span>
                )}
            </div>
        </div>
    );
}

function ErrorBanner({ message }: { message: AssistantMessage }) {
    // 把底层错误归类成用户能看懂的中文提示；保留完整信息供排查。
    // 解析逻辑集中在 lib/model-error.ts，避免在多处维护正则分类。
    const raw = message.errorMessage ?? "";
    const parsed = parseModelError(raw);
    const hint = friendlyModelErrorHint(parsed, raw);
    const statusLine = [
        parsed.status !== undefined ? `HTTP ${parsed.status}` : null,
        parsed.code ?? null,
        // JSON 里 error 字段即错误码时（如 {"error":"internal_server_error"}）message 与 code 相同，去重
        parsed.message && parsed.message !== raw && parsed.message !== parsed.code
            ? parsed.message
            : null,
    ]
        .filter(Boolean)
        .join(" · ");
    const metaLine = [
        message.provider,
        message.model,
        formatTime(message.timestamp),
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <div
            style={{
                marginTop: 4,
                padding: "10px 12px",
                borderRadius: 8,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.35)",
                color: "#ef4444",
                fontSize: 13,
                lineHeight: 1.6,
                display: "flex",
                flexDirection: "column",
                gap: 4,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontWeight: 600,
                }}
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
                >
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                请求失败
                {statusLine && (
                    <span
                        style={{fontWeight: 400, fontSize: 12, opacity: 0.75}}
                    >
                        {statusLine}
                    </span>
                )}
            </div>
            <div style={{color: "var(--text)"}}>{hint}</div>
            {metaLine && (
                <div
                    style={{
                        fontSize: 11,
                        color: "var(--text-dim)",
                        opacity: 0.85,
                    }}
                >
                    {metaLine}
                </div>
            )}
            <div
                style={{
                    marginTop: 2,
                    fontSize: 11,
                    color: "var(--text-dim)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    opacity: 0.85,
                }}
            >
                {raw}
            </div>
        </div>
    );
}


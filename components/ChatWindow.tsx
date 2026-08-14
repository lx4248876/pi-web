"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {AgentMessage, SessionInfo, SessionTreeNode} from "@/lib/types";
import {MessageView} from "./MessageView";
import {ChatInput, type ChatInputHandle} from "./ChatInput";
import {ChatMinimap, useMessageRefs} from "./ChatMinimap";
import {
    type AgentPhase,
    type ExtensionUIRequest,
    type ExtensionUIResponse,
    useAgentSession,
} from "@/hooks/useAgentSession";
import {useAudio} from "@/hooks/useAudio";
import {useDragDrop} from "@/hooks/useDragDrop";

interface Props {
    session: SessionInfo | null;
    newSessionCwd: string | null;
    onAgentStart?: () => void;
    onAgentEnd?: () => void;
    onStreamingChange?: (sessionId: string | null) => void;
    onSessionCreated?: (session: SessionInfo) => void;
    onSessionContent?: () => void;
    onSessionForked?: (newSessionId: string) => void;
    modelsRefreshKey?: number;
    chatInputRef?: React.RefObject<ChatInputHandle | null>;
    onBranchDataChange?: (
        tree: SessionTreeNode[],
        activeLeafId: string | null,
        onLeafChange: (leafId: string | null) => void,
    ) => void;
    onSystemPromptChange?: (prompt: string | null) => void;
}

function phaseLabel(phase: AgentPhase): string {
    if (phase?.kind === "running_tools") {
        const names = phase.tools.map((t) => t.name);
        if (names.length === 0) return "Running tool...";
        if (names.length === 1) return `Running ${names[0]}...`;
        if (names.length <= 3) return `Running ${names.join(", ")}...`;
        return `Running ${names.slice(0, 2).join(", ")} (+${names.length - 2})...`;
    }
    if (phase?.kind === "waiting_model") return "Waiting for model...";
    return "Thinking...";
}

const TYPEWRITER_PHRASES = [
    "ready when you are.",
    "ask me anything.",
    "let's build something cool.",
    "explore your codebase.",
    "draft an email.",
    "summarize that paper.",
    "plan your weekend.",
    "explain it like I'm five.",
    "pair-program with me.",
    "fix that pesky bug.",
    "translate to 中文.",
    "write a haiku.",
    "brainstorm ideas.",
    "review my pull request.",
    "what should we cook tonight?",
    "ship it.",
    "make it pretty.",
    "rubber-duck with me.",
];

function Typewriter({ phrases }: { phrases: string[] }) {
    const [phraseIdx, setPhraseIdx] = useState(() =>
        Math.floor(Math.random() * phrases.length),
    );
    const [text, setText] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [caretOn, setCaretOn] = useState(true);

    useEffect(() => {
        const blink = setInterval(() => setCaretOn((v) => !v), 530);
        return () => clearInterval(blink);
    }, []);

    useEffect(() => {
        const current = phrases[phraseIdx];
        let timeout: ReturnType<typeof setTimeout>;
        if (!deleting && text === current) {
            timeout = setTimeout(() => setDeleting(true), 1800);
        } else if (deleting && text === "") {
            setDeleting(false);
            setPhraseIdx((i) => (i + 1) % phrases.length);
        } else {
            const next = deleting
                ? current.slice(0, text.length - 1)
                : current.slice(0, text.length + 1);
            timeout = setTimeout(() => setText(next), deleting ? 28 : 55);
        }
        return () => clearTimeout(timeout);
    }, [text, deleting, phraseIdx, phrases]);

    return (
        <span style={{color: "var(--text-muted)", fontWeight: 400}}>
			{text}
            <span
                style={{
                    opacity: caretOn ? 1 : 0,
                    color: "var(--accent)",
                    marginLeft: 1,
                }}
            >
				▍
			</span>
		</span>
    );
}

function ExtensionUIDialog({
                               request,
                               onResponse,
}: {
    request: Extract<
        ExtensionUIRequest,
        { method: "select" | "confirm" | "input" | "editor" | "multiple" }
    >;
    onResponse: (response: ExtensionUIResponse) => void;
}) {
    const [value, setValue] = useState(
        request.method === "editor" ? (request.prefill ?? "") : "",
    );
    // 多问题：每个问题各自的选中项（有 options 的）与文本输入（无 options 的）
    const [selections, setSelections] = useState<Record<number, string>>({});
    const [inputs, setInputs] = useState<Record<number, string>>({});

    useEffect(() => {
        setValue(request.method === "editor" ? (request.prefill ?? "") : "");
        setSelections({});
        setInputs({});
    }, [
        request.id,
        request.method,
        request.method === "editor" ? request.prefill : undefined,
    ]);

    const cancel = () =>
        onResponse({
            type: "extension_ui_response",
            id: request.id,
            cancelled: true,
        });
    const submitValue = () =>
        onResponse({type: "extension_ui_response", id: request.id, value});

    // 多问题：校验每问都已作答，按序收集答案数组回传
    const multipleAnswered = useMemo(() => {
        if (request.method !== "multiple") return true;
        return request.questions.every((q, qi) =>
            q.options && q.options.length > 0
                ? Boolean(selections[qi])
                : Boolean((inputs[qi] ?? "").trim()),
        );
    }, [request, selections, inputs]);
    const submitMultiple = () => {
        if (request.method !== "multiple") return;
        const answers = request.questions.map((q, qi) =>
            q.options && q.options.length > 0
                ? selections[qi] ?? ""
                : (inputs[qi] ?? "").trim(),
        );
        onResponse({
            type: "extension_ui_response",
            id: request.id,
            value: answers,
        });
    };

    return (
        <div
            style={{
                padding: "0 16px 8px",
                paddingRight: 52, // 16px base + 36px for ChatMinimap alignment
                flexShrink: 0,
            }}
        >
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <div
                style={{
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderTop: "2px solid var(--accent)",
                    borderRadius: 10,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
                    padding: 16,
                }}
            >
                <div
                    className="mb-3 flex items-center gap-2 text-[15px] font-semibold"
                    style={{ color: "var(--text)" }}
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ flexShrink: 0 }}
                    >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    {request.title}
                </div>

                {request.method === "select" && (
                    <div className="flex flex-col gap-2">
                        {request.options.map((option) => (
                            <button
                                key={option}
                                onClick={() =>
                                    onResponse({
                                        type: "extension_ui_response",
                                        id: request.id,
                                        value: option,
                                    })
                                }
                                className="w-full text-left text-sm transition-colors hover:bg-[var(--bg-hover)]"
                                style={{
                                    border: "1px solid var(--border)",
                                    borderRadius: 6,
                                    padding: "9px 10px",
                                    color: "var(--text)",
                                    // 选项文本可能带 "\n"（label 后拼接的 description），
                                    // 保留换行渲染成 option 的第二行说明，而不是缩成一个长标签。
                                    whiteSpace: "pre-line",
                                    lineHeight: 1.5,
                                }}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                )}

                {request.method === "multiple" && (
                    <div className="flex flex-col gap-4">
                        {request.questions.map((q, qi) => (
                            <div key={qi} className="flex flex-col gap-2">
                                <div
                                    className="text-sm font-semibold"
                                    style={{ color: "var(--text)" }}
                                >
                                    {qi + 1}. {q.question}
                                </div>
                                {q.options && q.options.length > 0 ? (
                                    <div className="flex flex-col gap-2">
                                        {q.options.map((opt) => {
                                            const selected = selections[qi] === opt;
                                            return (
                                                <button
                                                    key={opt}
                                                    onClick={() =>
                                                        setSelections((s) => ({
                                                            ...s,
                                                            [qi]: opt,
                                                        }))
                                                    }
                                                    className="w-full text-left text-sm transition-colors hover:bg-[var(--bg-hover)]"
                                                    style={{
                                                        border: selected
                                                            ? "1px solid var(--accent)"
                                                            : "1px solid var(--border)",
                                                        borderRadius: 6,
                                                        padding: "9px 10px",
                                                        color: "var(--text)",
                                                        whiteSpace: "pre-line",
                                                        lineHeight: 1.5,
                                                    }}
                                                >
                                                    {opt}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <input
                                        value={inputs[qi] ?? ""}
                                        placeholder={q.placeholder}
                                        onChange={(e) =>
                                            setInputs((s) => ({ ...s, [qi]: e.target.value }))
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") submitMultiple();
                                            if (e.key === "Escape") cancel();
                                        }}
                                        className="w-full text-sm outline-none"
                                        style={{
                                            background: "var(--bg)",
                                            border: "1px solid var(--border)",
                                            borderRadius: 6,
                                            color: "var(--text)",
                                            padding: "9px 10px",
                                        }}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {request.method === "confirm" && (
                    <div className="text-sm leading-6 text-text-muted">
                        {request.message}
                    </div>
                )}

                {request.method === "input" && (
                    <input
                        autoFocus
                        value={value}
                        placeholder={request.placeholder}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") submitValue();
                            if (e.key === "Escape") cancel();
                        }}
                        className="w-full text-sm outline-none"
                        style={{
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text)",
                            padding: "9px 10px",
                        }}
                    />
                )}

                {request.method === "editor" && (
                    <textarea
                        autoFocus
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") cancel();
                            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submitValue();
                        }}
                        rows={8}
                        className="w-full resize-none text-sm outline-none"
                        style={{
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text)",
                            padding: "9px 10px",
                        }}
                    />
                )}

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        onClick={cancel}
                        className="text-sm transition-colors hover:bg-[var(--bg-hover)]"
                        style={{
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text-muted)",
                            padding: "7px 12px",
                        }}
                    >
                        Cancel
                    </button>
                    {request.method === "confirm" ? (
                        <>
                            <button
                                onClick={() =>
                                    onResponse({
                                        type: "extension_ui_response",
                                        id: request.id,
                                        confirmed: false,
                                    })
                                }
                                className="text-sm transition-colors hover:bg-[var(--bg-panel)]"
                                style={{
                                    border: "1px solid var(--border)",
                                    borderRadius: 6,
                                    color: "var(--text)",
                                    padding: "7px 12px",
                                }}
                            >
                                No
                            </button>
                            <button
                                onClick={() =>
                                    onResponse({
                                        type: "extension_ui_response",
                                        id: request.id,
                                        confirmed: true,
                                    })
                                }
                                className="text-sm"
                                style={{
                                    border: "1px solid var(--accent)",
                                    borderRadius: 6,
                                    background: "var(--accent)",
                                    color: "white",
                                    padding: "7px 12px",
                                }}
                            >
                                Yes
                            </button>
                        </>
                    ) : request.method === "multiple" ? (
                        <button
                            onClick={submitMultiple}
                            disabled={!multipleAnswered}
                            className="text-sm"
                            style={{
                                border: "1px solid var(--accent)",
                                borderRadius: 6,
                                background: multipleAnswered
                                    ? "var(--accent)"
                                    : "var(--bg-selected)",
                                color: multipleAnswered
                                    ? "white"
                                    : "var(--text-muted)",
                                padding: "7px 12px",
                                cursor: multipleAnswered
                                    ? "pointer"
                                    : "not-allowed",
                            }}
                        >
                            {multipleAnswered ? "提交" : "请完成所有问题"}
                        </button>
                    ) : request.method !== "select" ? (
                        <button
                            onClick={submitValue}
                            className="text-sm"
                            style={{
                                border: "1px solid var(--accent)",
                                borderRadius: 6,
                                background: "var(--accent)",
                                color: "white",
                                padding: "7px 12px",
                            }}
                        >
                            Submit
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    </div>
    );
}

export function ChatWindow({
                               session,
                               newSessionCwd,
                               onAgentStart,
                               onAgentEnd,
                               onStreamingChange,
                               onSessionCreated,
                               onSessionContent,
                               onSessionForked,
                               modelsRefreshKey,
                               chatInputRef,
                               onBranchDataChange,
                               onSystemPromptChange,
                           }: Props) {
    const {
        loading,
        error,
        messages,
        entryIds,
        streamState,
        agentRunning,
        modelNames,
        modelList,
        toolPreset,
        retryInfo,
        contextUsage,
        forkingEntryId,
        isCompacting,
        compactError,
        isHandoffRunning,
        handoffError,
        displayModel: displayModelValue,
        sessionStats,
        agentPhase,
        isNew,
        isAborting,
        sseState,
        loopWarning,
        pendingUiRequest,
        uiNotice,
        messagesEndRef,
        scrollContainerRef,
        lastUserMsgRef,
        handleSend,
        handleAbort,
        handleFork,
        handleNavigate,
        handleModelChange,
        handleCompact,
        handleHandoff,
        handleSteer,
        handleFollowUp,
        handleAbortCompaction,
        handleToolPresetChange,
        handleAgentEventRef,
        clearLoopWarning,
        handleExtensionUIResponse,
        clearUiNotice,
    } = useAgentSession({
        session,
        newSessionCwd,
        onAgentStart,
        onAgentEnd,
        onSessionCreated,
        onSessionContent,
        onSessionForked,
        modelsRefreshKey,
        onBranchDataChange,
        onSystemPromptChange,
    });

    const {soundEnabled, onSoundToggle, playDoneSound} = useAudio();
    const playDoneSoundRef = useRef(playDoneSound);
    playDoneSoundRef.current = playDoneSound;
    const soundEnabledRef = useRef(soundEnabled);
    soundEnabledRef.current = soundEnabled;

    const autoScrollLockedRef = useRef(false);
    // 用户上滚后显示「滚动到底部」按钮，贴底时隐藏
    const [showScrollBottom, setShowScrollBottom] = useState(false);

    // 判断是否贴底：同时驱动自动滚动锁定 + 滚动按钮显隐
    const checkAtBottom = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const distanceToBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
        const atBottom = distanceToBottom <= 15; // Set lock to true ONLY if extremely close to bottom
        autoScrollLockedRef.current = atBottom;
        setShowScrollBottom(!atBottom);
    }, [scrollContainerRef]);

    // 消息增减 / 流式状态 / 加载完成后重新评估按钮显隐
    // （滚动监听本身挂在 div 的 onScroll 上，避免 loading 阶段早期返回导致 ref 为空时监听装不上）
    useEffect(() => {
        checkAtBottom();
    }, [messages.length, streamState.isStreaming, loading, checkAtBottom]);

    const scrollToBottomBtn = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        el.scrollTo({top: el.scrollHeight, behavior: "smooth"});
    }, [scrollContainerRef]);

    // Handle auto-scroll locks dynamically during model tokens streaming
    useEffect(() => {
        if (streamState.isStreaming) {
            const el = scrollContainerRef.current;
            if (!el) return;

            const adjustScroll = () => {
                // Calculate the live distance to bottom from current DOM state
                const distanceToBottom =
                    el.scrollHeight - el.clientHeight - el.scrollTop;
                const isCurrentlyAtBottom = distanceToBottom <= 15;

                // If the user has scrolled up, lock auto-scroll to false and don't scroll
                if (!isCurrentlyAtBottom) {
                    autoScrollLockedRef.current = false;
                    return;
                }

                // Only scroll to bottom if autoScrollLockedRef.current (meaning they were at bottom or opted to)
                if (autoScrollLockedRef.current) {
                    const scrollTarget = el.scrollHeight - el.clientHeight;
                    const currentScroll = el.scrollTop;
                    if (scrollTarget - currentScroll > 2) {
                        el.scrollTo({top: scrollTarget, behavior: "auto"});
                    }
                }
            };

            const rId = requestAnimationFrame(adjustScroll);
            return () => cancelAnimationFrame(rId);
        }
    }, [
        streamState.streamingMessage,
        streamState.isStreaming,
        scrollContainerRef,
    ]);

    // Wrap agent event handler to play sound on agent_end
    const origHandler = handleAgentEventRef.current;
    useEffect(() => {
        handleAgentEventRef.current = (event) => {
            if (event.type === "agent_end" && soundEnabledRef.current) {
                playDoneSoundRef.current();
            }
            origHandler?.(event);
        };
    }, [origHandler, handleAgentEventRef]);

    const onDrop = useCallback(
        (files: File[]) => {
            chatInputRef?.current?.addImages(files);
        },
        [chatInputRef],
    );

    const {
        isDragOver,
        handleDragEnter,
        handleDragOver,
        handleDragLeave,
        handleDrop,
    } = useDragDrop(onDrop);

    const visibleMessages = messages.filter(
        (m) => m.role === "user" || m.role === "assistant",
    );
    const messageRefs = useMessageRefs(visibleMessages.length);

    // Report this session's streaming state to the shell so the sidebar can
    // suppress its terminal dot while it is actually running (no polling).
    useEffect(() => {
        onStreamingChange?.(agentRunning ? (session?.id ?? null) : null);
    }, [agentRunning, session?.id, onStreamingChange]);

    const isEmptyNew =
        isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;

    const chatInputElement = (
        <ChatInput
            ref={chatInputRef}
            onSend={handleSend}
            onAbort={handleAbort}
            onSteer={agentRunning ? handleSteer : undefined}
            onFollowUp={agentRunning ? handleFollowUp : undefined}
            isStreaming={agentRunning}
            cwd={session?.cwd ?? newSessionCwd ?? null}
            model={displayModelValue}
            modelNames={modelNames}
            modelList={modelList}
            onModelChange={handleModelChange}
            onCompact={session || isNew ? handleCompact : undefined}
            onHandoff={session || isNew ? handleHandoff : undefined}
            onAbortCompaction={handleAbortCompaction}
            isCompacting={isCompacting}
            compactError={compactError}
            isHandoffRunning={isHandoffRunning}
            handoffError={handoffError}
            toolPreset={toolPreset}
            onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
            retryInfo={retryInfo}
            soundEnabled={soundEnabled}
            onSoundToggle={onSoundToggle}
            isAborting={isAborting}
            sseState={sseState}
            sessionStats={sessionStats}
            contextUsage={contextUsage}
        />
    );

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center text-text-muted">
                Loading session...
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-full items-center justify-center text-red-400">
                {error}
            </div>
        );
    }

    return (
        <div
            className="relative flex h-full flex-col overflow-hidden"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {isDragOver && (
                <div
                    className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[rgba(37,99,235,0.06)] backdrop-blur-[1px]">
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        {[0, 0.8, 1.6].map((delay) => (
                            <div
                                key={delay}
                                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[rgba(37,99,235,0.5)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                                style={{
                                    transformOrigin: "center",
                                    animationDelay: `${delay}s`,
                                }}
                            />
                        ))}
                    </div>
                    <svg
                        width="280"
                        height="280"
                        viewBox="0 0 140 140"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="drop-shadow-[0_6px_18px_rgba(37,99,235,0.18)]"
                    >
                        <rect
                            x="28"
                            y="44"
                            width="84"
                            height="60"
                            rx="8"
                            fill="rgba(37,99,235,0.08)"
                            stroke="rgba(37,99,235,0.50)"
                            strokeWidth="1.8"
                        />
                        <path
                            d="M36 100 L54 72 L68 88 L80 74 L104 100Z"
                            fill="rgba(37,99,235,0.16)"
                            stroke="rgba(37,99,235,0.40)"
                            strokeWidth="1.4"
                            strokeLinejoin="round"
                        />
                        <circle
                            cx="96"
                            cy="58"
                            r="8"
                            fill="rgba(37,99,235,0.22)"
                            stroke="rgba(37,99,235,0.55)"
                            strokeWidth="1.6"
                        />
                        <g
                            stroke="rgba(37,99,235,0.45)"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                        >
                            <line x1="96" y1="46" x2="96" y2="43"/>
                            <line x1="96" y1="70" x2="96" y2="73"/>
                            <line x1="84" y1="58" x2="81" y2="58"/>
                            <line x1="108" y1="58" x2="111" y2="58"/>
                            <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
                            <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
                            <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
                            <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
                        </g>
                    </svg>
                </div>
            )}

            {isEmptyNew ? (
                <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
                    <div className="w-full max-w-[820px]">
                        <div
                            className="mb-3"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                                marginLeft: 16,
                                marginRight: 52,
                                fontFamily: "var(--font-mono)",
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "baseline",
                                    gap: 10,
                                    minWidth: 0,
                                    flex: 1,
                                    lineHeight: 1.4,
                                }}
                            >
								<span
                                    style={{
                                        fontSize: 28,
                                        fontWeight: 700,
                                        letterSpacing: "-0.02em",
                                        color: "var(--text)",
                                    }}
                                >
									π
								</span>
                                <span
                                    style={{
                                        fontSize: 22,
                                        color: "var(--text)",
                                        fontWeight: 700,
                                        letterSpacing: "-0.01em",
                                    }}
                                >
									my-pi-web
								</span>
                                <span
                                    style={{
                                        fontSize: 14,
                                        minWidth: 0,
                                        overflow: "hidden",
                                        whiteSpace: "nowrap",
                                        textOverflow: "ellipsis",
                                    }}
                                >
									<Typewriter phrases={TYPEWRITER_PHRASES}/>
								</span>
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "flex-end",
                                    gap: 2,
                                    flexShrink: 0,
                                }}
                            >
								<span style={{fontSize: 11, color: "var(--text-muted)"}}>
									web{" "}
                                    <span style={{color: "var(--text)"}}>
										v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}
									</span>
								</span>
                                <span style={{fontSize: 11, color: "var(--text-muted)"}}>
									pi{" "}
                                    <span style={{color: "var(--text)"}}>
										v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}
									</span>
								</span>
                            </div>
                        </div>

                        {/* 当前工作目录指示:明确告知这条新会话将跑在哪个项目目录 */}
                        {newSessionCwd && (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    margin: "0 16px 14px",
                                    padding: "7px 12px",
                                    border: "1px solid var(--border)",
                                    borderRadius: 7,
                                    background: "var(--bg-hover)",
                                }}
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="var(--accent)"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ flexShrink: 0 }}
                                >
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                </svg>
                                <span
                                    style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: "var(--text-dim)",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.05em",
                                        flexShrink: 0,
                                    }}
                                >
                                    Work in
                                </span>
                                <span
                                    style={{
                                        fontSize: 12,
                                        fontFamily: "var(--font-mono)",
                                        color: "var(--text)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        minWidth: 0,
                                    }}
                                    title={newSessionCwd}
                                >
                                    {newSessionCwd}
                                </span>
                            </div>
                        )}

                        {chatInputElement}
                    </div>
                </div>
            ) : (
                <>
                    <div className="relative flex flex-1 overflow-hidden">
                        <div
                            ref={scrollContainerRef}
                            onScroll={checkAtBottom}
                            className="flex-1 overflow-y-auto pt-4 [scrollbar-width:none]"
                            style={{
                                contain: "content",
                                willChange: "transform",
                            }}
                        >
                            <div className="mx-auto max-w-[820px] px-4">
                                {(() => {
                                    const toolResultsMap = new Map<
                                        string,
                                        import("@/lib/types").ToolResultMessage
                                    >();
                                    for (const msg of messages) {
                                        if (msg.role === "toolResult") {
                                            toolResultsMap.set(
                                                (msg as import("@/lib/types").ToolResultMessage)
                                                    .toolCallId,
                                                msg as import("@/lib/types").ToolResultMessage,
                                            );
                                        }
                                    }
                                    let lastUserIdx = -1;
                                    for (let i = messages.length - 1; i >= 0; i--) {
                                        if (messages[i].role === "user") {
                                            lastUserIdx = i;
                                            break;
                                        }
                                    }
                                    let refIdx = 0;
                                    return messages.map((msg, idx) => {
                                        const prevAssistantEntryId =
                                            msg.role === "user" &&
                                            idx > 0 &&
                                            messages[idx - 1].role === "assistant"
                                                ? entryIds[idx - 1]
                                                : undefined;
                                        const isVisible =
                                            msg.role === "user" || msg.role === "assistant";
                                        const currentRefIdx = isVisible ? refIdx++ : -1;
                                        let showTimestamp = false;
                                        if (msg.role === "assistant") {
                                            showTimestamp = true;
                                            for (let j = idx + 1; j < messages.length; j++) {
                                                const r = messages[j].role;
                                                if (r === "user") break;
                                                if (r === "assistant") {
                                                    showTimestamp = false;
                                                    break;
                                                }
                                            }
                                            // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                                            if (
                                                showTimestamp &&
                                                streamState.isStreaming &&
                                                idx === messages.length - 1
                                            ) {
                                                showTimestamp = false;
                                            }
                                        }
                                        const view = (
                                            <MessageView
                                                key={idx}
                                                message={msg}
                                                toolResults={toolResultsMap}
                                                modelNames={modelNames}
                                                toolContext={{
                                                    sessionId: session?.id,
                                                    cwd: session?.cwd ?? newSessionCwd ?? undefined,
                                                }}
                                                entryId={entryIds[idx]}
                                                onFork={
                                                    agentRunning ||
                                                    isNew ||
                                                    (idx === 0 && msg.role === "user")
                                                        ? undefined
                                                        : handleFork
                                                }
                                                forking={forkingEntryId === entryIds[idx]}
                                                onNavigate={agentRunning ? undefined : handleNavigate}
                                                prevAssistantEntryId={
                                                    agentRunning ? undefined : prevAssistantEntryId
                                                }
                                                onEditContent={(content) =>
                                                    chatInputRef?.current?.insertIfEmpty(content)
                                                }
                                                showTimestamp={showTimestamp}
                                                prevTimestamp={
                                                    idx > 0
                                                        ? (
                                                            messages[
                                                            idx - 1
                                                                ] as import("@/lib/types").AgentMessage & {
                                                                timestamp?: number;
                                                            }
                                                        ).timestamp
                                                        : undefined
                                                }
                                            />
                                        );
                                        if (!isVisible) return view;
                                        return (
                                            <div
                                                key={idx}
                                                ref={(el) => {
                                                    messageRefs.current[currentRefIdx] = el;
                                                    if (idx === lastUserIdx) {
                                                        (
                                                            lastUserMsgRef as {
                                                                current: HTMLDivElement | null;
                                                            }
                                                        ).current = el;
                                                    }
                                                }}
                                            >
                                                {view}
                                            </div>
                                        );
                                    });
                                })()}

                                {streamState.isStreaming && streamState.streamingMessage && (
                                    <MessageView
                                        message={streamState.streamingMessage as AgentMessage}
                                        isStreaming
                                        modelNames={modelNames}
                                    />
                                )}

                                {agentRunning && !streamState.streamingMessage && (
                                    <div className="py-2 text-[13px] text-text-muted">
										<span className="animate-[pulse_1.5s_infinite]">
											{phaseLabel(agentPhase)}
										</span>
                                    </div>
                                )}

                                {agentRunning && <div style={{height: "140px"}}/>}

                                <div ref={messagesEndRef} style={{height: "40px"}}/>
                            </div>
                        </div>

                        <ChatMinimap
                            messages={messages}
                            streamingMessage={streamState.streamingMessage}
                            scrollContainer={scrollContainerRef}
                            messageRefs={messageRefs}
                        />

                        {/* 一键滚动到底部按钮：用户上滚后浮现，贴底时自动隐藏 */}
                        {showScrollBottom && (
                            <button
                                onClick={scrollToBottomBtn}
                                title="滚动到底部"
                                aria-label="滚动到底部"
                                style={{
                                    position: "absolute",
                                    bottom: 16,
                                    left: "50%",
                                    transform: "translateX(-50%)",
                                    zIndex: 40,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: 32,
                                    height: 32,
                                    padding: 0,
                                    borderRadius: "50%",
                                    border: "1px solid var(--border)",
                                    background: "var(--bg-panel)",
                                    color: "var(--text-muted)",
                                    cursor: "pointer",
                                    boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
                                    transition: "color 0.12s, background 0.12s",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.color = "var(--text)";
                                    e.currentTarget.style.background = "var(--bg-hover)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.color = "var(--text-muted)";
                                    e.currentTarget.style.background = "var(--bg-panel)";
                                }}
                            >
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="6 9 12 15 18 9"/>
                                </svg>
                            </button>
                        )}
                    </div>

                    <div className="relative">
                        {loopWarning && (
                            <div
                                className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-all ${
                                    loopWarning.level === "hard"
                                        ? "bg-red-500/15 text-red-400 border-t border-red-500/30"
                                        : loopWarning.level === "strong"
                                            ? "bg-yellow-500/15 text-yellow-400 border-t border-yellow-500/30"
                                            : "bg-blue-500/10 text-blue-400 border-t border-blue-500/20"
                                }`}
                            >
                                <span className="flex-1">{loopWarning.message}</span>
                                <span className="text-xs opacity-60">
									重复 {loopWarning.count} 次
								</span>
                                {loopWarning.level === "hard" && (
                                    <button
                                        onClick={clearLoopWarning}
                                        className="ml-2 rounded px-2 py-0.5 text-xs hover:bg-white/10"
                                    >
                                        知道了
                                    </button>
                                )}
                            </div>
                        )}
                        {uiNotice && (
                            <div
                                className={`flex items-center gap-3 border-t px-4 py-2.5 text-sm ${
                                    uiNotice.type === "error"
                                        ? "border-red-500/30 bg-red-500/15 text-red-400"
                                        : uiNotice.type === "warning"
                                            ? "border-yellow-500/30 bg-yellow-500/15 text-yellow-400"
                                            : "border-blue-500/20 bg-blue-500/10 text-blue-400"
                                }`}
                            >
                                <span className="flex-1">{uiNotice.message}</span>
                                <button
                                    onClick={clearUiNotice}
                                    className="rounded px-2 py-0.5 text-xs hover:bg-white/10"
                                >
                                    Close
                                </button>
                            </div>
                        )}
                        {pendingUiRequest && (
                            <ExtensionUIDialog
                                request={pendingUiRequest}
                                onResponse={handleExtensionUIResponse}
                            />
                        )}
                        {chatInputElement}
                    </div>
                </>
            )}
        </div>
    );
}

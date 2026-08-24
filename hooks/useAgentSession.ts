"use client";

import { useState, useCallback, useRef, useEffect, useReducer } from "react";
import type { AgentMessage, SessionInfo, SessionTreeNode } from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { sendAgentCommand } from "@/lib/agent-client";
import { appendCompletedMessage } from "@/lib/agent-message-merge";
import { shouldReconnect } from "@/lib/event-channel";
import { pushPendingDialog, removePendingDialog } from "@/lib/pending-dialogs";
import type { ToolEntry } from "@/components/ToolPanel";

export type {
  SessionData,
  ExtensionUIRequest,
  ExtensionUIResponse,
  AgentPhase,
  UseAgentSessionOptions,
  ChatInputHandle,
  AttachedImage,
  AgentEvent,
} from "@/lib/agent-session-types";
export { streamReducer, isDialogUiRequest, textOfMessage, extractHandoffPackage } from "@/lib/agent-session-types";
import {
  streamReducer,
  isDialogUiRequest,
  textOfMessage,
  extractHandoffPackage,
  type SessionData,
  type ExtensionUIRequest,
  type ExtensionUIResponse,
  type AgentPhase,
  type UseAgentSessionOptions,
  type ChatInputHandle,
  type AttachedImage,
  type AgentEvent,
} from "@/lib/agent-session-types";

export function useAgentSession(opts: UseAgentSessionOptions) {
	const {
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
	} = opts;

	const isNew = session === null && newSessionCwd !== null;
	const browseOnly = session?.browseOnly ?? false;

	const [data, setData] = useState<SessionData | null>(null);
	const [loading, setLoading] = useState(!isNew);
	const [error, setError] = useState<string | null>(null);
	const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
	const [messages, setMessages] = useState<AgentMessage[]>([]);
	const [entryIds, setEntryIds] = useState<string[]>([]);
	const [streamState, dispatch] = useReducer(streamReducer, {
		isStreaming: false,
		streamingMessage: null,
	});
	const [agentRunning, setAgentRunning] = useState(false);
	const [modelNames, setModelNames] = useState<Record<string, string>>({});
	const [modelList, setModelList] = useState<
		{
			id: string;
			name: string;
			provider: string;
			contextWindow?: number;
			api?: string;
		}[]
	>([]);
	const [modelThinkingLevels, setModelThinkingLevels] = useState<
		Record<string, string[]>
	>({});
	const [newSessionModel, setNewSessionModelState] = useState<{
		provider: string;
		modelId: string;
	} | null>(null);
	const [toolPreset, setToolPreset] = useState<"none" | "default" | "full">(
		"default",
	);
	const [retryInfo, setRetryInfo] = useState<{
		attempt: number;
		maxAttempts: number;
		errorMessage?: string;
	} | null>(null);
	const [contextUsage, setContextUsage] = useState<{
		percent: number | null;
		contextWindow: number;
		tokens: number | null;
	} | null>(null);
	const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
	const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
	const [currentModelOverride, setCurrentModelOverride] = useState<{
		provider: string;
		modelId: string;
	} | null>(null);
	const [pendingModel, setPendingModel] = useState<{
		provider: string;
		modelId: string;
	} | null>(null);
	const [isCompacting, setIsCompacting] = useState(false);
	const [compactError, setCompactError] = useState<string | null>(null);
	const [isHandoffRunning, setIsHandoffRunning] = useState(false);
	const [handoffError, setHandoffError] = useState<string | null>(null);
	const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
	const [isAborting, setIsAborting] = useState(false);
	const [sseState, setSseState] = useState<
		"connecting" | "connected" | "disconnected"
	>("disconnected");
	const [loopWarning, setLoopWarning] = useState<{
		level: "soft" | "strong" | "hard";
		message: string;
		count: number;
	} | null>(null);
	const [pendingUiRequests, setPendingUiRequests] = useState<Array<
		Extract<
			ExtensionUIRequest,
			{ method: "select" | "confirm" | "input" | "editor" | "multiple" }
		>
	>>([]);
	const [uiNotice, setUiNotice] = useState<{
		message: string;
		type?: "info" | "warning" | "error";
	} | null>(null);

	const eventSourceRef = useRef<EventSource | null>(null);
	// Read-only live follow of a subagent child session (separate SSE from the parent stream).
	const childSourceRef = useRef<EventSource | null>(null);
	const sessionIdRef = useRef<string | null>(session?.id ?? null);
	// Notify the shell once per session when its first assistant message lands on disk,
	// so the session list refreshes as soon as the new session file exists (not only at agent_end).
	const sessionContentNotifiedRef = useRef<Set<string>>(new Set());
	const agentRunningRef = useRef(false);
	const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(
		null,
	);
	const initialScrollDoneRef = useRef(false);
	const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
	const pendingScrollToUserRef = useRef(false);
	const messagesEndRef = useRef<HTMLDivElement | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	// handleAgentEvent is memoized with stable deps, so it must read the latest
	// handleSend / currentModel through refs to avoid stale-closure bugs (the
	// auto-retry '继续' path and the error-message model label would otherwise
	// use values captured from an old render).
	const handleSendRef = useRef<
		| ((message: string, images?: AttachedImage[], opts?: {
				bypassRunning?: boolean;
			}) => Promise<void>)
		| null
	>(null);
	// Handoff flow coordination: set when the Handoff button kicks off the skill;
	// the next agent_end (and captured `# 任务交接包` block) triggers a fresh session.
	const pendingHandoffRef = useRef(false);
	const handoffPackageRef = useRef<string | null>(null);
	const createHandoffSessionRef = useRef<
		((pkg: string) => Promise<void>) | null
	>(null);
	const currentModelRef = useRef<{
		provider: string;
		modelId: string;
	} | null>(null);

	const setNewSessionModel = opts.setNewSessionModel ?? setNewSessionModelState;
	const setToolPresetState = opts.setToolPreset ?? setToolPreset;

	const currentModel =
		currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
	currentModelRef.current = currentModel;
	const displayModel = isNew ? newSessionModel : currentModel;

	const sessionStats = (() => {
		const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		let cost = 0;
		for (const msg of messages) {
			if (msg.role !== "assistant") continue;
			const u = (msg as import("@/lib/types").AssistantMessage).usage;
			if (!u) continue;
			tokens.input += u.input ?? 0;
			tokens.output += u.output ?? 0;
			tokens.cacheRead += u.cacheRead ?? 0;
			tokens.cacheWrite += u.cacheWrite ?? 0;
			cost += u.cost?.total ?? 0;
		}
		const total =
			tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
		return total > 0 ? { tokens, cost } : null;
	})();

	// context 占用 = 最后一次真实模型响应时 provider 上报的 prompt token，
	// 而不是把所有回合的 usage.input 累加（那会随轮次无限增长、把每轮整段上下文当消耗）。
	// 各家语义不同：anthropic/bedrock 的 usage.input 已含缓存；
	// openai/gemini 等把缓存拆到 cacheRead/cacheWrite，需加回才算完整 prompt。
	// 活会话运行时（getState/SSE 给的 contextUsage）若标记“未知”（如刚压缩完、尚无真实用量），保持未知态。
	const derivedContextUsage = (() => {
		// 运行时明确“未知”：自动压缩后尚无新的真实用量，拿旧值冒充会虚高，保持显示空
		if (contextUsage && contextUsage.tokens === null) return contextUsage;
		const cm = currentModel;
		if (!cm) return null;
		const found = modelList.find(
			(m) => m.id === cm.modelId && m.provider === cm.provider,
		);
		const win = found?.contextWindow;
		if (!win || win <= 0) return null;
		// 倒序找最后一条带真实用量(>0)的 assistant 消息
		let tokens: number | null = null;
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant") continue;
			const u = (m as import("@/lib/types").AssistantMessage).usage;
			if (!u) continue;
			const input = u.input ?? 0;
			const cache = (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
			if (input + cache <= 0) continue;
			const inputHasCache =
				found?.api === "anthropic-messages" ||
				found?.api === "bedrock-converse-stream";
			tokens = input + (inputHasCache ? 0 : cache);
			break;
		}
		if (tokens === null) {
			// 尚无真实用量（如刚开跑、第一条还在流式）→退回运行时估算，避免误显示“未知”
			if (contextUsage && contextUsage.tokens != null) tokens = contextUsage.tokens;
			else return null;
		}
		const percent = (tokens / win) * 100;
		return { percent, contextWindow: win, tokens };
	})();

	const loadSession = useCallback(
		async (sid: string, showLoading = false, includeState = false) => {
			try {
				if (showLoading) setLoading(true);
				const url = includeState
					? `/api/sessions/${encodeURIComponent(sid)}?includeState`
					: `/api/sessions/${encodeURIComponent(sid)}`;
				const res = await fetch(url);
				if (res.status === 404) {
					if (showLoading) {
						setData(null);
						setActiveLeafId(null);
						setMessages([]);
						setError(null);
					}
					return null;
				}
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const d = (await res.json()) as SessionData & {
					agentState?: {
						running: boolean;
						state?: {
							isStreaming?: boolean;
							isCompacting?: boolean;
							contextUsage?: {
								percent: number | null;
								contextWindow: number;
								tokens: number | null;
							} | null;
							systemPrompt?: string;
							thinkingLevel?: string;
						};
					};
				};
				setData(d);
				setActiveLeafId(d.leafId);
				setMessages(d.context.messages);
				setEntryIds(d.context.entryIds ?? []);
				setCurrentModelOverride(null);
				setError(null);
				return d.agentState ?? null;
			} catch (e) {
				setError(String(e));
				return null;
			} finally {
				if (showLoading) setLoading(false);
			}
		},
		[],
	);

	const loadContext = useCallback(
		async (sid: string, leafId: string | null) => {
			try {
				const url = leafId
					? `/api/sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`
					: `/api/sessions/${encodeURIComponent(sid)}/context`;
				const res = await fetch(url);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const d = (await res.json()) as {
					context: { messages: AgentMessage[]; entryIds: string[] };
				};
				setMessages(d.context.messages);
				setEntryIds(d.context.entryIds ?? []);
			} catch (e) {
				console.error("Failed to load context:", e);
			}
		},
		[],
	);

	const loadTools = useCallback(
		async (sid: string) => {
			try {
				const tools = await sendAgentCommand<ToolEntry[]>(sid, {
					type: "get_tools",
				});
				if (tools) {
					const { getPresetFromTools } = await import("@/components/ToolPanel");
					setToolPresetState(getPresetFromTools(tools));
				}
			} catch (e) {
				console.error("Failed to load tools:", e);
			}
		},
		[setToolPresetState],
	);

	const sseReconnectAttemptRef = useRef<number>(0);
	const sseReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const connectEvents = useCallback((sid: string) => {
		if (eventSourceRef.current) {
			eventSourceRef.current.close();
			eventSourceRef.current = null;
		}
		if (sseReconnectTimerRef.current) {
			clearTimeout(sseReconnectTimerRef.current);
			sseReconnectTimerRef.current = null;
		}
		setSseState("connecting");
		const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
		eventSourceRef.current = es;

		es.onopen = () => {
			setSseState("connected");
			sseReconnectAttemptRef.current = 0; // 重置重连计数器
		};

		es.onmessage = (e) => {
			try {
				const event = JSON.parse(e.data) as AgentEvent;
				handleAgentEventRef.current?.(event);
			} catch {
				// ignore
			}
		};
		es.onerror = () => {
			setSseState("disconnected");
			if (shouldReconnect(eventSourceRef.current === es)) {
				es.close();
				eventSourceRef.current = null;

				// 只要当前连接掉线就须重连（指数退避限频）：事件通道不能依赖
				// 「当时是否正在运行」，通道必须始终在，question 等事件才递得到。
				const attempt = sseReconnectAttemptRef.current;
				const delay = Math.min(1000 * Math.pow(2, attempt), 16000);

				sseReconnectAttemptRef.current += 1;
				setSseState("connecting");

				sseReconnectTimerRef.current = setTimeout(() => {
					connectEvents(sid);
				}, delay);
			}
		};
	}, []);

	useEffect(() => {
		agentRunningRef.current = agentRunning;
	}, [agentRunning]);

	// ---- Read-only live follow of a subagent child session -----------------------
	// The child runs in its own pi process and writes its own session file; we tail
	// it via /api/subagents/[id]/events (a browse-only channel). No commands are ever
	// sent, so this can never start or steer the child agent.
	const connectChildEvents = useCallback((sid: string) => {
		if (childSourceRef.current) {
			childSourceRef.current.close();
			childSourceRef.current = null;
		}
		setSseState("connecting");
		const es = new EventSource(`/api/subagents/${encodeURIComponent(sid)}/events`);
		childSourceRef.current = es;
		es.onopen = () => setSseState("connected");
		es.onmessage = (e) => {
			try {
				const event = JSON.parse(e.data) as Partial<{
					type: string;
					messages?: AgentMessage[];
					running?: boolean;
				}>;
				if (event.type === "child_update") {
					const msgs = event.messages ?? [];
					if (msgs.length > 0) {
						setMessages((prev) =>
							msgs.reduce((acc, m) => appendCompletedMessage(acc, normalizeToolCalls(m)), prev),
						);
						dispatch({ type: "start" });
					}
					setAgentRunning(Boolean(event.running));
				} else if (event.type === "child_terminal") {
					setAgentRunning(false);
					dispatch({ type: "end" });
					setSseState("disconnected");
					// 子代理结束：关闭只读通道，避免连接泄漏。
					if (childSourceRef.current) {
						childSourceRef.current.close();
						childSourceRef.current = null;
					}
				}
			} catch {
				// ignore malformed frames
			}
		};
		es.onerror = () => setSseState("disconnected");
	}, []);

	const handleAgentEvent = useCallback(
		(event: AgentEvent) => {
			switch (event.type) {
				case "agent_start":
					setAgentRunning(true);
					setIsAborting(false);
					setAgentPhase({ kind: "waiting_model" });
					dispatch({ type: "start" });
					onAgentStart?.();
					break;
				case "agent_end":
					setAgentRunning(false);
					setIsAborting(false);
					setAgentPhase(null);
					setRetryInfo(null);
					dispatch({ type: "end" });
					if (sessionIdRef.current) {
						loadSession(sessionIdRef.current);
						fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
							.then((r) => r.json())
							.then(
								(d: {
									state?: {
										contextUsage?: {
											percent: number | null;
											contextWindow: number;
											tokens: number | null;
										} | null;
										systemPrompt?: string;
									};
								}) => {
									if (d.state?.contextUsage !== undefined)
										setContextUsage(d.state.contextUsage ?? null);
									if (d.state?.systemPrompt !== undefined)
										setSystemPrompt(d.state.systemPrompt ?? null);
								},
							)
							.catch(() => {});
					}
					onAgentEnd?.();
					// If this turn was a Handoff run, spin up a fresh session seeded with the package.
					if (pendingHandoffRef.current) {
						pendingHandoffRef.current = false;
						const pkg = handoffPackageRef.current;
						handoffPackageRef.current = null;
						if (pkg) {
							void createHandoffSessionRef.current?.(pkg);
						} else {
							setIsHandoffRunning(false);
							setHandoffError("在回复中未找到 `# 任务交接包` 代码块");
						}
					}
					break;
				case "message_start":
				case "message_update": {
					const msg = event.message as Partial<AgentMessage> | undefined;
					if (msg) {
						dispatch({
							type: "update",
							message: normalizeToolCalls(msg as AgentMessage),
						});
					}
					// The new session's .jsonl file is only written once the first assistant
					// message is appended. Signal that moment so the list refreshes immediately.
					const sid = sessionIdRef.current;
					if (sid && !sessionContentNotifiedRef.current.has(sid)) {
						sessionContentNotifiedRef.current.add(sid);
						onSessionContent?.();
					}
					setAgentPhase(null);
					break;
				}
				case "message_end": {
					const completed = event.message as AgentMessage | undefined;
					if (completed) {
						setMessages((prev) =>
							appendCompletedMessage(prev, normalizeToolCalls(completed)),
						);

						// 检测到可重试的错误时自动发送"继续"。这里必须绕过 handleSend 的
						// `agentRunning` 守卫：message_end 触发时 agent 仍标记为 running，
						// 若走普通路径会被拦截而静默无操作。（改走 handleSendRef 以拿到最新闭包）
						if (
							completed.role === "assistant" &&
							completed.stopReason === "error" &&
							completed.errorMessage &&
							/Provider finish_reason: error/i.test(completed.errorMessage)
						) {
							console.log("Detected provider error, auto-retrying with '继续'");
							setTimeout(() => {
								handleSendRef.current?.("继续", undefined, {
									bypassRunning: true,
								});
							}, 1000);
						}
					}
					// Capture the generated handoff package (assistant message during a Handoff run).
					if (pendingHandoffRef.current && completed?.role === "assistant") {
						const pkg = extractHandoffPackage(textOfMessage(completed));
						if (pkg) handoffPackageRef.current = pkg;
					}
					dispatch({ type: "reset" });
					setAgentPhase({ kind: "waiting_model" });
					break;
				}
				case "tool_execution_start": {
					const id = event.toolCallId as string;
					const name = event.toolName as string;
					setAgentPhase((prev) => {
						const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
						if (!tools.some((t) => t.id === id)) tools.push({ id, name });
						return { kind: "running_tools", tools };
					});
					break;
				}
				case "tool_execution_end": {
					const id = event.toolCallId as string;
					setAgentPhase((prev) => {
						if (prev?.kind !== "running_tools") return prev;
						const tools = prev.tools.filter((t) => t.id !== id);
						if (tools.length === 0) return { kind: "waiting_model" };
						return { kind: "running_tools", tools };
					});
					break;
				}
				case "auto_retry_start":
					setRetryInfo({
						attempt: event.attempt as number,
						maxAttempts: event.maxAttempts as number,
						errorMessage: event.errorMessage as string | undefined,
					});
					break;
				case "auto_retry_end":
					setRetryInfo(null);
					break;
				case "auto_compaction_start":
				case "compaction_start":
					setIsCompacting(true);
					setCompactError(null);
					break;
				case "auto_compaction_end":
				case "compaction_end":
					setIsCompacting(false);
					if (event.errorMessage) {
						setCompactError(event.errorMessage as string);
					} else if (!event.aborted) {
						if (sessionIdRef.current) {
							loadSession(sessionIdRef.current);
							// Fetch updated contextUsage after compaction
							fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
								.then((r) => r.json())
								.then(
									(d: {
										state?: {
											contextUsage?: {
												percent: number | null;
												contextWindow: number;
												tokens: number | null;
											} | null;
											systemPrompt?: string;
										};
									}) => {
										if (d.state?.contextUsage !== undefined)
											setContextUsage(d.state.contextUsage ?? null);
									},
								)
								.catch(() => {});
						}
					}
					break;
				case "loop_detection": {
					const level = event.level as "soft" | "strong" | "hard";
					const message = event.message as string;
					const count = event.count as number;
					setLoopWarning({ level, message, count });

					// Auto-clear soft warnings after 5 seconds
					if (level === "soft") {
						setTimeout(() => setLoopWarning(null), 5000);
					}
					// Auto-clear strong warnings after 10 seconds
					if (level === "strong") {
						setTimeout(() => setLoopWarning(null), 10000);
					}
					// Hard warnings stay until user dismisses
					break;
				}
				case "extension_ui_request": {
					const request = event as ExtensionUIRequest;
					if (isDialogUiRequest(request)) {
						// 入队而非覆盖：未答弹窗绝不被新请求顶掉，作答后才按 id 移除。
						setPendingUiRequests((prev) =>
							pushPendingDialog(prev, request),
						);
						break;
					}
					if (request.method === "notify") {
						setUiNotice({ message: request.message, type: request.notifyType });
						setTimeout(
							() => setUiNotice(null),
							request.notifyType === "error" ? 8000 : 4500,
						);
						break;
					}
					if (request.method === "set_editor_text") {
						opts.chatInputRef?.current?.insertIfEmpty(request.text);
						break;
					}
					if (request.method === "setTitle" && request.title) {
						document.title = request.title;
					}
					break;
				}
				case "error": {
					// prompt() 在产生任何消息前失败（模型/网络错误等）时，后端会推此事件。
					// 必须复位运行状态，否则界面会一直卡在"运行中"且用户看不到原因。
					const errMsg = (event.message as string) || "未知错误";
					setAgentRunning(false);
					setIsAborting(false);
					setAgentPhase(null);
					dispatch({ type: "end" });
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content: [{ type: "text", text: `⚠️ 模型请求失败：${errMsg}` }],
							model: currentModelRef.current?.modelId ?? "",
							provider: currentModelRef.current?.provider ?? "",
							stopReason: "error",
							errorMessage: errMsg,
							timestamp: Date.now(),
						} as AgentMessage,
					]);
					break;
				}
			}
		},
		[loadSession, onAgentEnd, onAgentStart, onSessionContent],
	);
	handleAgentEventRef.current = handleAgentEvent;

	const handleSend = useCallback(
		async (
			message: string,
			images?: AttachedImage[],
			opts?: { bypassRunning?: boolean },
		) => {
			if (browseOnly) return; // 子代理子会话只读，禁止发送
			if (!message.trim() && !images?.length) return;
			// bypassRunning lets the auto-retry ('继续') send while the agent is still
			// marked running at message_end; a normal user send must still be guarded.
			if (agentRunning && !opts?.bypassRunning) return;

			const imageBlocks = images?.map((img) => ({
				type: "image" as const,
				source: {
					type: "base64" as const,
					media_type: img.mimeType,
					data: img.data,
				},
			}));
			const userMsg: AgentMessage = {
				role: "user",
				content: imageBlocks?.length
					? [
							...(message.trim()
								? [{ type: "text" as const, text: message }]
								: []),
							...imageBlocks,
						]
					: message,
				timestamp: Date.now(),
			};
			setMessages((prev) => [...prev, userMsg]);
			setAgentRunning(true);
			setAgentPhase({ kind: "waiting_model" });
			dispatch({ type: "start" });
			pendingScrollToUserRef.current = true;

			const piImages = images?.map((img) => ({
				type: "image" as const,
				data: img.data,
				mimeType: img.mimeType,
			}));

			try {
				if (isNew && newSessionCwd) {
					const selectedModel = newSessionModel;
					if (selectedModel) setPendingModel(selectedModel);
					const maxThinkingLevel = selectedModel
						? modelThinkingLevels[
								`${selectedModel.provider}:${selectedModel.modelId}`
							]
						: undefined;
					// thinking 开关打开（模型支持推理）时取该模型最高档；否则不传
					const sendableLevel =
						maxThinkingLevel && maxThinkingLevel.length > 1
							? maxThinkingLevel[maxThinkingLevel.length - 1]
							: undefined;
					const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL } = await import(
						"@/components/ToolPanel"
					);
					const toolNames =
						toolPreset === "none"
							? PRESET_NONE
							: toolPreset === "default"
								? PRESET_DEFAULT
								: PRESET_FULL;
					const res = await fetch("/api/agent/new", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							cwd: newSessionCwd,
							type: "create",
							toolNames,
							...(selectedModel
								? {
										provider: selectedModel.provider,
										modelId: selectedModel.modelId,
									}
								: {}),
							...(sendableLevel ? { thinkingLevel: sendableLevel } : {}),
						}),
					});
					if (!res.ok) {
						let detail = "";
						try {
							const errorBody = (await res.json()) as { error?: string };
							detail = errorBody.error ? `: ${errorBody.error}` : "";
						} catch {
							// ignore non-JSON error responses
						}
						throw new Error(`HTTP ${res.status}${detail}`);
					}
					const result = (await res.json()) as { sessionId: string };
					const realId = result.sessionId;
					sessionIdRef.current = realId;
					connectEvents(realId);
					await sendAgentCommand(realId, {
						type: "prompt",
						message,
						...(piImages?.length ? { images: piImages } : {}),
					});
					onSessionCreated?.({
						id: realId,
						path: "",
						cwd: newSessionCwd,
						name: undefined,
						created: new Date().toISOString(),
						modified: new Date().toISOString(),
						messageCount: 1,
						firstMessage: message,
						lastMessage: message,
					});
				} else if (session) {
					connectEvents(session.id);
					await sendAgentCommand(session.id, {
						type: "prompt",
						message,
						...(piImages?.length ? { images: piImages } : {}),
					});
				}
			} catch (e) {
				console.error("Failed to send message:", e);
				setAgentRunning(false);
				setAgentPhase(null);
				dispatch({ type: "end" });
			}
		},
		[
			isNew,
			newSessionCwd,
			newSessionModel,
			toolPreset,
			modelThinkingLevels,
			session,
			browseOnly,
			agentRunning,
			connectEvents,
			onSessionCreated,
		],
	);
	handleSendRef.current = handleSend;

	const handleAbort = useCallback(async () => {
		if (browseOnly) return; // 子代理子会话只读，禁止中止
		const sid = sessionIdRef.current;
		if (!sid) return;
		setIsAborting(true);
		try {
			await sendAgentCommand(sid, { type: "abort" });
		} catch (e) {
			console.error("Failed to abort:", e);
			setIsAborting(false);
		}
	}, [browseOnly]);

	const handleFork = useCallback(
		async (entryId: string) => {
			if (browseOnly) return; // 子代理子会话只读，禁止 fork
			const sid = sessionIdRef.current;
			if (!sid) return;
			setForkingEntryId(entryId);
			try {
				const result = await sendAgentCommand<{
					cancelled?: boolean;
					newSessionId?: string;
				}>(sid, {
					type: "fork",
					entryId,
				});
				const { cancelled, newSessionId } = result ?? {};
				if (!cancelled && newSessionId) {
					onSessionForked?.(newSessionId);
				}
			} catch (e) {
				console.error("Fork failed:", e);
			} finally {
				setForkingEntryId(null);
			}
		},
		[browseOnly, onSessionForked],
	);

	const handleNavigate = useCallback(
		async (entryId: string) => {
			if (browseOnly) return; // 子代理子会话只读，禁止 navigate_tree
			const sid = sessionIdRef.current;
			if (!sid) return;
			sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(
				() => {},
			);
			setActiveLeafId(entryId);
			await loadContext(sid, entryId);
		},
		[browseOnly, loadContext],
	);

	const handleLeafChange = useCallback(
		async (leafId: string | null) => {
			if (browseOnly) return; // 子代理子会话只读，禁止 navigate_tree
			setActiveLeafId(leafId);
			const sid = sessionIdRef.current;
			if (!sid) return;
			await loadContext(sid, leafId);
			if (leafId) {
				sendAgentCommand(sid, {
					type: "navigate_tree",
					targetId: leafId,
				}).catch(() => {});
			}
		},
		[browseOnly, loadContext],
	);

	const handleModelChange = useCallback(
		async (provider: string, modelId: string) => {
			if (browseOnly) return; // 子代理子会话只读，禁止 set_model
			if (isNew) {
				setNewSessionModel({ provider, modelId });
				return;
			}
			const sid = sessionIdRef.current;
			if (!sid) return;
			try {
				await sendAgentCommand(sid, { type: "set_model", provider, modelId });
				setCurrentModelOverride({ provider, modelId });
			} catch (e) {
				console.error("Failed to set model:", e);
			}
		},
		[browseOnly, isNew, setNewSessionModel],
	);

	const handleCompact = useCallback(async () => {
		if (browseOnly) return; // 子代理子会话只读，禁止 compact
		const sid = sessionIdRef.current;
		if (!sid || isCompacting) return;
		setIsCompacting(true);
		setCompactError(null);
		try {
			await sendAgentCommand(sid, { type: "compact" });
			await loadSession(sid, true);
			// Fetch updated contextUsage after compaction
			fetch(`/api/agent/${encodeURIComponent(sid)}`)
				.then((r) => r.json())
				.then(
					(d: {
						state?: {
							contextUsage?: {
								percent: number | null;
								contextWindow: number;
								tokens: number | null;
							} | null;
							systemPrompt?: string;
						};
					}) => {
						if (d.state?.contextUsage !== undefined)
							setContextUsage(d.state.contextUsage ?? null);
					},
				)
				.catch(() => {});
		} catch (e) {
			setCompactError(e instanceof Error ? e.message : String(e));
		} finally {
			setIsCompacting(false);
		}
	}, [browseOnly, isCompacting, loadSession]);

	const handleSteer = useCallback(
		async (message: string, images?: AttachedImage[]) => {
			if (browseOnly) return; // 子代理子会话只读，禁止 steer
			const sid = sessionIdRef.current;
			if (!sid) return;
			setMessages((prev) => [
				...prev,
				{
					role: "user",
					content: `[steer] ${message}`,
					timestamp: Date.now(),
				} as AgentMessage,
			]);
			const piImages = images?.map((img) => ({
				type: "image" as const,
				data: img.data,
				mimeType: img.mimeType,
			}));
			try {
				await sendAgentCommand(sid, {
					type: "steer",
					message,
					...(piImages?.length ? { images: piImages } : {}),
				});
			} catch (e) {
				console.error("Failed to steer:", e);
			}
		},
		[browseOnly],
	);

	const handleFollowUp = useCallback(
		async (message: string, images?: AttachedImage[]) => {
			if (browseOnly) return; // 子代理子会话只读，禁止 follow_up
			const sid = sessionIdRef.current;
			if (!sid) return;
			setMessages((prev) => [
				...prev,
				{
					role: "user",
					content: message,
					timestamp: Date.now(),
				} as AgentMessage,
			]);
			const piImages = images?.map((img) => ({
				type: "image" as const,
				data: img.data,
				mimeType: img.mimeType,
			}));
			try {
				await sendAgentCommand(sid, {
					type: "follow_up",
					message,
					...(piImages?.length ? { images: piImages } : {}),
				});
			} catch (e) {
				console.error("Failed to follow up:", e);
			}
		},
		[browseOnly],
	);

	const handleAbortCompaction = useCallback(async () => {
		if (browseOnly) return; // 子代理子会话只读，禁止 abort_compaction
		const sid = sessionIdRef.current;
		if (!sid) return;
		try {
			await sendAgentCommand(sid, { type: "abort_compaction" });
		} catch (e) {
			console.error("Failed to abort compaction:", e);
		}
	}, [browseOnly]);

	/**
	 * After a Handoff run finishes, create a brand-new session and seed it with the
	 * extracted `# 任务交接包` package as its first user message, then switch to it.
	 */
	const createHandoffSession = useCallback(
		async (pkg: string) => {
			const cwd = session?.cwd ?? newSessionCwd;
			if (!cwd) {
				setIsHandoffRunning(false);
				setHandoffError("无法确定新会话的工作目录");
				return;
			}
			const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL } = await import(
				"@/components/ToolPanel"
			);
			const toolNames =
				toolPreset === "none"
					? PRESET_NONE
					: toolPreset === "default"
						? PRESET_DEFAULT
						: PRESET_FULL;
			try {
				const res = await fetch("/api/agent/new", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						cwd,
						type: "create",
						toolNames,
						...(newSessionModel
							? {
									provider: newSessionModel.provider,
									modelId: newSessionModel.modelId,
								}
							: {}),
					}),
				});
				if (!res.ok) {
					let detail = "";
					try {
						const errorBody = (await res.json()) as { error?: string };
						detail = errorBody.error ? `: ${errorBody.error}` : "";
					} catch {
						// ignore non-JSON error responses
					}
					throw new Error(`HTTP ${res.status}${detail}`);
				}
				const result = (await res.json()) as { sessionId: string };
				const realId = result.sessionId;
				sessionIdRef.current = realId;
				connectEvents(realId);
				await sendAgentCommand(realId, { type: "prompt", message: pkg });
				// Reposition into the fresh session; the remount will reload it from disk.
				setMessages([
					{ role: "user", content: pkg, timestamp: Date.now() } as AgentMessage,
				]);
				onSessionCreated?.({
					id: realId,
					path: "",
					cwd,
					name: undefined,
					created: new Date().toISOString(),
					modified: new Date().toISOString(),
					messageCount: 1,
					firstMessage: pkg,
					lastMessage: pkg,
				});
			} catch (e) {
				setHandoffError(e instanceof Error ? e.message : String(e));
			} finally {
				setIsHandoffRunning(false);
			}
		},
		[
			session?.cwd,
			newSessionCwd,
			newSessionModel,
			toolPreset,
			connectEvents,
			onSessionCreated,
		],
	);
	createHandoffSessionRef.current = createHandoffSession;

	/** Invoke the handoff skill on the current session; the new session is spun up on agent_end. */
	const handleHandoff = useCallback(async () => {
		const sid = sessionIdRef.current;
		if (!sid || agentRunning || isHandoffRunning) return;
		setIsHandoffRunning(true);
		setHandoffError(null);
		pendingHandoffRef.current = true;
		handoffPackageRef.current = null;
		await handleSendRef.current?.(
			"/handoff 请为当前唯一主任务生成交接包：正文以 `# 任务交接包` 标题开头，直接作为 Markdown 正文输出完整交接包（不要用代码围栏包裹，不要反问）。",
			undefined,
			{ bypassRunning: true },
		);
	}, [agentRunning, isHandoffRunning]);

	const handleExtensionUIResponse = useCallback(
		async (response: ExtensionUIResponse) => {
			const sid = sessionIdRef.current;
			if (!sid) return;
			// 先确保答案送达服务器、再从队列移除：若删在前 POST 又失败，弹窗就没了而问题
			// 仍在服务器等答——违背「有未答问题就必须弹窗」。成功后才移除，失败则保留
			// 弹窗让用户可重试。
			try {
				await sendAgentCommand(sid, response);
				setPendingUiRequests((prev) => removePendingDialog(prev, response.id));
			} catch (e) {
				console.error("Failed to send extension UI response:", e);
			}
		},
		[],
	);

	const handleToolPresetChange = useCallback(
		async (preset: "none" | "default" | "full") => {
			if (browseOnly) return; // 子代理子会话只读，禁止 set_tools
			const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL } = await import(
				"@/components/ToolPanel"
			);
			const toolNames =
				preset === "none"
					? PRESET_NONE
					: preset === "default"
						? PRESET_DEFAULT
						: PRESET_FULL;
			setToolPresetState(preset);
			const sid = sessionIdRef.current;
			if (!sid) return;
			try {
				await sendAgentCommand(sid, { type: "set_tools", toolNames });
			} catch (e) {
				console.error("Failed to set tools:", e);
			}
		},
		[browseOnly, setToolPresetState],
	);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		messagesEndRef.current?.scrollIntoView({ behavior });
	}, []);

	const scrollUserMsgToTop = useCallback(() => {
		const container = scrollContainerRef.current;
		const el = lastUserMsgRef.current;
		if (!container || !el) return;
		const elAbsTop =
			el.getBoundingClientRect().top -
			container.getBoundingClientRect().top +
			container.scrollTop;
		container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
	}, []);

	// Keep the mutable session id ref in sync even if the ChatWindow key
	// does not change (defensive: ensures commands like UI responses go to
	// the right session).
	useEffect(() => {
		sessionIdRef.current = session?.id ?? null;
	}, [session]);

	// Load session when session changes
	useEffect(() => {
		if (session) {
			sessionIdRef.current = session.id;
			loadSession(session.id, true, true).then((agentState) => {
				if (session.browseOnly) {
					// 子代理子会话：只读实时跟随，绝非可交互 RPC 会话，不建普通事件通道。
					connectChildEvents(session.id);
				} else {
					if (agentState?.running) {
						loadTools(session.id);
						if (agentState.state?.isStreaming) {
							setAgentRunning(true);
							setAgentPhase({ kind: "waiting_model" });
						}
					}
					// 挂载即无条件建立事件通道，不依赖挂载瞬间 running 快照：多会话并发
					// 切换时快照可能为 false，据此不建通道会让本会话 question 被服务端缓存
					// 却永无监听器重放 → 弹窗不触发。服务端对无监听器时的 dialog 有缓冲重放。
					connectEvents(session.id);
				}
				if (agentState?.state) {
					if (agentState.state.isCompacting !== undefined)
						setIsCompacting(agentState.state.isCompacting);
					if (agentState.state.contextUsage !== undefined)
						setContextUsage(agentState.state.contextUsage ?? null);
					if (agentState.state.systemPrompt !== undefined)
						setSystemPrompt(agentState.state.systemPrompt ?? null);
				}
			});
		}
		return () => {
			if (eventSourceRef.current) {
				eventSourceRef.current.close();
				eventSourceRef.current = null;
			}
			if (childSourceRef.current) {
				childSourceRef.current.close();
				childSourceRef.current = null;
			}
			if (sseReconnectTimerRef.current) {
				clearTimeout(sseReconnectTimerRef.current);
				sseReconnectTimerRef.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		onSystemPromptChange?.(systemPrompt);
	}, [systemPrompt, onSystemPromptChange]);

	useEffect(() => {
		if (!onBranchDataChange) return;
		onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
	}, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

	useEffect(() => {
		if (messages.length > 0) {
			if (pendingScrollToUserRef.current) {
				pendingScrollToUserRef.current = false;
				initialScrollDoneRef.current = true;
				scrollUserMsgToTop();
			} else if (!initialScrollDoneRef.current) {
				initialScrollDoneRef.current = true;
				scrollToBottom("instant");
			} else if (!agentRunningRef.current) {
				scrollToBottom("smooth");
			}
		}
	}, [messages.length, agentRunning, scrollToBottom, scrollUserMsgToTop]);

	// Load model list
	useEffect(() => {
		fetch("/api/models")
			.then((r) => r.json())
			.then(
				(d: {
					models: Record<string, string>;
					modelList?: {
						id: string;
						name: string;
						provider: string;
						contextWindow?: number;
						api?: string;
					}[];
					defaultModel?: { provider: string; modelId: string } | null;
					thinkingLevels?: Record<string, string[]>;
				}) => {
					setModelNames(d.models);
					if (d.thinkingLevels) setModelThinkingLevels(d.thinkingLevels);
					if (d.modelList) {
						setModelList(d.modelList);
						if (isNew && d.modelList.length > 0) {
							const def = d.defaultModel;
							const match =
								def &&
								d.modelList.find(
									(m) => m.id === def.modelId && m.provider === def.provider,
								);
							const selected = match
								? { provider: match.provider, modelId: match.id }
								: {
										provider: d.modelList[0].provider,
										modelId: d.modelList[0].id,
									};
							setNewSessionModel(selected);
						}
					}
				},
			)
			.catch(() => {});
	}, [isNew, modelsRefreshKey, setNewSessionModel]);

	// Compact error auto-dismiss
	useEffect(() => {
		if (!compactError) return;
		const t = setTimeout(() => setCompactError(null), 3000);
		return () => clearTimeout(t);
	}, [compactError]);

	const clearLoopWarning = useCallback(() => {
		setLoopWarning(null);
	}, []);

	const clearUiNotice = useCallback(() => {
		setUiNotice(null);
	}, []);

	return {
		// State
		data,
		loading,
		error,
		activeLeafId,
		messages,
		entryIds,
		streamState,
		agentRunning,
		modelNames,
		modelList,
		modelThinkingLevels,
		newSessionModel,
		toolPreset,
		retryInfo,
		contextUsage: derivedContextUsage,
		systemPrompt,
		forkingEntryId,
		isCompacting,
		compactError,
		isHandoffRunning,
		handoffError,
		currentModel,
		displayModel,
		sessionStats,
		agentPhase,
		isNew,
		browseOnly,
		isAborting,
		sseState,
		loopWarning,
		pendingUiRequests,
		uiNotice,
		// Refs
		sessionIdRef,
		eventSourceRef,
		messagesEndRef,
		scrollContainerRef,
		lastUserMsgRef,
		pendingScrollToUserRef,
		initialScrollDoneRef,
		// Actions
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
		loadTools,
		setActiveLeafId,
		setData,
		setMessages,
		dispatch,
		setAgentRunning,
		setForkingEntryId,
		clearLoopWarning,
		handleExtensionUIResponse,
		clearUiNotice,
		// Subscriptions
		handleAgentEventRef,
	};
}


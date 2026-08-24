import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	RpcExtensionUIResponse,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	defineTool,
	getAgentDir,
	SessionManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	applyCompactionOverride,
	assertNotCompacting,
	readAutoCompactThreshold,
} from "./compaction-override";
import { Type } from "typebox";
import {
  cacheSessionPath,
  getSessionEntries,
  resolveLeafUnansweredQuestion,
  type RehydratedQuestion,
} from "./session-reader";
import type { AgentSessionLike, ToolInfo } from "./pi-types";
import { composeActiveTools } from "./tool-composition";
import {
	resolveQuestionParts,
	type ResolvedQuestionPart,
} from "./question-options";

// ============================================================================
// Loop Detection Constants
// ============================================================================

/** Thresholds for loop detection */
const LOOP_SOFT_WARNING_THRESHOLD = 3; // First warning: inject hint for model to reflect
const LOOP_STRONG_WARNING_THRESHOLD = 5; // Second warning: stronger hint
const LOOP_HARD_STOP_THRESHOLD = 10; // Hard stop: abort and notify user

/** Similarity threshold for thinking content (0-1) */
const THINKING_SIMILARITY_THRESHOLD = 0.85;

const RPC_EXTENSION_STARTUP_TIMEOUT_MS = 5_000;

/** 会话空闲回收阈值（无事件且无未答 dialog 时销毁 wrapper）。测试/复现可覆写缩短（默认 10 分钟）。 */
let idleDestroyMs = 10 * 60 * 1000;
export function __setIdleDestroyMs(ms: number): void {
	idleDestroyMs = ms;
}
// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
	type: string;
	[key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

type PendingExtensionRequest = {
	requestEvent: AgentEvent;
	resolve: (response: RpcExtensionUIResponse) => void;
	reject: (error: unknown) => void;
};

type ExtensionRunnerLike = {
	extensions?: Array<{
		path?: string;
		handlers?: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	}>;
};

const RPC_THEME = new Theme(
	{
		accent: "#38bdf8",
		border: "#64748b",
		borderAccent: "#38bdf8",
		borderMuted: "#475569",
		success: "#22c55e",
		error: "#ef4444",
		warning: "#f59e0b",
		muted: "#94a3b8",
		dim: "#64748b",
		text: "#e5e7eb",
		thinkingText: "#a78bfa",
		userMessageText: "#e5e7eb",
		customMessageText: "#e5e7eb",
		customMessageLabel: "#38bdf8",
		toolTitle: "#38bdf8",
		toolOutput: "#cbd5e1",
		mdHeading: "#f8fafc",
		mdLink: "#38bdf8",
		mdLinkUrl: "#7dd3fc",
		mdCode: "#fbbf24",
		mdCodeBlock: "#cbd5e1",
		mdCodeBlockBorder: "#475569",
		mdQuote: "#cbd5e1",
		mdQuoteBorder: "#64748b",
		mdHr: "#64748b",
		mdListBullet: "#38bdf8",
		toolDiffAdded: "#22c55e",
		toolDiffRemoved: "#ef4444",
		toolDiffContext: "#94a3b8",
		syntaxComment: "#64748b",
		syntaxKeyword: "#c084fc",
		syntaxFunction: "#38bdf8",
		syntaxVariable: "#e5e7eb",
		syntaxString: "#86efac",
		syntaxNumber: "#fbbf24",
		syntaxType: "#67e8f9",
		syntaxOperator: "#94a3b8",
		syntaxPunctuation: "#94a3b8",
		thinkingOff: "#64748b",
		thinkingMinimal: "#22c55e",
		thinkingLow: "#84cc16",
		thinkingMedium: "#f59e0b",
		thinkingHigh: "#fb7185",
		thinkingXhigh: "#c084fc",
		// 0.81.1 新增的主题色键
		thinkingMax: "#e879f9",
		bashMode: "#38bdf8",
	},
	{
		selectedBg: "#1e293b",
		userMessageBg: "#0f172a",
		customMessageBg: "#111827",
		toolPendingBg: "#1e293b",
		toolSuccessBg: "#052e16",
		toolErrorBg: "#450a0a",
	},
	"truecolor",
	{ name: "pi-web-rpc" },
);

function textResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: undefined };
}

export function guardRpcExtensionStartupHandlers(
	runner: ExtensionRunnerLike | undefined,
	timeoutMs = RPC_EXTENSION_STARTUP_TIMEOUT_MS,
): void {
	if (!runner?.extensions) return;
	for (const ext of runner.extensions) {
		for (const eventName of ["session_start", "resources_discover"]) {
			const handlers = ext.handlers?.get(eventName);
			if (!handlers?.length) continue;
			ext.handlers?.set(
				eventName,
				handlers.map((handler) => async (event: unknown, ctx: unknown) => {
					let timeoutId: ReturnType<typeof setTimeout> | undefined;
					try {
						return await Promise.race([
							Promise.resolve(handler(event, ctx)),
							new Promise<never>((_resolve, reject) => {
								timeoutId = setTimeout(() => {
									reject(
										new Error(
											`RPC extension startup handler timed out after ${timeoutMs}ms`,
										),
									);
								}, timeoutMs);
							}),
						]);
					} finally {
						if (timeoutId) clearTimeout(timeoutId);
					}
				}),
			);
		}
	}
}


const uiQuestionParameters = Type.Object({
	title: Type.Optional(Type.String({ description: "Dialog title" })),
	header: Type.Optional(Type.String({ description: "Short dialog header" })),
	question: Type.Optional(
		Type.String({ description: "Question to ask the user" }),
	),
	message: Type.Optional(
		Type.String({ description: "Message to show the user" }),
	),
	placeholder: Type.Optional(
		Type.String({ description: "Input placeholder text" }),
	),
	options: Type.Optional(
		Type.Array(Type.Any(), {
			description: "Selectable options as strings or objects with labels",
		}),
	),
	questions: Type.Optional(
		Type.Array(Type.Any(), { description: "Codex-style question objects" }),
	),
});

export function createCompatUiTools(): ToolDefinition[] {
	const executeQuestion = async (
		_toolCallId: string,
		rawParams: Record<string, unknown>,
		_signal: AbortSignal | undefined,
		_onUpdate: unknown,
		ctx: { ui: ExtensionUIContext },
	) => {
		// 多问（questions[] 长度 > 1）：一次弹窗展示全部问题，后端按序拿回答案数组；
		// 单问走原 select/input 路径不变。
		//
		// 刻意不把工具调用的 abort signal 传下去：question 的语义是「必须由人来答」。
		// 若因模型/回合中断导致 signal 提前 abort，createDialogPromise 会在入口静默
		// resolve 掉、连请求都不 emit（弹窗永不出现），或在中途移除 pending——都违背
		// 「未答的问题必须弹窗」这一铁律。每次都先把弹窗发出去并保持 pending，直到
		// 用户作答；会话 wrapper 销毁时 pending 自会消失，不会永久孤儿。
		const parts = resolveQuestionParts(rawParams);
		if (parts.length > 1) {
			const answers = await (ctx.ui as UiContextWithMultiple).multiple(parts);
			if (answers === undefined) return textResult("User cancelled.");
			const lines = parts.map(
				(part, i) => `${part.question} -> ${answers[i] ?? ""}`,
			);
			return textResult(`User answered:\n${lines.join("\n")}`);
		}

		const part = parts[0];
		const value =
			part.options.length > 0
				? await ctx.ui.select(part.question, part.options)
				: await ctx.ui.input(part.question, part.placeholder);

		if (value === undefined) return textResult("User cancelled.");
		return textResult(
			part.options.length > 0
				? `User selected: ${value}`
				: `User answered: ${value}`,
		);
	};

	return [
		defineTool({
			name: "question",
			label: "Ask user",
			description:
				"Ask the user a question through the host UI and return their answer. " +
				"Use this (and only this) tool whenever you need a missing decision or value.",
			promptSnippet:
				"Ask the user a question when you need a missing decision or value.",
			parameters: uiQuestionParameters,
			execute: executeQuestion,
		}),
	];
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

// pi-web 自持 UI 上下文。在 SDK 泛型通道之上再暴露一个 `multiple`：把多个问题
// 一次性发成一个 extension_ui_request，前端单面板渲染后回 value: string[]。
type UiContextWithMultiple = ExtensionUIContext & {
	multiple: (
		questions: ResolvedQuestionPart[],
		opts?: ExtensionUIDialogOptions,
	) => Promise<string[] | undefined>;
};

export class AgentSessionWrapper {
	private listeners: EventListener[] = [];
	private unsubscribe: (() => void) | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private onDestroyCallback: (() => void) | null = null;
	private pendingExtensionRequests = new Map<string, PendingExtensionRequest>();
	private _alive = true;
	private lastNotifiedStreaming = false;

	// Loop detection state
	private loopDetection = {
		recentThinkings: [] as string[],
		consecutiveSimilar: 0,
		lastWarningLevel: 0, // 0=none, 1=soft, 2=strong
		isDisabled: false, // Temporarily disable after user intervention
	};

	constructor(public readonly inner: AgentSessionLike) {}

	get sessionId(): string {
		return this.inner.sessionId;
	}

	get sessionFile(): string {
		return this.inner.sessionFile ?? "";
	}

	isAlive(): boolean {
		return this._alive;
	}

	/** 仍等人在答的弹窗请求，供“有未答问题”徽标查询。 */
	get pendingDialogs(): AgentEvent[] {
		return Array.from(this.pendingExtensionRequests.values()).map(
			(p) => p.requestEvent,
		);
	}

	/**
	 * 跨进程恢复一个“未答 question”：上层进程在提问后被终止/重启，弹窗状态只活在
	 * 旧进程内存里，从未落盘。这里把会话文件里当前叶子悬空的 question 重新塞回
	 * pending，onEvent 重放 + getAllPendingDialogs 自动覆盖（弹窗重新弹出 + 徽标出现）。
	 * 作答时把答案作为一条 user 消息落回文件——既让答案持久化不再丢，也让该问题不再
	 * 是“最后一条 message”，避免下次打开又重复弹同一个问题。不自动 resume、不伪造
	 * toolResult；不做历史考古（只恢复当前叶子挂着的）。
	 */
	rehydrateUnansweredQuestion(recovered: RehydratedQuestion): void {
		const sessionManager = this.inner.sessionManager as unknown as {
			appendMessage?: (msg: {
				role: string;
				content: Array<{ type: string; text: string }>;
			}) => string;
		};
		const id = `rehydrate:${recovered.toolCallId}`;
		// 与 live 路径一致：multiple 用 questions[] 一次弹多问；select/input 用单问字段。
		const method = recovered.request.method;
		const requestEvent: AgentEvent = {
			type: "extension_ui_request",
			id,
			method,
			...(method === "multiple"
				? {
						title: recovered.request.title,
						questions: recovered.request.questions ?? [],
				  }
				: {
						title: recovered.request.title,
						question: recovered.request.question,
						placeholder: recovered.request.placeholder,
						...(recovered.request.options
							? { options: recovered.request.options }
							: {}),
				  }),
		};
		this.pendingExtensionRequests.set(id, {
			requestEvent,
			resolve: (response) => {
				this.pendingExtensionRequests.delete(id);
				const answer =
					response && "value" in response
						? (response.value as unknown)
						: undefined;
				// 取消（cancelled）或空答：不落任何消息，下次打开仍会恢复该问题。
				if (answer === undefined || answer === null) return;
				// multiple 的 value 是 string[]：逐问拼一行“问题 -> 答案”；单问就是字符串。
				let text: string;
				if (Array.isArray(answer)) {
					const qs = recovered.request.questions ?? [];
					text = qs
						.map((q, i) => `${q.question} -> ${answer[i] ?? ""}`)
						.join("\n");
				} else {
					text = String(answer);
				}
				try {
					sessionManager.appendMessage?.({
						role: "user",
						content: [{ type: "text", text }],
					});
				} catch (err) {
					console.error("[rpc-manager] append recovered answer failed:", err);
				}
			},
			reject: () => {
				this.pendingExtensionRequests.delete(id);
			},
		});
	}

	/**
	 * Reload model providers from the persisted models.json config.
	 *
	 * 会话创建时 ModelRuntime 只加载了一次 models.json 快照；用户在模型配置面板里
	 * 新增/修改/删除供应商后，运行中的会话不会自动感知。这里重新读取 models.json
	 * 并重建 provider 注册表，让新模型立即可用。
	 *
	 * reloadConfig() 内部 refresh 默认 allowNetwork=true（可能联网拉内置模型目录），
	 * 实测本环境约 270ms；加 8s 兜底超时，避免离线/受限环境把切模型请求无限挂起。
	 */
	async reloadModelConfig(): Promise<void> {
		const runtime = this.inner.modelRuntime;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				runtime.reloadConfig(),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(
						() =>
							reject(
								new Error(
									`Model config reload timed out after 8000ms (provider registry unchanged)`,
								),
							),
						8000,
					);
				}),
			]);
			// models.json 可能改了某模型的 contextWindow 或 autoCompactThreshold，
			// 重截后同步刷新自动压缩阈值（内存 override，不落盘）。
			this.applyModelCompactionOverride();
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	/**
	 * 按当前模型在 models.json 里配置的 autoCompactThreshold，
	 * 把自动压缩开关/预留量写进会话内存设置（applyOverrides 不落盘）。
	 * 没填/无效 → 显式关闭（覆盖 pi 默认开启）；详见 lib/compaction-override.ts。
	 * models.json 读取失败不影响会话（静默视为未配置）。
	 */
	applyModelCompactionOverride(): void {
		const model = this.inner.model;
		if (!model) return;
		const readModelsJsonEntry = (
			provider: string,
			modelId: string,
		): Record<string, unknown> | undefined => {
			try {
				const raw = JSON.parse(
					readFileSync(join(getAgentDir(), "models.json"), "utf8"),
				) as {
					providers?: Record<string, { models?: Record<string, unknown>[] }>;
				};
				return raw.providers?.[provider]?.models?.find(
					(m) => (m as { id?: string }).id === modelId,
				);
			} catch {
				return undefined;
			}
		};
		const threshold = readAutoCompactThreshold(
			model.provider,
			model.id,
			readModelsJsonEntry,
		);
		try {
			applyCompactionOverride(this.inner.settingsManager, {
				contextWindow: (model as { contextWindow?: number }).contextWindow,
				autoCompactThreshold: threshold,
			});
		} catch (err) {
			console.error("[rpc-manager] apply compaction override failed:", err);
		}
	}

	start(): void {
		this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
			this.resetIdleTimer();
			this.detectLoop(event);
			this.emit(event);
		});
		this.resetIdleTimer();
	}

	/**
	 * 会话状态点推送的节流阀：只把「开始跑/仍在跑/跑完了」这些列表级变化
	 * 转发给 onRpcSessionEvent 订阅者，纯文本增量等高频事件不转发。
	 * streaming 边沿（false→true / true→false）各转发一次，运行中的
	 * message/tool 事件至多每 3s 再转发一次，作为心跳兜底。
	 */
	private notifySessionListListeners(): void {
		const streaming = this.inner.isStreaming;
		const edge = streaming !== this.lastNotifiedStreaming;
		if (!edge && !streaming) return;
		const now = Date.now();
		if (!edge && now - this.lastSessionNotifyAt < 3000) return;
		if (edge) this.lastNotifiedStreaming = streaming;
		this.lastSessionNotifyAt = now;
		notifyRpcSessionEventListeners(this.sessionId, streaming);
	}

	private lastSessionNotifyAt = 0;

	private promptInFlight = false;

	emit(event: AgentEvent): void {
		void event; // 事件本体不用于列表通知；见 notifySessionListListeners 的节流逻辑
		this.notifySessionListListeners();
		for (const l of this.listeners) l(event);
	}

	private createDialogPromise<T>(
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Omit<AgentEvent, "type" | "id">,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				this.pendingExtensionRequests.delete(id);
			};
			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};

			opts?.signal?.addEventListener("abort", onAbort, { once: true });
			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}

			const requestEvent: AgentEvent = {
				type: "extension_ui_request",
				id,
				...request,
			};
			this.pendingExtensionRequests.set(id, {
				requestEvent,
				resolve: (response) => {
					cleanup();
					resolve(parseResponse(response));
				},
				reject,
			});
			this.emit(requestEvent);
		});
	}

	createExtensionUIContext(): UiContextWithMultiple {
		return {
			select: (title, options, opts) =>
				this.createDialogPromise(
					opts,
					undefined,
					{ method: "select", title, options, timeout: opts?.timeout },
					(response) =>
						"cancelled" in response && response.cancelled
							? undefined
							: "value" in response
								? response.value
								: undefined,
				),
			multiple: (
				questions: ResolvedQuestionPart[],
				opts?: ExtensionUIDialogOptions,
			) =>
				this.createDialogPromise<string[] | undefined>(
					opts,
					undefined,
					{
						method: "multiple",
						title: `请回答以下 ${questions.length} 个问题`,
						questions,
						timeout: opts?.timeout,
					},
					(response) => {
						if ("cancelled" in response && response.cancelled)
							return undefined;
						const v: unknown =
							"value" in response ? response.value : undefined;
						if (Array.isArray(v)) return v as string[];
						return undefined;
					},
				),
			confirm: (title, message, opts) =>
				this.createDialogPromise(
					opts,
					false,
					{ method: "confirm", title, message, timeout: opts?.timeout },
					(response) =>
						"cancelled" in response && response.cancelled
							? false
							: "confirmed" in response
								? response.confirmed
								: false,
				),
			input: (title, placeholder, opts) =>
				this.createDialogPromise(
					opts,
					undefined,
					{ method: "input", title, placeholder, timeout: opts?.timeout },
					(response) =>
						"cancelled" in response && response.cancelled
							? undefined
							: "value" in response
								? response.value
								: undefined,
				),
			notify: (message, type) => {
				this.emit({
					type: "extension_ui_request",
					id: randomUUID(),
					method: "notify",
					message,
					notifyType: type,
				});
			},
			onTerminalInput: () => () => {},
			setStatus: (key, text) => {
				this.emit({
					type: "extension_ui_request",
					id: randomUUID(),
					method: "setStatus",
					statusKey: key,
					statusText: text,
				});
			},
			setWorkingMessage: () => {},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: (key, content, options) => {
				if (content === undefined || Array.isArray(content)) {
					this.emit({
						type: "extension_ui_request",
						id: randomUUID(),
						method: "setWidget",
						widgetKey: key,
						widgetLines: content,
						widgetPlacement: options?.placement,
					});
				}
			},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: (title) => {
				this.emit({
					type: "extension_ui_request",
					id: randomUUID(),
					method: "setTitle",
					title,
				});
			},
			custom: async () => undefined,
			pasteToEditor: (text) => {
				this.emit({
					type: "extension_ui_request",
					id: randomUUID(),
					method: "set_editor_text",
					text,
				});
			},
			setEditorText: (text) => {
				this.emit({
					type: "extension_ui_request",
					id: randomUUID(),
					method: "set_editor_text",
					text,
				});
			},
			getEditorText: () => "",
			editor: (title, prefill) =>
				this.createDialogPromise(
					undefined,
					undefined,
					{ method: "editor", title, prefill },
					(response) =>
						"cancelled" in response && response.cancelled
							? undefined
							: "value" in response
								? response.value
								: undefined,
				),
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			theme: RPC_THEME,
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({
				success: false,
				error: "Theme switching not supported in pi-web",
			}),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		} as UiContextWithMultiple;
	}

	private resetIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		// 计时在「回调内」判 pending，而不是上膛时判：agent 发出 question 工具调用的那个
		// inner 事件已同步触发 resetIdleTimer 上膛，此时 pending 尚未填；到点后再看才是真的。
		// 有未答 dialog 时绝不 idle 回收：question 等人答是「最不该 destroy」的状态，
		// 一旦此时 destroy，pending 被 resolve(cancelled:true) 落成 toolResult「User cancelled.」,
		// 文件里的悬空 question 就被改写成已取消，恢复路径失效，弹窗永久消失。
		this.idleTimer = setTimeout(() => {
			if (this.pendingExtensionRequests.size > 0) {
				// 仍有人等着答：不清 destroy，重排 idle 再等 10 分钟（下次到点仍有未答则再重排）。
				this.resetIdleTimer();
				return;
			}
			this.destroy();
		}, idleDestroyMs);
	}

	/**
	 * Detect potential infinite loops by monitoring thinking content repetition.
	 * Uses soft interrupts (hints) first, then hard stop if pattern continues.
	 */
	private detectLoop(event: AgentEvent): void {
		// Only check assistant messages with thinking content
		if (event.type !== "message") return;
		const msg = event.message as Record<string, unknown> | undefined;
		if (!msg || msg.role !== "assistant") return;

		const content = msg.content as Array<Record<string, unknown>> | undefined;
		if (!Array.isArray(content)) return;

		// Extract thinking content
		const thinkingBlock = content.find((c) => c.type === "thinking");
		if (!thinkingBlock || typeof thinkingBlock.thinking !== "string") return;

		const currentThinking = thinkingBlock.thinking as string;

		// Skip if loop detection is temporarily disabled
		if (this.loopDetection.isDisabled) return;

		// Check similarity with recent thinkings
		const { recentThinkings } = this.loopDetection;
		let maxSimilarity = 0;

		for (const prev of recentThinkings) {
			const similarity = this.calculateSimilarity(currentThinking, prev);
			if (similarity > maxSimilarity) {
				maxSimilarity = similarity;
			}
		}

		// Update recent thinkings (keep last 5)
		recentThinkings.push(currentThinking);
		if (recentThinkings.length > 5) {
			recentThinkings.shift();
		}

		// Check if similar enough to count as repetition
		if (maxSimilarity >= THINKING_SIMILARITY_THRESHOLD) {
			this.loopDetection.consecutiveSimilar++;
		} else {
			// Reset counter if thinking is significantly different
			this.loopDetection.consecutiveSimilar = 0;
			this.loopDetection.lastWarningLevel = 0;
		}

		// Take action based on repetition count
		const count = this.loopDetection.consecutiveSimilar;

		if (count >= LOOP_HARD_STOP_THRESHOLD) {
			this.handleHardStop();
		} else if (
			count >= LOOP_STRONG_WARNING_THRESHOLD &&
			this.loopDetection.lastWarningLevel < 2
		) {
			this.handleStrongWarning();
		} else if (
			count >= LOOP_SOFT_WARNING_THRESHOLD &&
			this.loopDetection.lastWarningLevel < 1
		) {
			this.handleSoftWarning();
		}
	}

	/**
	 * Calculate similarity between two strings using simple token overlap.
	 * Returns a value between 0 (completely different) and 1 (identical).
	 */
	private calculateSimilarity(a: string, b: string): number {
		if (a === b) return 1;
		if (a.length < 10 || b.length < 10) return 0; // Too short to compare meaningfully

		// Normalize and tokenize
		const tokenize = (s: string) => {
			return s
				.toLowerCase()
				.replace(/[\n\r]+/g, " ")
				.split(/\s+/)
				.filter((t) => t.length > 1);
		};

		const tokensA = tokenize(a);
		const tokensB = tokenize(b);

		if (tokensA.length === 0 || tokensB.length === 0) return 0;

		// Count overlapping tokens
		const setB = new Set(tokensB);
		let matches = 0;
		for (const t of tokensA) {
			if (setB.has(t)) matches++;
		}

		// Jaccard-like similarity
		const union = new Set([...tokensA, ...tokensB]).size;
		return union > 0 ? matches / union : 0;
	}

	/**
	 * Soft warning: emit a hint event for the frontend to display.
	 * The model may or may not respond to this.
	 */
	private handleSoftWarning(): void {
		this.loopDetection.lastWarningLevel = 1;

		// Emit a warning event for the frontend
		const warningEvent: AgentEvent = {
			type: "loop_detection",
			level: "soft",
			message:
				"检测到可能的重复循环。如果任务已完成，请总结并停止；如果需要继续，请说明原因。",
			count: this.loopDetection.consecutiveSimilar,
		};

		this.emit(warningEvent);
	}

	/**
	 * Strong warning: emit a more urgent warning.
	 */
	private handleStrongWarning(): void {
		this.loopDetection.lastWarningLevel = 2;

		const warningEvent: AgentEvent = {
			type: "loop_detection",
			level: "strong",
			message:
				"⚠️ 检测到明显的重复循环模式！请立即停止当前操作，总结已完成的工作。",
			count: this.loopDetection.consecutiveSimilar,
		};

		this.emit(warningEvent);
	}

	/**
	 * Hard stop: abort the current generation and notify user.
	 */
	private handleHardStop(): void {
		// Emit hard stop event
		const stopEvent: AgentEvent = {
			type: "loop_detection",
			level: "hard",
			message: "🚫 检测到死循环，已自动中断。请检查任务状态后手动继续。",
			count: this.loopDetection.consecutiveSimilar,
		};

		this.emit(stopEvent);

		// Abort current generation
		this.inner.abort().catch(() => {});

		// Reset detection state
		this.loopDetection.consecutiveSimilar = 0;
		this.loopDetection.lastWarningLevel = 0;
		this.loopDetection.recentThinkings = [];
	}

	/**
	 * Reset loop detection state (call when user sends a new message).
	 */
	resetLoopDetection(): void {
		this.loopDetection.consecutiveSimilar = 0;
		this.loopDetection.lastWarningLevel = 0;
		this.loopDetection.recentThinkings = [];
		this.loopDetection.isDisabled = false;
	}

	/**
	 * Temporarily disable loop detection (e.g., when user explicitly confirms continuation).
	 */
	disableLoopDetection(): void {
		this.loopDetection.isDisabled = true;
	}

	/**
	 * Re-enable loop detection.
	 */
	enableLoopDetection(): void {
		this.loopDetection.isDisabled = false;
	}

	onEvent(listener: EventListener): () => void {
		// 新监听器连上时，把「所有仍等答的弹窗请求」重放给它。
		//
		// 以 pendingExtensionRequests（未答问题的权威集合）为准，而不是依赖 eventBuffer：
		// 一个问题若在「有监听器」时 live 投递，根本不会进缓冲；只有「最后一个监听器断开」
		// 那次重缓存才捞它。刷新/切换会话时若旧连接没有干净摘掉、新监听器就已挂上，
		// 该未答问题就既不在缓冲、又被新监听器错过 → 徽标在但点进去不弹。直接从权威集合
		// 重放，无论它此前是缓冲缓存还是 live 投递，只要还等答，新监听器就一定收到。
		const delivered = new Set<string>();
		for (const [id, pending] of this.pendingExtensionRequests) {
			if (delivered.has(id)) continue;
			delivered.add(id);
			listener(pending.requestEvent);
		}

		this.listeners.push(listener);
		return () => {
			const i = this.listeners.indexOf(listener);
			if (i !== -1) this.listeners.splice(i, 1);
		};
	}

	onDestroy(cb: () => void): void {
		this.onDestroyCallback = cb;
	}

	async send(command: Record<string, unknown>): Promise<unknown> {
		this.resetIdleTimer();
		const type = command.type as string;

		switch (type) {
			case "prompt": {
				// Guard against concurrent prompts on the same session (double submit /
				// rapid re-run): two `prompt()` calls on one inner agent would interleave
				// generation and corrupt the session's history.
				if (this.promptInFlight) throw new Error("Session is already running a prompt");
				// 压缩中禁止发送：压缩会重写会话历史，中途 prompt 会写到旧历史上。
				assertNotCompacting(this.inner.isCompacting);
				this.promptInFlight = true;
				// Reset loop detection when user sends a new message
				this.resetLoopDetection();
				// Fire and forget — events come via subscribe
				const promptImages = command.images as
					| Array<{ type: "image"; data: string; mimeType: string }>
					| undefined;
				this.inner
					.prompt(
						command.message as string,
						promptImages?.length ? { images: promptImages } : undefined,
					)
					.catch((err) => {
						// prompt() 在产生任何事件前失败时（如模型/网络错误），必须把错误暴露给前端，
						// 否则 SSE 流会静默空等到超时，表现为"聊天没反应"。
						console.error("[rpc-manager] prompt failed:", err);
						const errorEvent: AgentEvent = {
							type: "error",
							message: err instanceof Error ? err.message : String(err),
						};
						this.emit(errorEvent);
					})
					.finally(() => {
						// Keep the guard honest even when the wrapper is torn down meanwhile;
						// a dead wrapper's flag is irrelevant, but this also unblocks a live
						// session after any failure path.
						this.promptInFlight = false;
					});
				return null;
			}

			case "extension_ui_response": {
				const response = command as RpcExtensionUIResponse;
				const pending = this.pendingExtensionRequests.get(response.id);
				if (pending) {
					this.pendingExtensionRequests.delete(response.id);
					pending.resolve(response);
				}
				return null;
			}

			case "abort":
				await this.inner.abort();
				return null;

			case "get_state": {
				const model = this.inner.model;
				const contextUsage = this.inner.getContextUsage();
				return {
					sessionId: this.inner.sessionId,
					sessionFile: this.inner.sessionFile ?? "",
					isStreaming: this.inner.isStreaming,
					isCompacting: this.inner.isCompacting,
					autoCompactionEnabled: this.inner.autoCompactionEnabled,
					autoRetryEnabled: this.inner.autoRetryEnabled,
					model: model ? { id: model.id, provider: model.provider } : undefined,
					messageCount: 0,
					pendingMessageCount: 0,
					contextUsage: contextUsage
						? {
								percent: contextUsage.percent,
								contextWindow: contextUsage.contextWindow,
								tokens: contextUsage.tokens,
							}
						: null,
					systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
					thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
				};
			}

			case "set_model": {
				const { provider, modelId } = command as {
					provider: string;
					modelId: string;
				};
				// 0.81.1：modelRegistry → modelRuntime（getModel + reloadConfig）
				const runtime = this.inner.modelRuntime;
				let model = runtime.getModel(provider, modelId);
				if (!model) {
					// 会话创建时 runtime 持有的是当时的 models.json 快照；用户随后在模型配置
					// 面板新增/修改/删除供应商不会反映到运行中的会话，导致这里找不到模型。
					// reloadConfig() 重读 models.json 并重建注册表（新增/删除/改名都能生效），
					// 比 refresh({allowNetwork:false}) 只刷新已注册 provider 的目录更彻底。
					// 8s 兜底超时见 reloadModelConfig()。
					await this.reloadModelConfig();
					model = runtime.getModel(provider, modelId);
				}
				if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
				await this.inner.setModel(model);
				// 切了模型 → 按新模型的阈值重算自动压缩设置（每个模型阈值不同）。
				this.applyModelCompactionOverride();
				return { id: model.id, provider: model.provider };
			}

			case "fork": {
				const entryId = command.entryId as string;
				const sessionManager = this.inner.sessionManager;
				const currentSessionFile = this.inner.sessionFile;

				if (!sessionManager.isPersisted()) return { cancelled: true };
				if (!currentSessionFile)
					throw new Error("Persisted session is missing a session file");

				const entry = sessionManager.getEntry(entryId);
				if (!entry) throw new Error("Invalid entry ID for forking");

				const sessionDir = sessionManager.getSessionDir();
				let newSessionFile: string;

				if (!entry.parentId) {
					// Fork before the first message: create an empty session linked to this one
					const newManager = SessionManager.create(
						sessionManager.getCwd(),
						sessionDir,
					);
					newManager.newSession({ parentSession: currentSessionFile });
					newSessionFile = newManager.getSessionFile() as string;
				} else {
					// Fork after some history: copy path up to (but not including) the fork point
					const sourceManager = SessionManager.open(
						currentSessionFile,
						sessionDir,
					);
					const forkedPath = sourceManager.createBranchedSession(
						entry.parentId,
					);
					if (!forkedPath) throw new Error("Failed to create forked session");
					newSessionFile = forkedPath;
				}

				const newSessionId = SessionManager.open(
					newSessionFile,
					sessionDir,
				).getSessionId();
				cacheSessionPath(newSessionId, newSessionFile);
				this.destroy();
				return { cancelled: false, newSessionId };
			}

			case "navigate_tree": {
				const result = await this.inner.navigateTree(
					command.targetId as string,
					{},
				);
				return { cancelled: result.cancelled };
			}

			case "set_thinking_level": {
				const level = command.level as string;
				this.inner.setThinkingLevel(level);
				// setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
				// If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
				// force the state back so the compat layer can use it correctly.
				if (
					level === "xhigh" &&
					(this.inner.model as { compat?: { thinkingFormat?: string } } | null)
						?.compat?.thinkingFormat === "deepseek" &&
					this.inner.agent?.state
				) {
					this.inner.agent.state.thinkingLevel = "xhigh";
				}
				return null;
			}

			case "compact": {
				// pi's compact() does not guard against empty messagesToSummarize — use findCutPoint
				// to pre-check and throw a clean error instead of generating a useless empty summary.
				const { findCutPoint, DEFAULT_COMPACTION_SETTINGS } = await import(
					"@earendil-works/pi-coding-agent"
				);
				const pathEntries = this.inner.sessionManager.getBranch() as Array<{
					type: string;
				}>;
				const settings = {
					...DEFAULT_COMPACTION_SETTINGS,
					...this.inner.settingsManager.getCompactionSettings(),
				};
				let prevCompactionIndex = -1;
				for (let i = pathEntries.length - 1; i >= 0; i--) {
					if (pathEntries[i].type === "compaction") {
						prevCompactionIndex = i;
						break;
					}
				}
				const boundaryStart = prevCompactionIndex + 1;
				const cutPoint = findCutPoint(
					pathEntries as never,
					boundaryStart,
					pathEntries.length,
					settings.keepRecentTokens,
				);
				const historyEnd = cutPoint.isSplitTurn
					? cutPoint.turnStartIndex
					: cutPoint.firstKeptEntryIndex;
				if (historyEnd <= boundaryStart) {
					throw new Error("Conversation too short to compact");
				}
				const result = await this.inner.compact(
					command.customInstructions as string | undefined,
				);
				return result;
			}

			case "set_auto_compaction": {
				this.inner.setAutoCompactionEnabled(command.enabled as boolean);
				return null;
			}

			case "steer": {
				assertNotCompacting(this.inner.isCompacting);
				const steerImages = command.images as
					| Array<{ type: "image"; data: string; mimeType: string }>
					| undefined;
				await this.inner.steer(
					command.message as string,
					steerImages?.length ? steerImages : undefined,
				);
				return null;
			}

			case "follow_up": {
				assertNotCompacting(this.inner.isCompacting);
				const followImages = command.images as
					| Array<{ type: "image"; data: string; mimeType: string }>
					| undefined;
				await this.inner.followUp(
					command.message as string,
					followImages?.length ? followImages : undefined,
				);
				return null;
			}

			case "get_tools": {
				const all: ToolInfo[] = this.inner.getAllTools();
				const active = new Set<string>(this.inner.getActiveToolNames());
				return all.map((t) => ({
					name: t.name,
					description: t.description,
					active: active.has(t.name),
				}));
			}

			case "set_tools": {
				// composeActiveTools keeps extension tools active for any non-empty
				// preset and returns [] for the "Off" preset (everything truly off),
				// matching the behaviour at session start.
				const requested = command.toolNames as string[];
				this.inner.setActiveToolsByName(
					composeActiveTools(requested, this.inner.getAllTools()),
				);
				return null;
			}

			case "abort_compaction": {
				this.inner.abortCompaction();
				return null;
			}

			case "set_auto_retry": {
				this.inner.setAutoRetryEnabled(command.enabled as boolean);
				return null;
			}

			default:
				throw new Error(`Unsupported command: ${type}`);
		}
	}

	destroy(): void {
		if (!this._alive) return;
		this._alive = false;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		// A destroyed wrapper's pending extension dialogs can never be answered;
		// cancel them (resolve to the same `undefined`/default the abort path
		// produces) so awaiting prompts (createDialogPromise) don't hang forever
		// and don't surface as unhandled rejections after teardown.
		for (const pending of this.pendingExtensionRequests.values()) {
			try {
				pending.resolve({ cancelled: true } as RpcExtensionUIResponse);
			} catch {
				// already settled
			}
		}
		this.pendingExtensionRequests.clear();
		this.unsubscribe?.();
		this.onDestroyCallback?.();
	}
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
	var __piSessions: Map<string, AgentSessionWrapper> | undefined;
	var __piStartLocks:
		| Map<
				string,
				Promise<{ session: AgentSessionWrapper; realSessionId: string }>
		  >
		| undefined;
}

export function getRegistry(): Map<string, AgentSessionWrapper> {
	if (!globalThis.__piSessions) {
		globalThis.__piSessions = new Map();
		const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
		process.once("exit", cleanup);
		process.once("SIGINT", cleanup);
		process.once("SIGTERM", cleanup);
	}
	return globalThis.__piSessions;
}

function getLocks(): Map<
	string,
	Promise<{ session: AgentSessionWrapper; realSessionId: string }>
> {
	if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
	return globalThis.__piStartLocks;
}

export function getRpcSession(
	sessionId: string,
): AgentSessionWrapper | undefined {
	return getRegistry().get(sessionId);
}

/**
 * Sessions currently streaming (actively running) in this process.
 *
 * The terminal done/failed dot is suppressed only for these, so a session that's
 * still being written to doesn't show a premature green/red dot. Sessions that are
 * merely open-but-idle still show their file-derived status.
 */
export function getActiveRpcSessionIds(): Set<string> {
  const ids = new Set<string>();
  for (const [id, wrapper] of getRegistry()) {
    if (wrapper.inner.isStreaming) ids.add(id);
  }
  return ids;
}
import { notifyRpcSessionEventListeners } from "./rpc-session-events";

export {
	getAllPendingDialogs,
	unionPendingDialogs,
	type FilePendingScanner,
} from "./rpc-pending-dialogs";
export {
	onRpcSessionEvent,
	type RpcSessionEventListener,
} from "./rpc-session-events";
export async function reloadAllSessionModelConfigs(): Promise<{
	ok: number;
	failed: string[];
}> {
	const registry = getRegistry();
	const failed: string[] = [];
	let ok = 0;
	for (const [sessionId, wrapper] of registry) {
		try {
			if (wrapper.isAlive()) {
				await wrapper.reloadModelConfig();
				ok++;
			}
		} catch (err) {
			console.error(
				`[rpc-manager] reload model config failed for session ${sessionId}:`,
				err,
			);
			failed.push(sessionId);
		}
	}
	return { ok, failed };
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
	sessionId: string,
	sessionFile: string,
	cwd: string,
	toolNames?: string[],
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
	const registry = getRegistry();
	const locks = getLocks();

	const existing = registry.get(sessionId);
	if (existing?.isAlive())
		return { session: existing, realSessionId: sessionId };

	const inflight = locks.get(sessionId);
	if (inflight) return inflight;

	const starting = (async () => {
		const { SessionManager, getAgentDir } = await import(
			"@earendil-works/pi-coding-agent"
		);
		const agentDir = getAgentDir();

		const sessionManager = sessionFile
			? SessionManager.open(sessionFile, undefined)
			: SessionManager.create(cwd, undefined);

		// Determine which tools to pass based on requested toolNames.
		// Only the "all off" preset needs an explicit allowlist (`tools: []`), which
		// disables every tool including extensions. For any non-empty preset we OMIT
		// `tools` so the SDK uses its default: built-in tools enabled AND extension
		// tools (e.g. subagent, installed via `pi install`) kept available.
		// Passing an allowlist here is what previously filtered out extension tools.
		let toolsOption: string[] | undefined;
		if (toolNames !== undefined && toolNames.length === 0) {
			toolsOption = [];
		}

		const { session: inner } = await createAgentSession({
			cwd,
			agentDir,
			sessionManager,
			customTools: createCompatUiTools(),
			...(toolsOption !== undefined ? { tools: toolsOption } : {}),
		});

		// For a non-empty preset, narrow the *built-in* tools to the requested set
		// while keeping all extension tools active (discovered from the live
		// registry, so newly installed packages are picked up automatically).
		if (toolNames && toolNames.length > 0) {
			inner.setActiveToolsByName(
				composeActiveTools(toolNames, inner.getAllTools()),
			);
		}

		// When all tools are disabled, clear the system prompt entirely.
		// pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
		// the only way to truly clear it is to call agent.setSystemPrompt directly.
		if (toolNames?.length === 0) {
			inner.agent.state.systemPrompt = "";
		}

		// pi-subagents spawns child pi CLI processes. Do NOT set PI_SUBAGENT_PI_BINARY
		// to a bare cli.js script path: pi-subagents spawns that value directly as an
		// executable, and on Windows spawn a .js -> EFTYPE on every child. Leave it
		// unset so the default resolution runs `node <cli.js> ...` (peer symlink under
		// ~/.pi/agent/npm/node_modules/@earendil-works makes that resolvable in web host).

		const wrapper = new AgentSessionWrapper(inner);
		guardRpcExtensionStartupHandlers(
			(inner as unknown as { _extensionRunner?: ExtensionRunnerLike })
				._extensionRunner,
		);
		try {
			await inner.bindExtensions({
				uiContext: wrapper.createExtensionUIContext(),
				mode: "rpc",
				onError: (err) => {
					console.error("[rpc-manager] extension error:", err);
					wrapper.emit({
						type: "extension_error",
						extensionPath: err.extensionPath,
						event: err.event,
						error: err.error,
					});
				},
			});
			wrapper.start();
			// 按当前模型的 autoCompactThreshold 预热自动压缩设置（没填 → 显式关闭，
			// 覆盖 pi 默认开启；见 lib/compaction-override.ts）。
			wrapper.applyModelCompactionOverride();
			// 跨进程未答问题恢复：打开历史会话时，若当前叶子挂着“无对应 toolResult 的
			// question 弹窗工具调用”，把它重新塞进 pending（见 rehydrateUnansweredQuestion）。
			// 失败不影响会话启动，仅丢一次恢复机会。
			try {
				const sm = wrapper.inner.sessionManager as unknown as {
					getEntries?: () => unknown[];
				};
				const entries = sm.getEntries?.();
				if (entries) {
					const recovered = resolveLeafUnansweredQuestion(
						entries as never,
					);
					if (recovered) wrapper.rehydrateUnansweredQuestion(recovered);
				}
			} catch (err) {
				console.error(
					"[rpc-manager] recover pending question failed:",
					err,
				);
			}
		} catch (err) {
			// If extension binding fails (or throws after the wrapper was constructed),
			// abandon the partially-initialized session instead of leaking an unregistered,
			// never-destroyed wrapper/process that has already opened its session files.
			wrapper.destroy();
			try {
				await inner.abort();
			} catch {
				// ignore teardown errors; the original error is the one to surface
			}
			throw err;
		}

		const realSessionId = inner.sessionId as string;
		const realSessionFile = inner.sessionFile as string | undefined;
		if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

		wrapper.onDestroy(() => registry.delete(realSessionId));
		registry.set(realSessionId, wrapper);

		return { session: wrapper, realSessionId };
	})().finally(() => locks.delete(sessionId));

	locks.set(sessionId, starting);
	return starting;
}


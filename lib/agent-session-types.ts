import type { AgentMessage, SessionInfo, SessionTreeNode } from "@/lib/types";

export interface SessionData {
	sessionId: string;
	filePath: string;
	tree: SessionTreeNode[];
	leafId: string | null;
	context: {
		messages: AgentMessage[];
		entryIds: string[];
		thinkingLevel: string;
		model: { provider: string; modelId: string } | null;
	};
}

interface StreamingState {
	isStreaming: boolean;
	streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
	| { type: "start" }
	| { type: "update"; message: Partial<AgentMessage> }
	| { type: "end" }
	| { type: "reset" };

export function streamReducer(
	state: StreamingState,
	action: StreamAction,
): StreamingState {
	switch (action.type) {
		case "start":
			return { isStreaming: true, streamingMessage: null };
		case "update":
			return { isStreaming: true, streamingMessage: action.message };
		case "end":
		case "reset":
			return { isStreaming: false, streamingMessage: null };
		default:
			return state;
	}
}

export interface AgentEvent {
	type: string;
	[key: string]: unknown;
}

export type ExtensionUIRequest =
	| {
			type: "extension_ui_request";
			id: string;
			method: "select";
			title: string;
			options: string[];
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "confirm";
			title: string;
			message: string;
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "input";
			title: string;
			placeholder?: string;
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "editor";
			title: string;
			prefill?: string;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "multiple";
			title: string;
			questions: Array<{
				title?: string;
				question: string;
				placeholder?: string;
				options?: string[];
			}>;
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setStatus";
			statusKey: string;
			statusText?: string;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines?: string[];
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setTitle";
			title: string;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "set_editor_text";
			text: string;
	  };

export type ExtensionUIResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; value: string[] }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true };

export function isDialogUiRequest(
	event: ExtensionUIRequest,
): event is Extract<
	ExtensionUIRequest,
	{ method: "select" | "confirm" | "input" | "editor" | "multiple" }
> {
	return (
		event.method === "select" ||
		event.method === "confirm" ||
		event.method === "input" ||
		event.method === "editor" ||
		event.method === "multiple"
	);
}

/** Join the text blocks of an agent message into a single string. */
export function textOfMessage(msg: AgentMessage): string {
	if (typeof msg.content === "string") return msg.content;
	return (msg.content as Array<{ type?: string; text?: string }>)
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text as string)
		.join("\n");
}

/**
 * Extract the handoff package from the assistant reply.
 *
 * The `/handoff` skill is instructed to output the package as plain Markdown body
 * starting with the `# 任务交接包` heading (NOT wrapped in a code fence). Some
 * models may still fence it, so accept both forms:
 * 1. A fenced code block whose body contains the `# 任务交接包` heading.
 * 2. Plain text from the `# 任务交接包` heading onward (the skill's canonical shape).
 * Returns null when neither is present (the handoff skill output isn't usable).
 */
export function extractHandoffPackage(text: string): string | null {
	// Preferred: a fenced code block containing the `# 任务交接包` heading.
	const fenceRe = /```[a-zA-Z0-9_-]*[\r\n]+([\s\S]*?)[\r\n]*```/g;
	let m: RegExpExecArray | null;
	while ((m = fenceRe.exec(text))) {
		if (/#\s*任务交接包/.test(m[1])) return m[1].trim();
	}
	// Fallback: the skill's canonical shape — the package is the Markdown body itself,
	// starting with the `# 任务交接包` heading. Slice from that heading onward.
	const heading = /(?:^|\n)(#{1,6}\s*任务交接包)/.exec(text);
	if (!heading) return null;
	// Drop any accidental trailing fence remnants left by the model.
	const pkg = text.slice(heading.index + heading[0].indexOf("#"));
	return pkg.replace(/```[a-zA-Z0-9_-]*\s*\n?$/, "").trim();
}

export type AgentPhase =
	| { kind: "waiting_model" }
	| { kind: "running_tools"; tools: { id: string; name: string }[] }
	| null;

export interface UseAgentSessionOptions {
	session: SessionInfo | null;
	newSessionCwd: string | null;
	onAgentStart?: () => void;
	onAgentEnd?: () => void;
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
	setNewSessionModel?: (
		model: { provider: string; modelId: string } | null,
	) => void;
	setToolPreset?: (preset: "none" | "default" | "full") => void;
}

export interface ChatInputHandle {
	insertText: (text: string) => void;
	insertIfEmpty: (content: string) => void;
	addImages: (files: File[]) => void;
}

export interface AttachedImage {
	data: string;
	mimeType: string;
	previewUrl: string;
}


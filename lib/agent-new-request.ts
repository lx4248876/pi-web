export type AgentNewRequest = {
	cwd?: string;
	type?: string;
	[key: string]: unknown;
};

export type ParsedAgentNewRequest = {
	cwd: string;
	toolNames?: string[];
	provider?: string;
	modelId?: string;
	thinkingLevel?: string;
	promptCommand: Record<string, unknown> | null;
};

export function parseAgentNewRequest(
	body: AgentNewRequest,
): ParsedAgentNewRequest {
	const { cwd, type, provider, modelId, toolNames, thinkingLevel, ...rest } =
		body as AgentNewRequest & {
			provider?: string;
			modelId?: string;
			toolNames?: string[];
			thinkingLevel?: string;
		};

	return {
		cwd: typeof cwd === "string" ? cwd : "",
		provider,
		modelId,
		toolNames,
		thinkingLevel,
		promptCommand:
			type === "create"
				? null
				: {
						type,
						...rest,
					},
	};
}
